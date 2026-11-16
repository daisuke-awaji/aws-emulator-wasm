# 永続化の検討：リロードしてもデータが消えないようにする

2026-11-16。PLAN の Phase 2「スナップショット、複数タブ」の最初の検討です。決めてほしいことは最後の「決めること」にまとめました。

## 1. いまの状態

- エミュレーターの状態（DynamoDB のテーブルと項目、S3 のオブジェクト、SQS のキューとメッセージ）は、すべて wasm のメモリの中にあります。リロードすると Worker ごと消え、`backend.js` の `setup()` が空の状態から作り直します（テーブル・バケット・キューと、3 件の初期 Todo）。
- 上流のエンジン（`vendor/engine`）は、サービスごとの状態を型ごとの表（`HashMap<TypeId, Box<dyn Any>>`）に持つだけで、書き出しと読み込みの機能はありません。状態の型（例：`ComAmazonawsSqsAmazonsqsState`）には serde の derive がなく、tokio の `JoinHandle` のような書き出せないものも入っています。

## 2. 方式の候補

| 方式 | やり方 | 良い点 | 問題 |
|---|---|---|---|
| **A. メモリのスナップショット**（推す） | 要求と要求のあいだに wasm のメモリをまるごと写して保存し、起動時に新しいインスタンスのメモリへ書き戻す | 上流に手を入れない。全サービス・全機能がそのまま残る（GSI、TTL、在庫中のメッセージ、見えなくなっている時間も） | 保存したデータは、同じ wasm のビルドでしか読めない。保存するのはメモリ全体（いまは 19 MiB、gzip で 2.8 MiB） |
| B. 要求の記録と再生 | 状態を変えた要求を記録し、起動時に順に流し直す（PLAN の当初案） | wasm を作り直しても、たいていは再生できる | 記録が増え続け、起動が遅くなる。ReceiveMessage のような読み取りでも状態が変わるので、ほぼすべてを記録することになる。乱数（MessageId など）と時刻で結果がずれる |
| C. AWS の API で書き出す | Scan・ListObjectsV2・GetObject で中身を取り出し、起動時に PutItem・PutObject で入れ直す | wasm が変わっても読める | サービスごとに書く必要がある。設定（GSI、TTL など）の写し漏れが出る。SQS はメッセージを受信すると状態が変わるので、きれいに取り出せない |
| D. 上流の状態に serde を付ける | 状態の型に Serialize・Deserialize を付けるパッチを当てる | 書き出しが正確 | 型が数百あり、上流を更新するたびに当て直しが壊れる。PLAN の「パッチは最小に」に反する |

A を基本にし、wasm が変わったときの扱いだけを別に決める（§4.4）のがよいと考えます。

## 3. A が成り立つかの実験（Node、`js/experiments/`）

デモの wasm（`demo/public/aws-emulator.wasm`、wasm-opt 版）で確かめました。

1. **wasm の外に状態がないか**：mutable な global は `__stack_pointer` の 1 つだけ。要求のあいだは初期値に戻っているので、メモリを写すだけで足ります。table・import に状態はありません。
2. **書き戻して動くか**（`snap.mjs`）：テーブル 1・項目 3・オブジェクト 1・メッセージ 1 を入れたメモリを、新しいインスタンスに書き戻しました。Scan で 3 件、GetObject で本文、ReceiveMessage でメッセージが返り、その後の PutItem 197 件と CreateTable も通りました。
3. **時計を引き継がないと壊れる**：最初の試みは、Scan が ResourceNotFoundException になりました。WASI シムの単調時計は `performance.now()` と、仮想の待ちで進めた分（`skippedNs`、DescribeTable の待ちで約 3 秒）の和です。新しいインスタンスでは時計が戻るので、保存した時刻（テーブルの作成時刻など）が「未来」になります。単調時計を UNIX 時刻基準に変え、`skippedNs` を引き継ぐと直りました。
4. **別のプロセスで読み込めるか**（`reload.mjs`、リロードの代わり）：保存したプロセスを終了させ、2 秒後に別のプロセスで読み込みました。項目は残っていました。また、見えなくなっている時間（VisibilityTimeout）が 5 秒のメッセージは、読み込んだ直後は 0 件で、5.5 秒後に再び受信できました。止まっていたあいだの時間も、正しく数えられています。
5. **大きさと速さ**：

| 項目 | 値 |
|---|---|
| メモリ（起動直後と、上の操作のあと） | 19.0 MiB → 19.1 MiB（306 ページ、うち 0 でないページは 179） |
| gzip（level 1） | 2.84 MiB、84 ms |
| メモリの写し | 5.6 ms |
| 書き戻し | 2.5 ms |
| 1 回の操作で変わるページ（64 KiB） | PutItem と SendMessage：5〜7、UpdateItem：6、PutObject（2 KB）：7、Scan（読むだけ）：6 |

読むだけの操作でもページが変わる（スタック、メモリの割り当て、要求 ID など）ので、「メモリが変わったら保存」では読み取りと区別できません。

## 4. 設計案（A）

### 4.1 保存する中身

1 つの保存データは、次の 2 つです。

- **本体**：wasm のメモリをまるごと gzip にしたもの（`CompressionStream`）。
- **見出し**：wasm の版（ファイルの SHA-256）、`skippedNs`、保存した時刻、世代番号、本体の大きさとチェックサム。

### 4.2 保存のしかた

- **保存する場所**：Worker が OPFS（`navigator.storage.getDirectory()`）に書きます。
- **保存の契機**：要求の待ち行列が空になったら保存します。Todo の追加は 6 回の呼び出しになりますが、保存は 1 回です。
- **保存の手順**：まずメモリを写し（約 5 ms）、その間だけ要求を止めます。圧縮と書き込みは、次の要求を受けながら行います。
- **書き換えの安全**：別名のファイルに書き終えてから、入れ替えます（2 つの枠を交互に使い、見出しの世代番号が新しく、チェックサムが合う方を読む）。書いている途中でタブが閉じても、1 つ前の状態が残ります。
- **失う範囲**：保存が終わる前にタブを閉じると、最後の操作が失われます（数十〜百数十 ms の幅）。気になるなら、ハンドラが変更の API のあとに `await emulator.flush()` を呼んでから応答する、という選択肢も持たせます。
- **trap したとき**：Rust の panic で trap したあとのメモリは、保存しません。

### 4.3 読み込みのしかた

- **起動の順**：wasm をインスタンス化して `_initialize` を実行したあと、保存データがあれば、メモリを書き戻してから `ready` を返します。
- **時計**：単調時計を UNIX 時刻基準（`performance.timeOrigin + performance.now()`）にし、保存した `skippedNs` から続けます。OS の時計が戻ったときに備え、単調時計は前の値を下回らないようにします。
- **結果の通知**：`createEmulator()` は、復元したかどうか（`restored`）と、保存した時刻を返します。
- **デモの初期化**：`backend.js` の初期化は、復元したときは作成をせず、`GetQueueUrl` でキューの URL を取るだけにします（または、すでにあれば作らない形に直します）。
- **初期状態に戻す操作**：保存データを消して読み込み直す操作を、ライブラリ（`emulator.reset()`）とデモの画面に置きます。壊れた状態を保存してしまったときにも、ここから抜けられます。

### 4.4 wasm が変わったとき（再デプロイ）

保存データは、同じ wasm でしか読めません。別のビルドのメモリを書き戻すと、まったく違う配置のメモリとして読まれて壊れます。見出しの SHA-256 が今の wasm と違えば、保存データは使いません。そのときの扱いは次の 2 つです。

- **捨てて初期状態から始める**：デモはこれで十分です。画面に「新しい版になったので初期状態に戻しました」と出します。
- **C の方式で移す**：古い wasm を読み込んで AWS の API で書き出し、新しい wasm に入れ直します。デモで使う 3 サービスに限れば書けますが、手間は大きいので後回しにします。

### 4.5 複数のタブ

タブごとに Worker とエミュレーターが 1 つずつ動きます。そのまま保存すると、後から保存したタブの状態で上書きされ、もう片方の変更が消えます。

| 案 | 内容 | 注意 |
|---|---|---|
| 1. 書けるのは 1 タブだけ（推す） | Web Locks（`navigator.locks`）で鍵を取れたタブだけが動く。ほかのタブには「別のタブで開いています」と出し、「こちらで使う」で鍵を移す | 作りが小さく、どのブラウザでも同じに動く |
| 2. SharedWorker で 1 つを共有 | 全タブが 1 つのエミュレーターに要求を送る | Chrome for Android は長く SharedWorker を無効にしていて、Chrome 148 で有効に戻したばかり（記事の時点ではベータ）。Pixel 7 でのテストが通らないおそれがある |
| 3. 最後に保存したものが勝つ | 何もしない | 変更が黙って消える |

### 4.6 ブラウザの制約

- **対応するブラウザ**：OPFS の同期アクセス（`createSyncAccessHandle`、Worker のみ）は、Chrome 102、Firefox 111、Safari 16.4 から使えます。今回は非同期の書き込みでも足ります。
- **消される条件**：保存は既定で best-effort です。ブラウザの容量が足りなくなると消されることがあります。`navigator.storage.persist()` で消されにくくできますが、認めるかどうかはブラウザが決めます。
- **Safari の 7 日ルール**：Safari は、7 日間操作のなかったサイトのデータを消します。デモの画面には「このブラウザの中だけに保存」と書いておきます。
- **大きさの性質**：wasm のメモリは縮まないので、保存データの大きさは「一番大きかったとき」になります。大きなオブジェクトを S3 に入れて消しても、小さくはなりません。いまの 19 MiB（gzip で 3 MiB 弱）なら、問題になりません。

### 4.7 作る順番（案）

1. **シムの時計**：単調時計を UNIX 時刻基準にし、`skippedNs` を引き継げるようにする。既存のテストが通ることを確かめる。
2. **ライブラリ**：Worker に保存と読み込み（OPFS、2 枠、見出し、gzip）を入れ、`createEmulator({ persist: 'opfs' | false })`、`restored`、`flush()`、`reset()` を足す。既定は保存しない（今と同じ）。
3. **デモ**：`persist: 'opfs'` にし、初期化を復元に対応させる。「初期状態に戻す」ボタン、復元した旨の表示、複数タブの鍵（案 1）を足す。
4. **テスト**：Playwright で「追加・完了・メモ → リロード → 残っている」「初期状態に戻す」「2 つ目のタブ」「wasm の版が違う保存データは捨てる」。Node でも、保存と読み込みの往復を確かめる。

## 5. 決めること

1. 方式：A（メモリのスナップショット）でよいか。
2. 複数のタブ：案 1（書けるのは 1 タブだけ）でよいか。
3. 再デプロイで wasm が変わったとき：捨てて初期状態から始める、でよいか。
4. 保存の契機：待ち行列が空になったら保存（最後の操作が失われる小さな幅を許す）でよいか、変更のたびに保存を待ってから応答するか。

## 参考

- [Origin private file system - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)（2025-07-14）
- [OPFS access handles to be more synchronous · rhashimoto/wa-sqlite Discussion #67](https://github.com/rhashimoto/wa-sqlite/discussions/67)（2022-11-25、2023-05-07 追記：Chrome 108・Safari 16.4・Firefox 111）
- [Verify OPFS browser persistence end-to-end on Chrome, Firefox, and Safari · libredb Issue #10](https://github.com/libredb/libredb-database/issues/10)（2026-06-29）
- [Storage quotas and eviction criteria - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)（2026-01-04）
- [StorageManager: persist() method - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)（2026-10-12）
- [Chrome 148 Beta for Android adds Web Serial, SharedWorker support | Notebookcheck](https://www.notebookcheck.net/Chrome-148-Beta-for-Android-adds-Web-Serial-SharedWorker-support.1269721.0.html)（2026-10-05）
- [Intent to Extend Experiment: SharedWorker on Android | blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/yUokoGf06T0)（2026-01-08）
