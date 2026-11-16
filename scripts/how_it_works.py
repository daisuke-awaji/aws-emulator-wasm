"""The README's "How it works" diagram: one page and one Hono API, run two ways.

  VITE_API_URL unset: React -> MSW -> Hono API -> aws-emulator.wasm (Web Worker), in the tab
  VITE_API_URL set:   React -> HTTPS + Cognito token -> Lambda Web Function (the same Hono API)
                      -> DynamoDB, S3, SQS

Kept to what a reader takes in at a glance: large icons and type, one corner radius for
every frame and box, and straight lines only. The file-by-file view is architecture.drawio.

usage: python3 scripts/how_it_works.py
  -> docs/architecture/how-it-works.drawio
Then lint and export with the drawio-diagram skill:
  python3 ~/.claude/skills/drawio-diagram/scripts/lint_drawio.py docs/architecture/how-it-works.drawio
  bash ~/.claude/skills/drawio-diagram/scripts/export.sh docs/architecture/how-it-works.drawio docs/img/how-it-works.png
"""
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/drawio-diagram/scripts"))
from drawio_lib import Diagram, C  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "docs/architecture/icons"
INK = "#232F3E"
MUTED = "#5F6B7A"
FRAME = "#9CA3AF"
FONT = "fontFamily=Helvetica;"
R = "rounded=1;absoluteArcSize=1;arcSize=24;"   # the one corner radius, for every frame and box
LOGO = 72                                       # logo and icon size
ICON = 60
LABEL_FONT = 16
EDGE_FONT = 15

LABEL = {
    "bottom": "verticalLabelPosition=bottom;verticalAlign=top;align=center;spacingTop=4;",
    "right": "labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=14;",
    "left": "labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle;spacingRight=14;",
}


def img(name):
    return "data:image/svg+xml," + base64.b64encode((ICONS / f"{name}.svg").read_bytes()).decode()


def logo(d, label, x, y, name, size=LOGO, label_at="bottom"):
    style = (f"shape=image;html=1;whiteSpace=nowrap;aspect=fixed;imageAspect=0;image={img(name)};"
             f"fontSize={LABEL_FONT};fontColor={INK};{FONT}{LABEL[label_at]}")
    return d.vertex(label, x, y, size, size, style)


def aws(d, label, x, y, res, color, size=ICON, label_at="right"):
    style = (f"sketch=0;outlineConnect=0;fontColor={INK};gradientColor=none;fillColor={color};strokeColor=#ffffff;"
             f"dashed=0;html=1;whiteSpace=nowrap;fontSize={LABEL_FONT};{FONT}aspect=fixed;shape=mxgraph.aws4.resourceIcon;"
             f"resIcon=mxgraph.aws4.{res};{LABEL[label_at]}")
    return d.vertex(label, x, y, size, size, style)


def frame(d, label, x, y, w, h, stroke, fill, dashed=False):
    style = (f"{R}html=1;whiteSpace=wrap;fillColor={fill};strokeColor={stroke};strokeWidth=2;dashed={int(dashed)};"
             f"fontSize=18;fontStyle=1;fontColor={INK};{FONT}align=left;verticalAlign=top;spacingLeft=16;spacingTop=8;")
    return d.vertex(label, x, y, w, h, style)


def edge(d, src, dst, label="", color=C.BLUE, **kw):
    return d.edge(src, dst, label, color=color, extra=f"fontSize={EDGE_FONT};strokeWidth=2.5;{FONT}", **kw)


d = Diagram(name="How it works", page_w=1500, page_h=1010)

# Shared layout: the page on the left, the services in one column on the right.
X_REACT = 200
REACT_CX = X_REACT + LOGO / 2
SVC_X = 1240

# ---------------------------------------------------------------- GitHub Pages
pages = logo(d, "<b>GitHub Pages</b>  static files", X_REACT + 8, 24, "github", size=56, label_at="right")

# ---------------------------------------------------------------- the browser tab
frame(d, "Browser tab", 40, 130, 1420, 410, FRAME, "#F8FAFC")
AY = 350
react = logo(d, "<b>React</b><br>the page", X_REACT, AY - LOGO / 2, "react", label_at="left")
msw = logo(d, "<b>MSW</b><br>Service Worker", 500, AY - LOGO / 2, "mockserviceworker")
hono = logo(d, "<b>Hono API</b><br>+ AWS SDK v3", 760, AY - LOGO / 2, "hono")

frame(d, "Web Worker", 980, 160, 460, 356, "#7C3AED", "#F5F3FF")
EMU = [AY - 92, AY, AY + 92]
wasm = d.vertex("<b>AWS Emulator</b><br>Rust → wasm", 1010, EMU[0] - 40, 170, EMU[2] - EMU[0] + 80,
                f"shape=label;{R}html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor=#654FF0;strokeWidth=2;"
                f"fontSize={LABEL_FONT};fontColor={INK};{FONT}image={img('webassembly')};imageWidth=64;imageHeight=64;"
                f"imageAlign=center;imageVerticalAlign=top;spacingTop=96;verticalAlign=top;align=center;")
emu = [
    aws(d, "<b>DynamoDB</b>", SVC_X, EMU[0] - ICON / 2, "dynamodb", C.DATABASE),
    aws(d, "<b>S3</b>", SVC_X, EMU[1] - ICON / 2, "s3", C.STORAGE),
    aws(d, "<b>SQS</b>", SVC_X, EMU[2] - ICON / 2, "sqs", C.MGMT),
]

# ---------------------------------------------------------------- AWS
frame(d, "AWS Cloud", 40, 620, 1420, 370, INK, "#FFFFFF")
AWS = [710, 785, 860, 935]
fn = d.vertex("", 120, AWS[0] - 44, 760, AWS[3] - AWS[0] + 88,
              f"{R}html=1;whiteSpace=wrap;fillColor=#FFF7ED;strokeColor={C.COMPUTE};strokeWidth=2;")
# Inside the function: the Lambda icon under the incoming line, and the same Hono logo as above.
lam = aws(d, "<b>Lambda Web Function</b><br>Node.js 24", REACT_CX - ICON / 2, (AWS[0] + AWS[3]) / 2 - ICON / 2, "lambda", C.COMPUTE)
same = logo(d, "<b>the same Hono API</b><br>+ AWS SDK v3", 760, (AWS[0] + AWS[3]) / 2 - LOGO / 2 - 18, "hono")
cloud = [
    aws(d, "<b>DynamoDB</b>", SVC_X, AWS[0] - ICON / 2, "dynamodb", C.DATABASE),
    aws(d, "<b>S3</b>", SVC_X, AWS[1] - ICON / 2, "s3", C.STORAGE),
    aws(d, "<b>SQS</b>", SVC_X, AWS[2] - ICON / 2, "sqs", C.MGMT),
    aws(d, "<b>Cognito</b>", SVC_X, AWS[3] - ICON / 2, "cognito", C.SECURITY),
]

# ---------------------------------------------------------------- lines
edge(d, pages, react, color=FRAME, out="B", into="T", dashed=True)

edge(d, react, msw, "<b>VITE_API_URL unset</b><br>fetch('/api/todos')", label_pos=-0.05)
edge(d, msw, hono)
edge(d, hono, wasm, "postMessage", into_at=d.frac_y(wasm, AY))
for svc, y in zip(emu, EMU):
    edge(d, wasm, svc, color=INK, at=d.frac_y(wasm, y))

edge(d, react, fn, "<b>VITE_API_URL set</b><br>HTTPS + Cognito token", out="B", into="T",
     into_at=d.frac_x(fn, REACT_CX), label_pos=-0.2)
for svc, y in zip(cloud[:3], AWS[:3]):
    edge(d, fn, svc, color=INK, at=d.frac_y(fn, y))
edge(d, fn, cloud[3], "verify token", color=C.SECURITY, dashed=True, at=d.frac_y(fn, AWS[3]))

d.write(ROOT / "docs/architecture/how-it-works.drawio")
