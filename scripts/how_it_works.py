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
R = "rounded=0;"                                # square corners, for every frame and box
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


def frame(d, label, x, y, w, h, stroke, fill, dashed=False, icon=None):
    """A titled frame. icon: an image name, or 'aws' for the AWS Cloud group's own logo."""
    if icon == "aws":
        shape = "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;spacingLeft=34;spacingTop=4;"
    elif icon:
        shape = (f"shape=label;image={img(icon)};imageWidth=26;imageHeight=26;imageAlign=left;imageVerticalAlign=top;"
                 f"spacingLeft=34;spacingTop=4;")
    else:
        shape = "spacingLeft=16;spacingTop=8;"
    style = (f"{R}{shape}html=1;whiteSpace=wrap;fillColor={fill};strokeColor={stroke};strokeWidth=2;dashed={int(dashed)};"
             f"fontSize=18;fontStyle=1;fontColor={INK};{FONT}align=left;verticalAlign=top;points=[];")
    return d.vertex(label, x, y, w, h, style)


def edge(d, src, dst, label="", color=C.BLUE, **kw):
    return d.edge(src, dst, label, color=color, extra=f"fontSize={EDGE_FONT};strokeWidth=2.5;{FONT}", **kw)


d = Diagram(name="How it works", page_w=1500, page_h=1110)

# Two mirrored rows on shared columns: MSW and Lambda in one column, Hono in the next, the
# services in the last. React sits between the rows and switches between them.
X_REACT = 200
REACT_CX = X_REACT + LOGO / 2
X1 = 440                          # MSW / Lambda
X2 = 730                          # Hono
X1C, X2C = X1 + LOGO / 2, X2 + LOGO / 2
SVC_X = 1240
TOP = [210, 300, 390]             # emulator rows
BOT = [790, 860, 930, 1000]       # AWS rows
AY1 = TOP[1]
AY2 = (BOT[0] + BOT[-1]) / 2
REACT_Y = (AY1 + AY2) / 2

# ---------------------------------------------------------------- the browser tab
tab = frame(d, "Browser tab", 40, 110, 1420, 560, FRAME, "#F8FAFC", icon="browser")
pages = logo(d, "<b>GitHub Pages</b>  static files", X1 + 10, 12, "github", size=52, label_at="right")
react = logo(d, "<b>React</b><br>the page", X_REACT, REACT_Y - LOGO / 2, "react", label_at="right")
msw = logo(d, "<b>MSW</b><br>Service Worker", X1, AY1 - LOGO / 2, "mockserviceworker")
hono = logo(d, "<b>Hono API</b><br>+ AWS SDK v3", X2, AY1 - LOGO / 2, "hono")

frame(d, "Web Worker", 920, 140, 520, 320, "#7C3AED", "#F5F3FF")
wasm = d.vertex("<b>AWS Emulator</b><br>Rust → wasm", 950, TOP[0] - 30, 170, TOP[-1] - TOP[0] + 60,
                f"shape=label;{R}html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor=#654FF0;strokeWidth=2;"
                f"fontSize={LABEL_FONT};fontColor={INK};{FONT}image={img('webassembly')};imageWidth=64;imageHeight=64;"
                f"imageAlign=center;imageVerticalAlign=top;spacingTop=88;verticalAlign=top;align=center;")
emu = [
    aws(d, "<b>DynamoDB</b>", SVC_X, TOP[0] - ICON / 2, "dynamodb", C.DATABASE),
    aws(d, "<b>S3</b>", SVC_X, TOP[1] - ICON / 2, "s3", C.STORAGE),
    aws(d, "<b>SQS</b>", SVC_X, TOP[2] - ICON / 2, "sqs", C.MGMT),
]

# ---------------------------------------------------------------- AWS
frame(d, "AWS Cloud", 40, 720, 1420, 370, INK, "#FFFFFF", icon="aws")
frame(d, "Lambda Web Function", 380, 750, 500, 310, C.COMPUTE, "#FFF7ED", dashed=True)
lam = aws(d, "<b>Lambda</b><br>Node.js 24", X1C - ICON / 2, AY2 - ICON / 2, "lambda", C.COMPUTE, label_at="bottom")
api = d.vertex("<b>the same Hono API</b><br>+ AWS SDK v3", X2C - 85, BOT[0] - 30, 170, BOT[-1] - BOT[0] + 60,
               f"shape=label;{R}html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor={C.COMPUTE};strokeWidth=2;"
               f"fontSize={LABEL_FONT};fontColor={INK};{FONT}image={img('hono')};imageWidth=64;imageHeight=64;"
               f"imageAlign=center;imageVerticalAlign=top;spacingTop=88;verticalAlign=top;align=center;")
cloud = [
    aws(d, "<b>DynamoDB</b>", SVC_X, BOT[0] - ICON / 2, "dynamodb", C.DATABASE),
    aws(d, "<b>S3</b>", SVC_X, BOT[1] - ICON / 2, "s3", C.STORAGE),
    aws(d, "<b>SQS</b>", SVC_X, BOT[2] - ICON / 2, "sqs", C.MGMT),
    aws(d, "<b>Cognito</b>", SVC_X, BOT[3] - ICON / 2, "cognito", C.SECURITY),
]

# ---------------------------------------------------------------- lines
edge(d, pages, tab, color=FRAME, out="B", into="T", into_at=d.frac_x(tab, X1 + 36), dashed=True)

# The switch: up to the in-browser path, down to AWS (one bend each).
edge(d, react, msw, "<b>VITE_API_URL unset</b>", out="T", into="L")
edge(d, msw, hono, "fetch('/api/todos')")
edge(d, hono, wasm, "postMessage", into_at=d.frac_y(wasm, AY1), label_pos=-0.35)
for svc, y in zip(emu, TOP):
    edge(d, wasm, svc, color=INK, at=d.frac_y(wasm, y))

edge(d, react, lam, "<b>VITE_API_URL set</b><br>HTTPS + Cognito token", out="B", into="L")
edge(d, lam, api, "runs", into_at=d.frac_y(api, AY2))
for svc, y in zip(cloud[:3], BOT[:3]):
    edge(d, api, svc, color=INK, at=d.frac_y(api, y))
edge(d, api, cloud[3], "verify token", color=C.SECURITY, dashed=True, at=d.frac_y(api, BOT[3]))

d.write(ROOT / "docs/architecture/how-it-works.drawio")
