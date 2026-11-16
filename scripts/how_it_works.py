"""The README's "How it works" diagram: static files from GitHub Pages, then everything in
one browser tab. Same level of detail as the page's own diagram (demo/src/Architecture.jsx).

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


def img(name):
    return "data:image/svg+xml," + base64.b64encode((ICONS / f"{name}.svg").read_bytes()).decode()


def logo(d, label, x, y, name, size=56, label_at="bottom"):
    """A Simple Icons logo with its label, like d.icon()."""
    pos = {
        "bottom": "verticalLabelPosition=bottom;verticalAlign=top;align=center;",
        "right": "labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=10;",
    }[label_at]
    style = (f"shape=image;html=1;whiteSpace=nowrap;aspect=fixed;imageAspect=0;image={img(name)};"
             f"fontSize=12;fontColor=#232F3E;{pos}")
    return d.vertex(label, x, y, size, size, style)


INK = "#232F3E"
FRAME = "#8F8F8F"
S = 56                 # logo size
AY = 340               # the request path: centre y of every step
STEP_Y = AY - S / 2
X_REACT, X_MSW, X_HONO = 140, 420, 700

d = Diagram(name="How it works", page_w=1500, page_h=700)

# GitHub Pages, straight above React: one download of static files.
pages = logo(d, "<b>GitHub Pages</b><br>static files only", X_REACT, 40, "github", label_at="right")

tab = d.box("<b>Browser tab</b>", 40, 170, 1420, 500, fill="#FAFAFA", stroke=FRAME, align="left", valign="top", font=13)

react = logo(d, "<b>React</b><br>the page", X_REACT, STEP_Y, "react")
msw = logo(d, "<b>MSW</b><br>Service Worker", X_MSW, STEP_Y, "mockserviceworker")
hono = logo(d, "<b>Hono API</b><br>+ AWS SDK v3", X_HONO, STEP_Y, "hono")

# The Web Worker: the wasm emulator, a tall box so that every service gets a straight line.
worker = d.box("<b>Web Worker</b>", 920, 196, 520, 290, fill="#F5F3FF", stroke="#7C3AED", align="left", valign="top", font=13)
SVC_YS = [AY - 100, AY, AY + 100]
wasm = d.vertex(
    "<b>aws-emulator.wasm</b><br>AWS Emulator<br>(Rust → wasm32-wasip1)",
    960, SVC_YS[0] - 12, 200, SVC_YS[2] - SVC_YS[0] + 24 + 20,
    f"shape=label;rounded=1;arcSize=6;html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor=#654FF0;fontSize=12;"
    f"fontColor={INK};image={img('webassembly')};imageWidth=40;imageHeight=40;imageAlign=center;imageVerticalAlign=top;"
    f"spacingTop=56;verticalAlign=top;align=center;",
)
services = [
    d.icon("<b>DynamoDB</b><br>todos", 1250, SVC_YS[0] - 24, "dynamodb", C.DATABASE, label_at="right"),
    d.icon("<b>S3</b><br>notes", 1250, SVC_YS[1] - 24, "s3", C.STORAGE, label_at="right"),
    d.icon("<b>SQS</b><br>change log", 1250, SVC_YS[2] - 24, "sqs", C.MGMT, label_at="right"),
]

# OPFS: the browser's own storage, under the emulator.
opfs = d.vertex(
    "<b>OPFS</b><br>snapshots of the wasm memory",
    1010, 570, 100, 70,
    f"shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=10;fillColor=#FFFFFF;strokeColor={FRAME};"
    f"fontSize=11;fontColor={INK};labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=10;",
)

d.edge(pages, react, "HTML, JS, wasm", color=FRAME, out="B", into="T", dashed=True, label_pos=-0.55)
d.edge(react, msw, "fetch('/api/todos')", color=C.BLUE)
d.edge(msw, hono, "forward", color=C.BLUE)
d.edge(hono, wasm, "postMessage", color=C.BLUE, into_at=d.frac_y(wasm, AY))
for svc, y in zip(services, SVC_YS):
    d.edge(wasm, svc, color=INK, at=d.frac_y(wasm, y))
d.edge(wasm, opfs, "save / restore", color=FRAME, out="B", into="T", dashed=True, label_pos=0.6, label_offset=(56, 0))

d.text("After the one download, every request stays in the tab: nothing is sent to a server.",
       70, 610, 760, 24, size=12, color="#545B64")

d.write(ROOT / "docs/architecture/how-it-works.drawio")
