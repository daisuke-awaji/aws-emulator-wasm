#!/usr/bin/env python3
"""Writes docs/architecture/architecture.drawio: the internal software architecture.

usage: python3 scripts/architecture.py   (then: node scripts/render-architecture.mjs)

Every box has absolute coordinates on one layer, and every arrow is one straight
horizontal or vertical segment. The script checks that no arrow or arrow label runs
across a box other than the two it connects.
"""
import base64
import html
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / 'docs/architecture/icons'
AWS = ROOT / 'demo/src/assets/aws'
OUT = ROOT / 'docs/architecture/architecture.drawio'

FONT = 'Helvetica'
INK = '#171717'
MUTED = '#666666'
LINE = '#d4d4d4'


def icon(path):
    data = base64.b64encode(path.read_bytes()).decode()
    return f'data:image/svg+xml,{data}'


IMG = {
    'react': icon(ICONS / 'react.svg'),
    'msw': icon(ICONS / 'mockserviceworker.svg'),
    'wasm': icon(ICONS / 'webassembly.svg'),
    'rust': icon(ICONS / 'rust.svg'),
    'actions': icon(ICONS / 'githubactions.svg'),
    'pages': icon(ICONS / 'githubpages.svg'),
    'github': icon(ICONS / 'github.svg'),
    'js': icon(ICONS / 'javascript.svg'),
    'vite': icon(ICONS / 'vite.svg'),
    'dynamodb': icon(AWS / 'dynamodb.svg'),
    's3': icon(AWS / 's3.svg'),
    'sqs': icon(AWS / 'sqs.svg'),
}

cells = []  # (id, xml)
boxes = {}  # id -> (x, y, w, h, kind)  kind: 'box' | 'container'
edges = []  # (id, src, dst, (x1, y1), (x2, y2), label)


def esc(s):
    return html.escape(s, quote=True)


def label(title, sub=None, code=None):
    out = f'<b style="font-size:13px">{html.escape(title)}</b>'
    if code:
        out += f'<br><span style="font-family:Courier New,monospace;font-size:11px;color:{INK}">{html.escape(code)}</span>'
    if sub:
        out += f'<br><span style="font-size:11px;color:{MUTED}">{html.escape(sub)}</span>'
    return out


def vertex(id, x, y, w, h, value, style, kind='box'):
    boxes[id] = (x, y, w, h, kind)
    cells.append(
        f'<mxCell id="{id}" value="{esc(value)}" style="{style}" vertex="1" parent="1">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
    )


def box(id, x, y, w, h, title, sub=None, img=None, code=None, stroke=LINE, fill='#ffffff', small=False):
    style = (
        f'rounded=1;arcSize=8;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};'
        f'fontFamily={FONT};fontColor={INK};fontSize=12;align=left;verticalAlign=middle;spacingRight=10;'
    )
    if img:
        size, left = (24, 36) if small else (28, 46)
        style = 'shape=label;' + style + f'image={IMG[img]};imageWidth={size};imageHeight={size};imageAlign=left;imageVerticalAlign=middle;spacingLeft={left};'
    else:
        style += 'spacingLeft=12;'
    if small:
        style = style.replace('spacingRight=10;', 'spacingRight=4;')
    vertex(id, x, y, w, h, label(title, sub, code), style)


def container(id, x, y, w, h, title, stroke, fill, dashed=False, img=None):
    style = (
        f'rounded=1;arcSize=10;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth=1.5;'
        f'fontFamily={FONT};fontColor={INK};fontSize=13;fontStyle=1;align=left;verticalAlign=top;spacingLeft=12;spacingTop=6;'
        + ('dashed=1;dashPattern=6 4;' if dashed else '')
    )
    if img:
        style = 'shape=label;' + style + f'image={IMG[img]};imageWidth=18;imageHeight=18;imageAlign=left;imageVerticalAlign=top;spacingLeft=34;'
    vertex(id, x, y, w, h, html.escape(title), style, kind='container')


def note(id, x, y, w, h, value, fill='#ffffff', stroke=LINE):
    style = (
        f'rounded=1;arcSize=8;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};'
        f'fontFamily={FONT};fontColor={INK};fontSize=12;align=left;verticalAlign=top;spacing=12;spacingTop=8;'
    )
    vertex(id, x, y, w, h, value, style)


def side_point(id, side, at):
    """The point on a side of box `id` at the absolute coordinate `at` (x for top/bottom, y for left/right)."""
    x, y, w, h, _ = boxes[id]
    if side == 'top':
        return (at, y), ((at - x) / w, 0)
    if side == 'bottom':
        return (at, y + h), ((at - x) / w, 1)
    if side == 'left':
        return (x, at), (0, (at - y) / h)
    if side == 'right':
        return (x + w, at), (1, (at - y) / h)
    raise ValueError(side)


def edge(src, s_side, dst, d_side, at, text=None, kind='call', pos=0.0):
    """pos: where the label sits along the arrow, -1 (source) .. 1 (target)."""
    (p1, (ex, ey)) = side_point(src, s_side, at)
    (p2, (nx, ny)) = side_point(dst, d_side, at)
    for name, f in (('exit', (ex, ey)), ('entry', (nx, ny))):
        if not all(0 <= v <= 1 for v in f):
            sys.exit(f'{src}->{dst}: {name} point outside the box ({f})')
    color, dash, width = {
        'call': (INK, '', 1.5),
        'deliver': ('#8f8f8f', 'dashed=1;dashPattern=5 4;', 1.25),
        'ci': ('#8f8f8f', '', 1.25),
        'log': ('#0068d6', 'dashed=1;dashPattern=2 3;', 1.25),
    }[kind]
    style = (
        f'edgeStyle=none;html=1;rounded=0;endArrow=blockThin;endFill=1;endSize=7;strokeColor={color};strokeWidth={width};{dash}'
        f'exitX={ex:.4f};exitY={ey:.4f};exitDx=0;exitDy=0;entryX={nx:.4f};entryY={ny:.4f};entryDx=0;entryDy=0;'
        f'fontFamily={FONT};fontSize=11;fontColor={MUTED};labelBackgroundColor=#ffffff;'
    )
    id = f'e{len(edges) + 1}'
    edges.append((id, src, dst, p1, p2, text, pos))
    cells.append(
        f'<mxCell id="{id}" value="{esc(text or "")}" style="{style}" edge="1" parent="1" source="{src}" target="{dst}">'
        f'<mxGeometry x="{pos}" relative="1" as="geometry"/></mxCell>'
    )


# ---------------------------------------------------------------- build and delivery
box('upstream', 470, 20, 360, 64, '上流 aws/aws-emulator', 'Rust・commit 813af48 に固定（このリポジトリには含めない）', 'rust')
box('repo', 40, 120, 330, 100, 'このリポジトリ', 'scripts/・patches/・crates/wasm-host・js/・demo/', 'github')
box('build', 470, 120, 360, 100, 'CI: build ジョブ', 'fetch-upstream.sh（sparse checkout）→ patch_wasm.py → cargo build --target wasm32-wasip1 → wasm-opt -Oz → Node テスト', 'actions')
box('bjob', 930, 120, 330, 100, 'CI: browser ジョブ', 'vite build（BASE_PATH=/aws-emulator-wasm/）→ Playwright（Chromium、デスクトップとスマートフォン）', 'actions')
box('deploy', 1360, 120, 330, 100, 'CI: deploy ジョブ', 'actions/deploy-pages', 'actions')
box('pages', 40, 270, 1660, 56, 'GitHub Pages', '静的ファイルを配るだけ。API のサーバーはありません', 'pages')

# ---------------------------------------------------------------- the browser
container('browser', 20, 370, 1700, 1390, 'ブラウザ（1 つのタブ）', '#a3a3a3', '#fafafa')
container('main', 50, 420, 730, 1320, 'メインスレッド', '#3b82f6', '#eff6ff')
container('swlane', 800, 420, 260, 250, 'Service Worker', '#ff6a33', '#fff4ed')
container('worker', 800, 1040, 905, 700, 'Web Worker（name: aws-emulator）', '#7c3aed', '#f5f3ff')

# main thread
box('react', 100, 480, 440, 80, 'React の画面', 'App.jsx・CallLog.jsx・Architecture.jsx', 'react', code="fetch('api/todos', …)")
box('handlers', 100, 590, 620, 80, 'MSW のハンドラ（mocks/handlers.js）', 'main.jsx の setupWorker(...handlers) で登録。route() が入力の検査とエラーを HTTP の応答に変える', 'msw')
box('backend', 100, 710, 440, 80, 'backend.js（Lambda の代わり）', '初回だけ ensureSetup()：テーブル・バケット・キューと初期データ', 'js', code='list・create・update・remove・getNote・putNote・drainActivity')
box('sdk', 100, 830, 440, 110, 'AWS SDK v3 のクライアント（emulator.js）', 'ミドルウェア：直列化 → SigV4 署名（ダミーの鍵）→ 再試行なし（maxAttempts: 1）', 'js', code='DynamoDBClient + DocumentClient・S3Client・SQSClient')
box('wrh', 100, 980, 440, 80, 'WasmRequestHandler（js/src/handler.mjs）', 'SDK の requestHandler を差し替え、HTTP に出さずに渡す', 'js', code='HttpRequest → { method, url, headers, body }')
box('calls', 560, 980, 160, 80, 'calls.js', '呼び出しのログ（API ごとに印を付ける）', None)
box('client', 100, 1100, 620, 100, 'createEmulator（js/src/browser/index.mjs）', '要求に番号を付け、Worker の応答を待つ（pending）。stats（requests・skippedMs）と onCall', 'js', code='codec.mjs: u32 個数 + (u32 長さ, バイト列) × n')

# service worker
box('sw', 820, 480, 220, 170, 'mockServiceWorker.js', 'ページの fetch を横取りし、MessageChannel でページの MSW に渡す。応答はページから返す', 'msw')

# web worker
box('wjs', 880, 1100, 240, 100, 'worker.mjs + core.mjs', 'init：compileStreaming → instantiate。request：handleFrame() を 1 件ずつ順に', 'wasm')
box('wasi', 880, 1290, 240, 140, 'wasi.mjs（WASI シム）', '仮想時計：sleep で待たずに時計を進める。fd_write → onLog。random_get。ファイルはなし（ENOSYS）', 'js')
container('wasm', 1160, 1070, 530, 650, 'aws-emulator.wasm（crates/wasm-host、Rust → wasm32-wasip1）', '#654ff0', '#ffffff', dashed=True, img='wasm')
box('abi', 1190, 1100, 470, 100, 'C ABI（lib.rs）', '要求の frame を書き込み → 処理 → 応答の frame を読む。tick で後回しのタスクを進める', 'rust', code='emu_alloc → emu_handle → emu_response_ptr / _len → emu_tick')
box('runtime', 1190, 1240, 470, 90, 'decode_request と tokio', 'http::Request を作り、current_thread の runtime で block_on', 'rust')
box('router', 1190, 1370, 470, 80, 'MultiServiceRouter（smithy-server-runtime）', 'X-Amz-Target と URL でサービスを選ぶ。署名は確かめない', 'rust')
container('svcs', 1190, 1485, 470, 125, 'EmulatedService × 13', '#c4b5fd', '#faf5ff')
box('ddb', 1205, 1522, 120, 72, 'DynamoDB', 'Todo', 'dynamodb', small=True)
box('s3', 1333, 1522, 86, 72, 'S3', 'メモ', 's3', small=True)
box('sqs', 1427, 1522, 104, 72, 'SQS', '変更の記録', 'sqs', small=True)
box('others', 1539, 1522, 110, 72, 'ほか 10', 'STS・IAM・KMS ほか（依存先）', small=True)
box('engine', 1190, 1640, 470, 60, 'InMemoryEngine', '状態はメモリの中だけ。再読み込みで消える', 'rust')

# notes
note('legend', 1170, 420, 520, 250,
     '<b style="font-size:13px">凡例</b><br>'
     '<span style="color:#171717">━━▶</span> 呼び出し（応答は同じ道を逆にたどる）<br>'
     '<span style="color:#8f8f8f">╍╍▶</span> 静的ファイルの配信<br>'
     '<span style="color:#8f8f8f">━━▶</span> CI の流れ<br>'
     '<span style="color:#0068d6">┈┈▶</span> 呼び出しのログ（画面の「SDK の呼び出し」）<br><br>'
     '<b>色</b>：<span style="color:#3b82f6">青</span> メインスレッド　<span style="color:#ff6a33">橙</span> Service Worker　'
     '<span style="color:#7c3aed">紫</span> Web Worker<br><br>'
     'ネットワークに出るのは静的ファイルの取得だけです。DynamoDB・S3・SQS への呼び出しは、すべて同じタブの中で終わります。')
note('facts', 1170, 700, 520, 310,
     '<b style="font-size:13px">数字で見る</b><br>'
     '・wasm：約 27 MB。GitHub Pages は gzip で約 9 MB を送る<br>'
     '・起動時の準備で SDK を 13 回呼ぶ（テーブル・バケット・キューの作成と初期データ 3 件、最初の一覧と変更の記録）<br>'
     '・Todo を 1 件追加すると SDK を 6 回呼ぶ<br>'
     '　PutItem・SendMessage（追加）<br>'
     '　Scan（一覧の読み直し）<br>'
     '　ReceiveMessage・DeleteMessageBatch・ReceiveMessage（変更の記録を空になるまで受信）<br>'
     '・CreateTable の直後の DescribeTable は、3 秒の CREATING を仮想時計で飛ばす')
note('steps', 90, 1250, 650, 470,
     '<b style="font-size:13px">Todo を 1 件追加したときの流れ</b><br><br>'
     '1. React が <code>POST api/todos</code> を fetch する<br>'
     '2. Service Worker が横取りし、ページの MSW に渡す<br>'
     '3. MSW のハンドラが <code>backend.create()</code> を呼ぶ<br>'
     '4. backend.js が SDK で PutItem（DynamoDB）と SendMessage（SQS）を送る<br>'
     '5. SDK が要求を直列化・署名し、WasmRequestHandler に渡す<br>'
     '6. createEmulator が frame に詰め、postMessage で Worker に移す<br>'
     '7. worker.mjs が C ABI（emu_handle）を呼び、wasm の中の router がサービスへ振り分ける<br>'
     '8. 応答の frame が同じ道を逆に戻り、fetch の Response になる<br>'
     '9. 画面は一覧（GET api/todos）と変更の記録（GET api/activity）を読み直す<br>'
     '10. 最後に GET api/emulator で、呼び出しの回数とログを受け取る', fill='#ffffff')

# ---------------------------------------------------------------- arrows
edge('upstream', 'bottom', 'build', 'top', 650, 'sparse checkout', 'ci')
edge('repo', 'right', 'build', 'left', 170, 'push', 'ci')
edge('build', 'right', 'bjob', 'left', 170, 'wasm', 'ci')
edge('bjob', 'right', 'deploy', 'left', 170, 'demo/dist', 'ci')
edge('deploy', 'bottom', 'pages', 'top', 1525, '公開', 'ci')

edge('pages', 'bottom', 'react', 'top', 320, 'index.html・assets/*.js・フォント', 'deliver')
edge('pages', 'bottom', 'sw', 'top', 930, 'mockServiceWorker.js', 'deliver')
edge('pages', 'bottom', 'wjs', 'top', 1100, 'aws-emulator.wasm', 'deliver')

edge('react', 'right', 'sw', 'left', 520, "fetch('api/…')")
edge('sw', 'left', 'handlers', 'right', 630, '転送', pos=0.4)
edge('handlers', 'bottom', 'backend', 'top', 320)
edge('backend', 'bottom', 'sdk', 'top', 320)
edge('sdk', 'bottom', 'wrh', 'top', 320)
edge('wrh', 'bottom', 'client', 'top', 320)
edge('client', 'right', 'wjs', 'left', 1150, 'postMessage', pos=0.5)
edge('wjs', 'right', 'abi', 'left', 1150)
edge('wjs', 'bottom', 'wasi', 'top', 1000, 'createWasi()')
edge('runtime', 'left', 'wasi', 'right', 1310, 'WASI', pos=0.43)
edge('abi', 'bottom', 'runtime', 'top', 1425)
edge('runtime', 'bottom', 'router', 'top', 1425)
edge('router', 'bottom', 'svcs', 'top', 1425)
edge('svcs', 'bottom', 'engine', 'top', 1425)
edge('client', 'top', 'calls', 'bottom', 640, 'onCall', 'log')
edge('calls', 'top', 'handlers', 'bottom', 640, 'GET api/emulator', 'log')


# ---------------------------------------------------------------- checks
def inside(id):
    """Boxes drawn inside container `id`."""
    cx, cy, cw, ch, _ = boxes[id]
    return {
        b for b, (x, y, w, h, _) in boxes.items()
        if b != id and x >= cx and y >= cy and x + w <= cx + cw and y + h <= cy + ch
    }


def crosses(seg, rect, pad=0.5):
    (x1, y1), (x2, y2) = seg
    x, y, w, h = rect
    lo_x, hi_x = sorted((x1, x2))
    lo_y, hi_y = sorted((y1, y2))
    return lo_x < x + w - pad and hi_x > x + pad and lo_y < y + h - pad and hi_y > y + pad


problems = []
for id, src, dst, p1, p2, text, pos in edges:
    if p1[0] != p2[0] and p1[1] != p2[1]:
        problems.append(f'{id} {src}->{dst} is not straight: {p1} {p2}')
    # Containers that hold src or dst may be crossed (the arrow enters them); others may not.
    allowed = {src, dst} | {c for c, b in boxes.items() if b[4] == 'container'}
    for b, (x, y, w, h, kind) in boxes.items():
        if b in allowed:
            continue
        if crosses((p1, p2), (x, y, w, h)):
            problems.append(f'{id} {src}->{dst} runs across {b}')
    if text:
        # A label is centred on the arrow: about 7 px per Latin character, 12 per Japanese one.
        width = sum(12 if ord(ch) > 0x2000 else 6.5 for ch in text) + 6
        t = (pos + 1) / 2
        mx, my = p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t
        rect = (mx - width / 2, my - 8, width, 16)
        lx1, ly1, lx2, ly2 = rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]
        for b, (x, y, w, h, kind) in boxes.items():
            if kind == 'container':
                # A label sits wholly inside or wholly outside a container, never on its border.
                whole_in = lx1 >= x and lx2 <= x + w and ly1 >= y and ly2 <= y + h
                whole_out = lx2 <= x or lx1 >= x + w or ly2 <= y or ly1 >= y + h
                if not (whole_in or whole_out):
                    problems.append(f'{id} label "{text}" sits on the border of {b}')
                continue
            if crosses(((lx1, ly1), (lx2, ly2)), (x, y, w, h)):
                problems.append(f'{id} label "{text}" overlaps {b}')
# Boxes must not overlap each other unless one contains the other.
ids = list(boxes)
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        ax, ay, aw, ah, ak = boxes[a]
        bx, by, bw, bh, bk = boxes[b]
        if b in inside(a) or a in inside(b):
            continue
        if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
            problems.append(f'{a} overlaps {b}')
if problems:
    sys.exit('\n'.join(problems))

xml = (
    '<mxfile host="aws-emulator-wasm" type="device">'
    '<diagram id="architecture" name="内部のアーキテクチャ">'
    '<mxGraphModel dx="1800" dy="1800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" '
    'page="0" pageScale="1" pageWidth="1760" pageHeight="1800" math="0" shadow="0" background="#ffffff">'
    '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' + ''.join(cells) + '</root></mxGraphModel></diagram></mxfile>\n'
)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(xml)
print(f'{OUT.relative_to(ROOT)}: {len(boxes)} boxes, {len(edges)} arrows, all straight, no crossings')
