// The demo's two languages. The choice comes from ?lang=, then the last choice (localStorage),
// then the browser's language; switching re-renders the page in place.
//
// Messages are strings or functions of their arguments: t('remaining', 1, 3).
import { createElement, Fragment, useSyncExternalStore } from 'react';

export const LANGS = ['en', 'ja'];
const STORAGE_KEY = 'aws-emulator-demo-lang';

const q = (title) => `「${title}」`;

const messages = {
  ja: {
    // Document
    'doc.title': 'Todo — ブラウザの中の AWS Emulator',
    'doc.description': 'サーバーなしで動く Todo。MSW から Hono の API に渡し、ブラウザ内の AWS Emulator（wasm）の DynamoDB・S3・SQS を呼びます。',
    'sdk.doc.title': 'SDK の往復テスト — ブラウザの中の AWS Emulator',

    // Navigation
    'nav.label': 'サイト',
    'nav.home': 'aws-emulator-wasm のデモ',
    'nav.sdk': 'SDK テスト',
    'nav.repo': 'GitHub のリポジトリ',
    'nav.language': '言語',
    'status.loading': '読み込み中',
    'status.waiting': '待機中',
    'status.ready': '動作中',
    'status.failed': '停止',
    'status.signedOut': '未サインイン',

    // Hero
    eyebrow: 'すべてブラウザの中で動きます',
    lead: (strong) => [
      'サーバーなしで動く Todo です。画面の通信は MSW が受け取り、Hono の API（本番では Lambda Web Functions で動かす同じコード）が AWS SDK v3 で',
      strong('ブラウザ内の AWS Emulator（wasm）'),
      'を呼びます。Todo は DynamoDB、メモは S3、変更の記録は SQS に入ります。',
    ],

    // Boot and tabs
    'waiting.title': 'このデモは別のタブで開いています',
    'waiting.body': 'エミュレーターの状態をこのブラウザに保存しているので、同時に動かせるのは 1 つのタブだけです。そのタブを閉じると、ここで始まります。',
    'tab.useHere': 'このタブで使う',
    'lost.title': '別のタブで使い始めたので、このタブは止めました',
    'lost.body': '同時に動かせるのは 1 つのタブだけです。ここに戻すと、もう一方のタブが止まります。',
    'boot.loading': 'エミュレーターを読み込んでいます…',
    seconds: (n) => `${n} 秒`,
    'boot.firstTime': '初回は wasm（約 9 MB、圧縮後）をダウンロードします。',
    'boot.failed': 'エミュレーターを起動できませんでした',
    footer: 'エミュレーターの状態はこのブラウザの中（OPFS）に保存され、再読み込みしても残ります。サーバーには送りません。「初期状態に戻す」で最初の 3 件に戻ります。',
    'footer.sdk': 'SDK の往復テスト（DynamoDB・S3・SQS）',

    // Architecture
    'arch.browser': 'ブラウザ',
    'arch.noServer': 'サーバーなし',
    'arch.label': '構成',
    'arch.passes': (label) => `${label} で渡す`,
    'arch.screen': '画面',
    'arch.mock': 'API のモック',
    'arch.handlers': 'API（Lambda と同じコード）',
    'arch.mainThread': 'メインスレッド',
    'arch.forward': '転送',
    'arch.emulator': 'AWS Emulator（wasm）',
    'arch.services': '使っているサービス',
    'arch.useTodos': 'Todo',
    'arch.useNotes': 'メモ',
    'arch.useActivity': '変更の記録',
    'arch.loading': '読み込み中',
    'arch.ready': '動作中',
    'arch.failed': '起動に失敗',

    // Todos
    'todos.remaining': (left, all) => `残り ${left} 件 / 全 ${all} 件`,
    'todos.new': '新しい Todo',
    'todos.placeholder': '新しい Todo を入力',
    'todos.add': '追加',
    'todos.loading': '読み込み中…',
    'todos.list': 'Todo の一覧',
    'todos.empty': 'Todo はありません。',
    'todo.titleField': 'タイトル',
    'todo.save': '保存',
    'todo.cancel': 'やめる',
    'todo.edit': '編集',
    'todo.editLabel': (title) => `${q(title)}を編集`,
    'todo.note': 'メモ',
    'todo.hasNote': 'メモあり',
    'todo.noteLabel': (title) => `${q(title)}のメモ`,
    'todo.delete': '削除',
    'todo.deleteLabel': (title) => `${q(title)}を削除`,
    'todo.markDone': (title) => `${q(title)}を完了にする`,
    'todo.markOpen': (title) => `${q(title)}を未完了に戻す`,
    'note.field': 'メモ（S3 に保存）',
    'note.save': 'メモを保存',
    'note.close': '閉じる',

    // What each action is called in the SDK call log
    'action.bootRestored': '起動（保存した状態を復元）',
    'action.bootFresh': '起動（テーブル・バケット・キューの作成と初期データ）',
    'action.bootAws': '起動',
    'action.add': (title) => (title ? `${q(title)}を追加` : 'Todo を追加'),
    'action.done': (title) => `${q(title)}を完了にする`,
    'action.reopen': (title) => `${q(title)}を未完了に戻す`,
    'action.rename': (title) => `${q(title)}の名前を変更`,
    'action.openNote': (title) => `${q(title)}のメモを開く`,
    'action.saveNote': (title) => `${q(title)}のメモを保存`,
    'action.delete': (title) => `${q(title)}を削除`,

    // Emulator card
    'emu.title': 'エミュレーター',
    'emu.boot': '起動',
    'emu.requests': 'SDK の呼び出し（累計）',
    'emu.last': '直前の操作',
    'emu.skipped': '仮想時計で進めた時間',
    unitSeconds: ' 秒',
    unitCalls: ' 回',
    count: (n) => `${n} 回`,

    // Activity
    'activity.title': '変更の記録',
    'activity.badge': 'SQS から受信',
    'activity.empty': 'まだありません。',
    'event.created': '追加',
    'event.completed': '完了',
    'event.reopened': '未完了に戻す',
    'event.renamed': '名前を変更',
    'event.noted': 'メモを更新',
    'event.deleted': '削除',

    // Persistence
    'persist.unavailable': 'このブラウザでは保存を使えないため、再読み込みすると初期状態に戻ります。',
    'persist.restoredOlder': (at) => `最後の保存が壊れていたため、1 つ前の状態（${at} に保存）を復元しました。`,
    'persist.restored': (at) => `前回の状態を復元しました（${at} に保存）。`,
    'persist.newVersion': 'エミュレーターが新しい版になったので、初期状態から始めました。',
    'persist.corrupt': '保存したデータが壊れていたため、初期状態から始めました。',
    'save.unavailable': '保存：使えません',
    'save.failed': (message) => `保存に失敗しました：${message}`,
    'save.last': (at, mb, ms) => `保存：${at}（${mb} MB、${ms} ms）`,
    'save.restored': (at) => `保存：${at}（復元した状態）`,
    'save.none': '保存：まだありません',
    'reset.button': '初期状態に戻す',
    'reset.confirm': '保存したデータを消して、最初の 3 件に戻します。',
    'reset.yes': '消して戻す',
    'reset.no': 'やめる',

    // SDK call log
    'calls.title': 'SDK の呼び出し',
    'calls.badge': '操作ごと',
    'calls.help': (code, strong) => [
      '操作のたびに、画面は変更の API を 1 回呼んだあと、一覧（',
      code('GET /api/todos'),
      ' → DynamoDB Scan）と変更の記録（',
      code('GET /api/activity'),
      ' → SQS が空になるまで受信し、受け取った分を削除）を読み直します。そのため Todo の追加は、PutItem と SendMessage の 2 回に読み直しの 4 回を足して ',
      strong('6 回'),
      'になります。行を開くと、',
      code('api/todos.js'),
      ' が SDK に渡した入力と、返ってきた出力が見られます。',
    ],
    'calls.empty': 'まだありません。',
    'calls.error': 'エラー',
    'calls.count': (n) => `SDK ${n} 回`,
    'calls.none': 'SDK は呼ばれていません（ハンドラが入力を受け付けませんでした）。',
    'calls.listLabel': (label) => `${label} の SDK 呼び出し`,
    'calls.input': '入力',
    'calls.output': '出力',
    'calls.inputLabel': (seq) => `#${seq} の入力`,
    'calls.outputLabel': (seq, error) => `#${seq} の${error ? 'エラー' : '出力'}`,
    'calls.noSdk': 'SDK の記録がありません。',
    'route.setup': '起動時の準備',
    'route.concurrent': '並行',
    'snap.chars': (head, n) => `${head}…（全 ${n} 文字）`,
    'snap.bytes': (n) => `<${n} バイト>`,
    'snap.stream': '<Body（ストリーム）>',
    'snap.more': (n) => `…ほか ${n} 件`,

    // Seed data, created by api/provision.js on first start
    seeds: [
      { title: 'AWS Emulator を wasm にビルドする', done: true, note: 'wasm32-wasip1 向けにビルドする。' },
      { title: 'ブラウザの Worker で動かす', done: true },
      { title: 'MSW のハンドラから DynamoDB・S3・SQS を呼ぶ', done: false },
    ],
    // The AWS build (VITE_API_URL set): the same page against the Lambda Web Function
    'aws.eyebrow': 'AWS に接続しています',
    'aws.lead': (strong) => [
      'この Todo は ',
      strong('Lambda Web Function にデプロイした Hono の API'),
      ' を呼びます。データは DynamoDB・S3・SQS の実リソースに入り、サインインしたユーザーごとに分かれます。',
    ],
    'aws.footer': 'データは AWS アカウントの DynamoDB・S3・SQS に保存されます。API は Cognito のアクセストークンを確かめてから応答します。',
    'aws.loading': 'サインインの状態を確かめています…',
    'aws.failed': 'AWS の API に接続できませんでした',
    'aws.api.INTERNAL': ({ message }) => `サーバーでエラーが起きました: ${message}`,
    'aws.signInTitle': 'サインインしてください',
    'aws.signInBody': 'Todo はユーザーごとに分かれています。Cognito のサインイン画面に移動します。',
    'aws.signIn': 'サインイン',
    'aws.signOut': 'サインアウト',
    'aws.title': 'AWS',
    'aws.endpoint': 'API のエンドポイント',
    'aws.signedInAs': 'サインイン中のユーザー',
    'api.UNAUTHORIZED': 'サインインが切れました。もう一度サインインしてください',

    // API errors by their code (api/errors.js); the argument is the response body.
    'api.BAD_JSON': 'リクエストの本文が JSON ではありません',
    'api.TITLE_REQUIRED': 'タイトルを入力してください',
    'api.TITLE_TOO_LONG': ({ max }) => `タイトルは ${max} 文字以内にしてください`,
    'api.DONE_NOT_BOOLEAN': 'done は true か false です',
    'api.NOTHING_TO_CHANGE': '変更する項目がありません',
    'api.NOT_FOUND': 'Todo が見つかりません',
    'api.NOTE_NOT_STRING': 'メモは文字列です',
    'api.NOTE_TOO_LONG': ({ max }) => `メモは ${max} 文字以内にしてください`,
    'api.INTERNAL': ({ message }) => `エミュレーターでエラーが起きました: ${message}`,

    // SDK test page
    'sdk.title': 'SDK の往復テスト',
    'sdk.lead': (code) => [
      'AWS SDK for JavaScript v3 から、この Worker 内の AWS Emulator（wasm）に DynamoDB・S3・SQS の操作を送ります。Node のテスト（',
      code('js/test/scenarios.mjs'),
      '）と同じシナリオです。',
    ],
    'sdk.status': '状態：',
    'sdk.service': 'サービス',
    'sdk.operation': '操作',
    'sdk.time': '時間',
    'sdk.fetchCompile': 'wasm の取得とコンパイル',
    'sdk.instantiate': 'インスタンス化',
    'sdk.running': (name) => `${name} を実行中`,
    'sdk.back': 'Todo のデモに戻る',
  },

  en: {
    'doc.title': 'Todo — AWS Emulator in the browser',
    'doc.description': 'A Todo app with no server. MSW hands requests to a Hono API that calls DynamoDB, S3 and SQS on the AWS Emulator (wasm) running in the browser.',
    'sdk.doc.title': 'SDK round trips — AWS Emulator in the browser',

    'nav.label': 'Site',
    'nav.home': 'aws-emulator-wasm demo',
    'nav.sdk': 'SDK tests',
    'nav.repo': 'GitHub repository',
    'nav.language': 'Language',
    'status.loading': 'Loading',
    'status.waiting': 'Waiting',
    'status.ready': 'Running',
    'status.failed': 'Stopped',
    'status.signedOut': 'Signed out',

    eyebrow: 'Everything runs in your browser',
    lead: (strong) => [
      'A Todo app with no server. MSW catches the page’s API calls and hands them to a Hono API (the same code you would run as a Lambda Web Function), which uses AWS SDK v3 to call ',
      strong('the AWS Emulator (wasm) inside the browser'),
      '. Todos go to DynamoDB, notes to S3 and the change log to SQS.',
    ],

    'waiting.title': 'This demo is open in another tab',
    'waiting.body': 'The emulator’s state is saved in this browser, so only one tab can run it at a time. Close the other tab and it starts here.',
    'tab.useHere': 'Use it in this tab',
    'lost.title': 'Another tab took over, so this tab stopped',
    'lost.body': 'Only one tab can run the demo at a time. Bringing it back here stops the other tab.',
    'boot.loading': 'Loading the emulator…',
    seconds: (n) => `${n} s`,
    'boot.firstTime': 'The first visit downloads the wasm (about 9 MB compressed).',
    'boot.failed': 'The emulator could not start',
    footer: 'The emulator’s state is saved inside this browser (OPFS) and survives a reload. Nothing is sent to a server. “Reset” brings back the first 3 todos.',
    'footer.sdk': 'SDK round trips (DynamoDB, S3, SQS)',

    'arch.browser': 'Browser',
    'arch.noServer': 'No server',
    'arch.label': 'Architecture',
    'arch.passes': (label) => `Passed by ${label}`,
    'arch.screen': 'UI',
    'arch.mock': 'API mock',
    'arch.handlers': 'API (same code as on Lambda)',
    'arch.mainThread': 'Main thread',
    'arch.forward': 'forward',
    'arch.emulator': 'AWS Emulator (wasm)',
    'arch.services': 'Services in use',
    'arch.useTodos': 'Todos',
    'arch.useNotes': 'Notes',
    'arch.useActivity': 'Change log',
    'arch.loading': 'Loading',
    'arch.ready': 'Running',
    'arch.failed': 'Failed to start',

    'todos.remaining': (left, all) => `${left} left / ${all} total`,
    'todos.new': 'New todo',
    'todos.placeholder': 'What needs to be done?',
    'todos.add': 'Add',
    'todos.loading': 'Loading…',
    'todos.list': 'Todo list',
    'todos.empty': 'No todos.',
    'todo.titleField': 'Title',
    'todo.save': 'Save',
    'todo.cancel': 'Cancel',
    'todo.edit': 'Edit',
    'todo.editLabel': (title) => `Edit “${title}”`,
    'todo.note': 'Note',
    'todo.hasNote': 'Has note',
    'todo.noteLabel': (title) => `Note for “${title}”`,
    'todo.delete': 'Delete',
    'todo.deleteLabel': (title) => `Delete “${title}”`,
    'todo.markDone': (title) => `Mark “${title}” as done`,
    'todo.markOpen': (title) => `Mark “${title}” as not done`,
    'note.field': 'Note (saved to S3)',
    'note.save': 'Save note',
    'note.close': 'Close',

    'action.bootRestored': 'Start (restore the saved state)',
    'action.bootFresh': 'Start (create the table, bucket and queue, and seed data)',
    'action.bootAws': 'Start',
    'action.add': (title) => (title ? `Add “${title}”` : 'Add a todo'),
    'action.done': (title) => `Mark “${title}” as done`,
    'action.reopen': (title) => `Mark “${title}” as not done`,
    'action.rename': (title) => `Rename “${title}”`,
    'action.openNote': (title) => `Open the note for “${title}”`,
    'action.saveNote': (title) => `Save the note for “${title}”`,
    'action.delete': (title) => `Delete “${title}”`,

    'emu.title': 'Emulator',
    'emu.boot': 'Start-up',
    'emu.requests': 'SDK calls (total)',
    'emu.last': 'Last action',
    'emu.skipped': 'Skipped by the virtual clock',
    unitSeconds: ' s',
    unitCalls: ' calls',
    count: (n) => `${n} calls`,

    'activity.title': 'Change log',
    'activity.badge': 'Received from SQS',
    'activity.empty': 'Nothing yet.',
    'event.created': 'Added',
    'event.completed': 'Done',
    'event.reopened': 'Reopened',
    'event.renamed': 'Renamed',
    'event.noted': 'Note',
    'event.deleted': 'Deleted',

    'persist.unavailable': 'This browser cannot save the state, so a reload starts over.',
    'persist.restoredOlder': (at) => `The last save was damaged, so the one before it (saved ${at}) was restored.`,
    'persist.restored': (at) => `Restored the previous state (saved ${at}).`,
    'persist.newVersion': 'The emulator has a new version, so the demo started over.',
    'persist.corrupt': 'The saved data was damaged, so the demo started over.',
    'save.unavailable': 'Saving: not available',
    'save.failed': (message) => `Could not save: ${message}`,
    'save.last': (at, mb, ms) => `Saved ${at} (${mb} MB, ${ms} ms)`,
    'save.restored': (at) => `Saved ${at} (restored)`,
    'save.none': 'Not saved yet',
    'reset.button': 'Reset',
    'reset.confirm': 'This deletes the saved data and brings back the first 3 todos.',
    'reset.yes': 'Delete and reset',
    'reset.no': 'Cancel',

    'calls.title': 'SDK calls',
    'calls.badge': 'Per action',
    'calls.help': (code, strong) => [
      'After each change, the page calls the API once, then reloads the list (',
      code('GET /api/todos'),
      ' → DynamoDB Scan) and the change log (',
      code('GET /api/activity'),
      ' → receive from SQS until it is empty, and delete what came in). Adding a todo is PutItem and SendMessage, plus 4 calls to reload: ',
      strong('6 calls'),
      ' in all. Open a row to see the input ',
      code('api/todos.js'),
      ' gave the SDK, and the output that came back.',
    ],
    'calls.empty': 'Nothing yet.',
    'calls.error': 'Error',
    'calls.count': (n) => `${n} SDK ${n === 1 ? 'call' : 'calls'}`,
    'calls.none': 'No SDK calls (the handler rejected the input).',
    'calls.listLabel': (label) => `SDK calls for ${label}`,
    'calls.input': 'Input',
    'calls.output': 'Output',
    'calls.inputLabel': (seq) => `Input of #${seq}`,
    'calls.outputLabel': (seq, error) => `${error ? 'Error' : 'Output'} of #${seq}`,
    'calls.noSdk': 'No SDK record.',
    'route.setup': 'start-up',
    'route.concurrent': 'concurrent',
    'snap.chars': (head, n) => `${head}… (${n} characters)`,
    'snap.bytes': (n) => `<${n} bytes>`,
    'snap.stream': '<Body (stream)>',
    'snap.more': (n) => `…${n} more`,

    seeds: [
      { title: 'Build the AWS Emulator to wasm', done: true, note: 'Target wasm32-wasip1.' },
      { title: 'Run it in a browser Worker', done: true },
      { title: 'Call DynamoDB, S3 and SQS from MSW handlers', done: false },
    ],
    'aws.eyebrow': 'Connected to AWS',
    'aws.lead': (strong) => [
      'This Todo app calls ',
      strong('a Hono API deployed as a Lambda Web Function'),
      '. Data goes to real DynamoDB, S3 and SQS resources, separately for each signed-in user.',
    ],
    'aws.footer': 'Data is stored in DynamoDB, S3 and SQS in the AWS account. The API checks a Cognito access token before it answers.',
    'aws.loading': 'Checking your sign-in…',
    'aws.failed': 'Could not connect to the API on AWS',
    'aws.api.INTERNAL': ({ message }) => `The server failed: ${message}`,
    'aws.signInTitle': 'Sign in',
    'aws.signInBody': 'Todos are kept per user. You will go to the Cognito sign-in page.',
    'aws.signIn': 'Sign in',
    'aws.signOut': 'Sign out',
    'aws.title': 'AWS',
    'aws.endpoint': 'API endpoint',
    'aws.signedInAs': 'Signed in as',
    'api.UNAUTHORIZED': 'Your session ended. Sign in again',
    'api.BAD_JSON': 'The request body is not JSON',
    'api.TITLE_REQUIRED': 'Enter a title',
    'api.TITLE_TOO_LONG': ({ max }) => `Keep the title to ${max} characters or fewer`,
    'api.DONE_NOT_BOOLEAN': 'done must be true or false',
    'api.NOTHING_TO_CHANGE': 'Nothing to change',
    'api.NOT_FOUND': 'Todo not found',
    'api.NOTE_NOT_STRING': 'The note must be a string',
    'api.NOTE_TOO_LONG': ({ max }) => `Keep the note to ${max} characters or fewer`,
    'api.INTERNAL': ({ message }) => `The emulator failed: ${message}`,

    'sdk.title': 'SDK round trips',
    'sdk.lead': (code) => [
      'Sends DynamoDB, S3 and SQS operations from AWS SDK for JavaScript v3 to the AWS Emulator (wasm) in this page’s Worker. The scenarios are the same as the Node tests (',
      code('js/test/scenarios.mjs'),
      ').',
    ],
    'sdk.status': 'Status: ',
    'sdk.service': 'Service',
    'sdk.operation': 'Operation',
    'sdk.time': 'Time',
    'sdk.fetchCompile': 'Fetch and compile the wasm',
    'sdk.instantiate': 'Instantiate',
    'sdk.running': (name) => `Running ${name}`,
    'sdk.back': 'Back to the Todo demo',
  },
};

function initialLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(fromUrl)) {
    save(fromUrl);
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Storage may be blocked; fall back to the browser's language.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferred.some((l) => l?.toLowerCase().startsWith('ja')) ? 'ja' : 'en';
}

function save(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Not remembered across visits, but the switch still works.
  }
}

let lang = initialLang();
const listeners = new Set();
let docKeys = { title: 'doc.title', description: 'doc.description' };

function applyDocument() {
  document.documentElement.lang = lang;
  document.title = t(docKeys.title);
  if (docKeys.description) document.querySelector('meta[name="description"]')?.setAttribute('content', t(docKeys.description));
}

/** Whether `key` has a message (in either language). */
export const has = (key) => key in messages[lang] || key in messages.en;

/** The message `key` in the current language; function messages get `args`. */
export function t(key, ...args) {
  const message = messages[lang][key] ?? messages.en[key];
  if (message === undefined) return key;
  return typeof message === 'function' ? message(...args) : message;
}

/** A message made of strings and elements (see 'lead'), ready to render. */
export const rich = (key, ...args) => t(key, ...args).map((part, i) => createElement(Fragment, { key: i }, part));

/** A label stored as [key, ...args], rendered in whatever language is current. */
export const tl = (label) => t(...label);

export const getLang = () => lang;

/** BCP 47 locale for dates and times. */
export const locale = () => (lang === 'ja' ? 'ja-JP' : 'en-US');

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  save(next);
  applyDocument();
  for (const fn of listeners) fn();
}

/** Which messages give the page its <title> and description. */
export function setDocumentKeys(keys) {
  docKeys = keys;
  applyDocument();
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Re-renders the component when the language changes; returns the current one. */
export const useLang = () => useSyncExternalStore(subscribe, getLang);

/** Calls fn now and whenever the language changes (for pages without React). */
export function onLangChange(fn) {
  fn(lang);
  return subscribe(() => fn(lang));
}
