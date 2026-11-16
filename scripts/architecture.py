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
box('upstream', 470, 20, 360, 64, 'Upstream aws/aws-emulator', 'Rust, pinned to commit 813af48 (not vendored here)', 'rust')
box('repo', 40, 120, 330, 100, 'This repository', 'scripts/, patches/, crates/wasm-host, js/, demo/', 'github')
box('build', 470, 120, 360, 100, 'CI: build job', 'fetch-upstream.sh (sparse checkout) → patch_wasm.py → cargo build --target wasm32-wasip1 → wasm-opt -Oz → Node tests', 'actions')
box('bjob', 930, 120, 330, 100, 'CI: browser job', 'vite build (BASE_PATH=/aws-emulator-wasm/) → API tests → Playwright (Chromium, desktop and mobile)', 'actions')
box('deploy', 1360, 120, 330, 100, 'CI: deploy job', 'actions/deploy-pages', 'actions')
box('pages', 40, 270, 1660, 56, 'GitHub Pages', 'Static files only. There is no API server', 'pages')

# ---------------------------------------------------------------- the browser
container('browser', 20, 370, 1700, 1390, 'Browser (one tab)', '#a3a3a3', '#fafafa')
container('main', 50, 420, 730, 1320, 'Main thread', '#3b82f6', '#eff6ff')
container('swlane', 800, 420, 260, 250, 'Service Worker', '#ff6a33', '#fff4ed')
container('worker', 800, 1040, 905, 700, 'Web Worker (name: aws-emulator)', '#7c3aed', '#f5f3ff')

# main thread
box('react', 100, 480, 440, 80, 'React UI', 'App.jsx, CallLog.jsx, Architecture.jsx', 'react', code="fetch('api/todos', …)")
box('handlers', 100, 590, 620, 80, 'MSW handlers (mocks/handlers.js)', 'Registered by setupWorker(...handlers) in main.jsx. Hands api/* to the Hono app as is: app.fetch(request)', 'msw')
box('backend', 100, 710, 440, 80, 'Hono API (demo/api/, same code as the Web Function)', 'app.js: routes and errors. todos.js: SDK calls. provision.js: resources and seeds, once', 'js', code='createApp({ docs, s3, sqs, table, bucket, queueUrl })')
box('sdk', 100, 830, 440, 110, 'AWS SDK v3 clients (emulator.js)', 'Middleware: serialize → SigV4 sign (dummy keys) → no retries (maxAttempts: 1)', 'js', code='DynamoDBClient + DocumentClient, S3Client, SQSClient')
box('wrh', 100, 980, 440, 80, 'WasmRequestHandler (js/src/handler.mjs)', 'Replaces the SDK requestHandler; nothing goes out over HTTP', 'js', code='HttpRequest → { method, url, headers, body }')
box('calls', 560, 980, 160, 80, 'calls.js', 'Call log, tagged by API route', None)
box('client', 100, 1100, 620, 100, 'createEmulator (js/src/browser/index.mjs)', 'Numbers each request and waits for the Worker (pending). stats (requests, skippedMs) and onCall', 'js', code='codec.mjs: u32 count + (u32 length, bytes) × n')

# service worker
box('sw', 820, 480, 220, 170, 'mockServiceWorker.js', 'Intercepts the page fetch and passes it to MSW in the page over a MessageChannel; the page answers', 'msw')

# web worker
box('wjs', 880, 1100, 240, 100, 'worker.mjs + core.mjs', 'init: compileStreaming → instantiate. request: handleFrame(), one at a time', 'wasm')
box('wasi', 880, 1290, 240, 140, 'wasi.mjs (WASI shim)', 'Virtual clock: sleep advances time instead of waiting. fd_write → onLog. random_get. No files (ENOSYS)', 'js')
container('wasm', 1160, 1070, 530, 650, 'aws-emulator.wasm (crates/wasm-host, Rust → wasm32-wasip1)', '#654ff0', '#ffffff', dashed=True, img='wasm')
box('abi', 1190, 1100, 470, 100, 'C ABI (lib.rs)', 'Write the request frame → handle → read the response frame. tick runs deferred tasks', 'rust', code='emu_alloc → emu_handle → emu_response_ptr / _len → emu_tick')
box('runtime', 1190, 1240, 470, 90, 'decode_request and tokio', 'Builds an http::Request and runs it with block_on on a current_thread runtime', 'rust')
box('router', 1190, 1370, 470, 80, 'MultiServiceRouter (smithy-server-runtime)', 'Picks the service by X-Amz-Target and URL. Signatures are not checked', 'rust')
container('svcs', 1190, 1485, 470, 125, 'EmulatedService × 13', '#c4b5fd', '#faf5ff')
box('ddb', 1205, 1522, 120, 72, 'DynamoDB', 'Todos', 'dynamodb', small=True)
box('s3', 1333, 1522, 86, 72, 'S3', 'Notes', 's3', small=True)
box('sqs', 1427, 1522, 104, 72, 'SQS', 'Change log', 'sqs', small=True)
box('others', 1539, 1522, 110, 72, '10 more', 'STS, IAM, KMS… (dependencies)', small=True)
box('engine', 1190, 1640, 470, 60, 'InMemoryEngine', 'State lives in wasm memory (snapshotted to OPFS with persist)', 'rust')

# notes
note('legend', 1170, 420, 520, 250,
     '<b style="font-size:13px">Legend</b><br>'
     '<span style="color:#171717">━━▶</span> Call (the response takes the same path back)<br>'
     '<span style="color:#8f8f8f">╍╍▶</span> Static file delivery<br>'
     '<span style="color:#8f8f8f">━━▶</span> CI flow<br>'
     '<span style="color:#0068d6">┈┈▶</span> Call log (the “SDK calls” panel)<br><br>'
     '<b>Colors</b>: <span style="color:#3b82f6">blue</span> main thread, <span style="color:#ff6a33">orange</span> Service Worker, '
     '<span style="color:#7c3aed">purple</span> Web Worker<br><br>'
     'Only the static files come over the network. Every call to DynamoDB, S3 and SQS stays inside the tab.')
note('facts', 1170, 700, 520, 310,
     '<b style="font-size:13px">By the numbers</b><br>'
     '• wasm: about 27 MB; GitHub Pages sends about 9 MB with gzip<br>'
     '• Start-up makes 13 SDK calls (table, bucket, queue, 3 seed todos, then the first list and change log)<br>'
     '• Adding a todo makes 6 SDK calls:<br>'
     '&nbsp;&nbsp;PutItem, SendMessage (the change)<br>'
     '&nbsp;&nbsp;Scan (reload the list)<br>'
     '&nbsp;&nbsp;ReceiveMessage, DeleteMessageBatch, ReceiveMessage (drain the change log)<br>'
     '• DescribeTable right after CreateTable skips the 3-second CREATING state on the virtual clock')
note('steps', 90, 1250, 650, 470,
     '<b style="font-size:13px">What happens when you add a todo</b><br><br>'
     '1. React fetches <code>POST api/todos</code><br>'
     '2. The Service Worker intercepts it and passes it to MSW in the page<br>'
     '3. The MSW handler calls the Hono app: <code>app.fetch(request)</code><br>'
     '4. api/todos.js sends PutItem (DynamoDB) and SendMessage (SQS) with the SDK<br>'
     '5. The SDK serializes and signs the request and hands it to WasmRequestHandler<br>'
     '6. createEmulator packs it into a frame and transfers it to the Worker<br>'
     '7. worker.mjs calls the C ABI (emu_handle); the router in the wasm dispatches it<br>'
     '8. The response frame goes back the same way and becomes the fetch Response<br>'
     '9. The page reloads the list (GET api/todos) and the change log (GET api/activity)<br>'
     '10. Finally, GET api/emulator returns the call count and the call log', fill='#ffffff')

# ---------------------------------------------------------------- arrows
edge('upstream', 'bottom', 'build', 'top', 650, 'sparse checkout', 'ci')
edge('repo', 'right', 'build', 'left', 170, 'push', 'ci')
edge('build', 'right', 'bjob', 'left', 170, 'wasm', 'ci')
edge('bjob', 'right', 'deploy', 'left', 170, 'demo/dist', 'ci')
edge('deploy', 'bottom', 'pages', 'top', 1525, 'publish', 'ci')

edge('pages', 'bottom', 'react', 'top', 320, 'index.html, assets/*.js, fonts', 'deliver')
edge('pages', 'bottom', 'sw', 'top', 930, 'mockServiceWorker.js', 'deliver')
edge('pages', 'bottom', 'wjs', 'top', 1100, 'aws-emulator.wasm', 'deliver')

edge('react', 'right', 'sw', 'left', 520, "fetch('api/…')")
edge('sw', 'left', 'handlers', 'right', 630, 'forward', pos=0.4)
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
    '<diagram id="architecture" name="Internal architecture">'
    '<mxGraphModel dx="1800" dy="1800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" '
    'page="0" pageScale="1" pageWidth="1760" pageHeight="1800" math="0" shadow="0" background="#ffffff">'
    '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' + ''.join(cells) + '</root></mxGraphModel></diagram></mxfile>\n'
)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(xml)
print(f'{OUT.relative_to(ROOT)}: {len(boxes)} boxes, {len(edges)} arrows, all straight, no crossings')
