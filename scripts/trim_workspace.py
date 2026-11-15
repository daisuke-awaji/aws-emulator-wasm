"""Rewrite the upstream root Cargo.toml so the workspace only lists the given member crates.

usage: python3 trim_workspace.py <upstream-dir> <member-dir>...
"""
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]) / "Cargo.toml"
members = [m for m in sys.argv[2:] if m.startswith(("services/", "core/"))]
text = root.read_text()
body = "members = [\n" + "".join(f'    "{m}",\n' for m in members) + "]"
text, n = re.subn(r"members = \[\n.*?\n\]", body, text, count=1, flags=re.S)
assert n == 1, "members array not found"
root.write_text(text)
print(f"workspace members: {len(members)}")

# Dev-dependencies of a member are resolved even when only its library is built, and they
# reach services outside the closure (e.g. EC2), so drop them from the trimmed checkout.
section = re.compile(r"^\[dev-dependencies\]\n(?:(?!^\[).*\n?)*", re.M)
for m in members:
    manifest = pathlib.Path(sys.argv[1]) / m / "Cargo.toml"
    src = manifest.read_text()
    out = section.sub("", src)
    if out != src:
        manifest.write_text(out)
        print(f"dropped dev-dependencies: {m}")
