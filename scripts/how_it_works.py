"""The README's "How it works" diagram: the same page and the same Hono API, run two ways.

  VITE_API_URL unset: React -> MSW -> Hono API + AWS SDK v3 -> aws-emulator.wasm (Web Worker),
                      all in one browser tab
  VITE_API_URL set:   React -> HTTPS with a Cognito access token -> Lambda Web Function
                      (the same Hono API) -> DynamoDB, S3, SQS in AWS

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
FRAME = "#8F8F8F"


def img(name):
    return "data:image/svg+xml," + base64.b64encode((ICONS / f"{name}.svg").read_bytes()).decode()


LABEL = {
    "bottom": "verticalLabelPosition=bottom;verticalAlign=top;align=center;",
    "right": "labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=10;",
    "left": "labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle;spacingRight=10;",
}


def logo(d, label, x, y, name, size=56, label_at="bottom"):
    """A Simple Icons logo with its label, like d.icon()."""
    style = (f"shape=image;html=1;whiteSpace=nowrap;aspect=fixed;imageAspect=0;image={img(name)};"
             f"fontSize=12;fontColor={INK};{LABEL[label_at]}")
    return d.vertex(label, x, y, size, size, style)


def tall(d, label, x, y, w, h, stroke, image=None):
    """A tall box that several straight lines can leave from, with an optional logo on top."""
    pic = (f"image={img(image)};imageWidth=40;imageHeight=40;imageAlign=center;imageVerticalAlign=top;spacingTop=56;"
           if image else "spacingTop=64;")
    style = (f"shape=label;rounded=1;arcSize=6;html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor={stroke};"
             f"fontSize=12;fontColor={INK};verticalAlign=top;align=center;{pic}")
    return d.vertex(label, x, y, w, h, style)


S = 56
X_REACT, X_MSW, X_HONO = 220, 560, 860
REACT_CX = X_REACT + S / 2
SVC_X = 1410                      # both service columns line up

d = Diagram(name="How it works", page_w=1700, page_h=1190)

# ------------------------------------------------------------------ static files
pages = logo(d, "<b>GitHub Pages</b><br>static files: the page, and the wasm for the emulator build",
             X_REACT, 30, "github", label_at="right")

# ------------------------------------------------------------------ browser tab
d.box("<b>Browser tab</b>", 40, 160, 1600, 520, fill="#FAFAFA", stroke=FRAME, align="left", valign="top", font=13)
AY = 330
react = logo(d, "<b>React</b><br>the page", X_REACT, AY - S / 2, "react", label_at="left")
msw = logo(d, "<b>MSW</b><br>Service Worker", X_MSW, AY - S / 2, "mockserviceworker")
hono = logo(d, "<b>Hono API</b><br>+ AWS SDK v3", X_HONO, AY - S / 2, "hono")

d.box("<b>Web Worker</b>", 1080, 186, 520, 290, fill="#F5F3FF", stroke="#7C3AED", align="left", valign="top", font=13)
EMU_YS = [AY - 100, AY, AY + 100]
wasm = tall(d, "<b>aws-emulator.wasm</b><br>AWS Emulator<br>(Rust → wasm32-wasip1)",
            1120, EMU_YS[0] - 12, 200, EMU_YS[2] - EMU_YS[0] + 44, "#654FF0", image="webassembly")
emu_svcs = [
    d.icon("<b>DynamoDB</b><br>todos", SVC_X, EMU_YS[0] - 24, "dynamodb", C.DATABASE, label_at="right"),
    d.icon("<b>S3</b><br>notes", SVC_X, EMU_YS[1] - 24, "s3", C.STORAGE, label_at="right"),
    d.icon("<b>SQS</b><br>change log", SVC_X, EMU_YS[2] - 24, "sqs", C.MGMT, label_at="right"),
]
opfs = d.vertex(
    "<b>OPFS</b><br>snapshots of the wasm memory",
    1170, 570, 100, 70,
    f"shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=10;fillColor=#FFFFFF;strokeColor={FRAME};"
    f"fontSize=11;fontColor={INK};labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=10;",
)

# ------------------------------------------------------------------ AWS
d.group("AWS Cloud", 40, 760, 1600, 400, kind="aws_cloud")
AWS_YS = [850, 940, 1030]
COGNITO_Y = 1110
fn = tall(d, "<b>Lambda Web Function</b><br>the same Hono API + AWS SDK v3<br>(demo/api, Node 24)",
          REACT_CX - 110, AWS_YS[0] - 40, 220, COGNITO_Y - AWS_YS[0] + 80, C.COMPUTE)
d.icon("", REACT_CX - 20, AWS_YS[0] - 30, "lambda", C.COMPUTE, size=40)
aws_svcs = [
    d.icon("<b>Amazon DynamoDB</b><br>todos, per user", SVC_X, AWS_YS[0] - 24, "dynamodb", C.DATABASE, label_at="right"),
    d.icon("<b>Amazon S3</b><br>notes", SVC_X, AWS_YS[1] - 24, "s3", C.STORAGE, label_at="right"),
    d.icon("<b>Amazon SQS</b><br>change log", SVC_X, AWS_YS[2] - 24, "sqs", C.MGMT, label_at="right"),
]
cognito = d.icon("<b>Amazon Cognito</b><br>sign-in (code + PKCE)", X_HONO + 4, COGNITO_Y - 24, "cognito", C.SECURITY, label_at="right")

# ------------------------------------------------------------------ edges
d.edge(pages, react, "HTML, JS, wasm", color=FRAME, out="B", into="T", dashed=True, label_pos=-0.4)

# Emulator build (VITE_API_URL unset): everything stays in the tab.
d.edge(react, msw, "VITE_API_URL unset<br>fetch('/api/todos')", color=C.BLUE)
d.edge(msw, hono, "forward", color=C.BLUE)
d.edge(hono, wasm, "postMessage", color=C.BLUE, into_at=d.frac_y(wasm, AY))
for svc, y in zip(emu_svcs, EMU_YS):
    d.edge(wasm, svc, color=INK, at=d.frac_y(wasm, y))
d.edge(wasm, opfs, "save / restore", color=FRAME, out="B", into="T", dashed=True, label_pos=0.6, label_offset=(56, 0))

# AWS build (VITE_API_URL set): the same requests, to the endpoint.
d.edge(react, fn, "VITE_API_URL set<br>HTTPS + Cognito access token", color=C.BLUE, out="B", into="T", label_pos=0.1)
for svc, y in zip(aws_svcs, AWS_YS):
    d.edge(fn, svc, color=INK, at=d.frac_y(fn, y))
d.edge(fn, cognito, "verify the token", color=C.SECURITY, dashed=True, at=d.frac_y(fn, COGNITO_Y))

d.write(ROOT / "docs/architecture/how-it-works.drawio")
