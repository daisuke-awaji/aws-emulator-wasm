"""Print the local path-dependency closure of the given upstream crate directories.

usage: python3 closure.py <crate-dir>...   (run from the upstream checkout root)
"""
import os
import sys
import tomllib

root = tomllib.load(open("Cargo.toml", "rb"))
wsdeps = root["workspace"]["dependencies"]


def path_of(name, spec, base):
    if not isinstance(spec, dict):
        return None
    if spec.get("workspace"):
        s = wsdeps.get(name)
        if isinstance(s, dict) and "path" in s:
            return os.path.normpath(s["path"])
        return None
    if "path" in spec:
        return os.path.normpath(os.path.join(base, spec["path"]))
    return None


seen = {}
stack = list(sys.argv[1:])
while stack:
    d = stack.pop()
    if d in seen:
        continue
    t = tomllib.load(open(os.path.join(d, "Cargo.toml"), "rb"))
    deps = {}
    for sec in ("dependencies", "build-dependencies"):
        deps.update(t.get(sec, {}))
    for tgt in t.get("target", {}).values():
        deps.update(tgt.get("dependencies", {}))
    kids = [p for n, s in deps.items() if (p := path_of(n, s, d))]
    seen[d] = kids
    stack += kids
for d in sorted(seen):
    print(d)
