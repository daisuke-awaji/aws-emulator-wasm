"""Apply the wasm32 patch set to a pristine upstream checkout (run after trim_workspace.py).

Every edit keeps the native build as it was: wasm-only code sits behind
`cfg(target_family = "wasm")`, native-only code behind its negation.

usage: python3 patch_wasm.py <upstream-dir>
"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(sys.argv[1])
FILES = pathlib.Path(__file__).resolve().parent.parent / "patches/files"
SRC = ROOT / "vendor/server/src"
NW = '#[cfg(not(target_family = "wasm"))]\n'
W = '#[cfg(target_family = "wasm")]\n'
UNAV = 'Err(SurfaceError::Bind("network listeners are unavailable in the wasm build".to_string()))'


def once(s, old, new):
    assert s.count(old) == 1, old
    return s.replace(old, new, 1)


def edit(rel, *pairs):
    p = ROOT / rel
    s = p.read_text()
    for old, new in pairs:
        s = once(s, old, new)
    p.write_text(s)


# P1 tokio: wasm supports only sync/macros/io-util/rt/time.
edit(
    "Cargo.toml",
    (
        'tokio = { version = "1", features = ["macros", "rt", "rt-multi-thread"] }',
        'tokio = { version = "1", features = ["macros", "rt"] }',
    ),
)
edit(
    "vendor/server/Cargo.toml",
    ('tokio = { version = "1", features = ["full"] }\n', ""),
    ('axum = "0.8"\n', ""),
    ('axum-server = { version = "0.7", features = ["tls-rustls"] }\n', ""),
)
AX = '["form", "http1", "json", "matched-path", "original-uri", "query", "tower-log", "tracing"]'
with open(ROOT / "vendor/server/Cargo.toml", "a") as f:
    f.write(
        "\n[target.'cfg(not(target_family = \"wasm\"))'.dependencies]\n"
        'axum = "0.8"\ntokio = { version = "1", features = ["full"] }\n'
        'axum-server = { version = "0.7", features = ["tls-rustls"] }\n'
        "\n[target.'cfg(target_family = \"wasm\")'.dependencies]\n"
        f'axum = {{ version = "0.8", default-features = false, features = {AX} }}\n'
        'tokio = { version = "1", features = ["sync", "macros", "io-util", "rt", "time"] }\n'
    )
edit("vendor/smithy-server-runtime/Cargo.toml", ('axum = "0.7"\n', ""))
with open(ROOT / "vendor/smithy-server-runtime/Cargo.toml", "a") as f:
    f.write(
        "\n[target.'cfg(not(target_family = \"wasm\"))'.dependencies]\naxum = \"0.7\"\n"
        "\n[target.'cfg(target_family = \"wasm\")'.dependencies]\n"
        f'axum = {{ version = "0.7", default-features = false, features = {AX} }}\n'
    )
# aws-smithy-types/rt-tokio turns on tokio/fs.
edit(
    "services/service-com-amazonaws-kinesis-kinesis-20131202/Cargo.toml",
    (
        'aws-sdk-kms = { version = "1", default-features = false, features = ["rt-tokio", "behavior-version-latest"] }',
        'aws-sdk-kms = { version = "1", default-features = false, features = ["behavior-version-latest"] }',
    ),
)
# block_in_place exists only on the multi-thread runtime.
edit(
    "services/service-com-amazonaws-cloudwatch-graniteserviceversion20100801/src/service.rs",
    (
        "        Ok(tokio::runtime::RuntimeFlavor::MultiThread) => tokio::task::block_in_place(work),\n",
        "        " + NW + "        Ok(tokio::runtime::RuntimeFlavor::MultiThread) => tokio::task::block_in_place(work),\n",
    ),
)

# P2 telemetry: no reqwest on wasm; a stand-in whose every send fails.
edit(
    "vendor/emulator-telemetry/Cargo.toml",
    ('reqwest = { version = "0.12", default-features = false, features = ["blocking", "rustls-tls"] }\n', ""),
    (
        "[target.'cfg(target_vendor = \"apple\")'.dependencies]",
        "[target.'cfg(not(target_family = \"wasm\"))'.dependencies]\n"
        'reqwest = { version = "0.12", default-features = false, features = ["blocking", "rustls-tls"] }\n'
        "\n[target.'cfg(target_family = \"wasm\")'.dependencies]\nurl = \"2\"\n"
        "\n[target.'cfg(target_vendor = \"apple\")'.dependencies]",
    ),
)
edit("vendor/emulator-telemetry/src/lib.rs", ("mod client;\n", "mod client;\n" + W + "mod reqwest_shim;\n"))
shutil.copy(FILES / "emulator-telemetry-reqwest_shim.rs", ROOT / "vendor/emulator-telemetry/src/reqwest_shim.rs")
for rel in ["vendor/emulator-telemetry/src/client.rs", "vendor/emulator-telemetry/src/config.rs"]:
    p = ROOT / rel
    lines = p.read_text().split("\n")
    i = 0
    while i < len(lines) and (lines[i].startswith(("//", "#!")) or lines[i] == ""):
        i += 1
    lines.insert(i, W + "use crate::reqwest_shim as reqwest;")
    p.write_text("\n".join(lines))

# P3 JSONata containment needs unwinding; wasm32 builds abort on panic (see phase0 report).
edit(
    "services/common/src/jsonata.rs",
    ('#[cfg(panic = "abort")]\ncompile_error!(', '#[cfg(all(panic = "abort", not(target_family = "wasm")))]\ncompile_error!('),
)

# P4 vendor/server: no sockets, TLS listeners or signals on wasm.

p = SRC / "listeners.rs"
s = p.read_text()
h = "async fn bind_tokio(bind_ip: IpAddr, range: PortRange) -> Result<tokio::net::TcpListener, SurfaceError> {"
s = once(s, h, NW + h)
h = "async fn serve_native<H: NativeHandler>("
s = once(s, h, NW + h)
s = once(
    s,
    "/// The accept loop shared by [`Listeners::tcp`]",
    W
    + "async fn serve_native<H: NativeHandler>(\n    _handler: H,\n    _idle: Duration,\n"
    + "    _tls: Option<tokio_rustls::TlsAcceptor>,\n) -> Result<ResourceListener, SurfaceError> {\n    "
    + UNAV
    + "\n}\n\n/// The accept loop shared by [`Listeners::tcp`]",
)
h = "    pub async fn http<H: HttpHandler>(\n"
s = once(s, h, "    " + NW + h)
s = once(
    s,
    "impl Listeners {\n    /// Open an HTTP listener, TLS,",
    "impl Listeners {\n    #[cfg(target_family = \"wasm\")]\n    pub async fn http<H: HttpHandler>(\n"
    + "        &self,\n        _handler: H,\n        _policy: HttpPolicy,\n"
    + "    ) -> Result<ResourceListener, SurfaceError> {\n        "
    + UNAV
    + "\n    }\n\n    /// Open an HTTP listener, TLS,",
)
s = once(s, "    Http(axum_server::Handle),\n", "    " + NW + "    Http(axum_server::Handle),\n")
s = once(
    s,
    "            Shutdown::Http(h) => h.shutdown(),\n",
    "            " + NW + "            Shutdown::Http(h) => h.shutdown(),\n",
)
p.write_text(s)

p = SRC / "lib.rs"
s = p.read_text()
for h in [
    "pub async fn serve_on_ephemeral_port<S: EmulatorService>(service: S) -> (String, S) {",
    "fn bind_production_listener(\n",
    "pub async fn serve_production<S: EmulatorService>(service: S) -> Result<(), ServeError> {",
    "pub async fn serve_production_on<S: EmulatorService>(\n",
    "pub async fn serve_production_on_address<S: EmulatorService>(\n",
    "fn data_listener_tls_config(\n",
    "pub async fn serve_emulator<R: EmulatorService>(router: R) -> ! {",
    "pub async fn serve_emulator_until_shutdown<R: EmulatorService>(\n",
    "pub async fn serve_emulator_on<R: EmulatorService>(\n",
    "fn reporting_startup_failure(result: Result<(), ServeError>) -> Result<(), ServeError> {",
]:
    s = once(s, h, NW + h)
s = once(s, "#[cfg(unix)]\nfn shutdown_signal()", '#[cfg(all(unix, not(target_family = "wasm")))]\nfn shutdown_signal()')
s = once(
    s,
    "#[cfg(unix)]\nasync fn signal_received(",
    '#[cfg(all(unix, not(target_family = "wasm")))]\nasync fn signal_received(',
)
s = once(
    s,
    "#[cfg(not(unix))]\nfn shutdown_signal()",
    '#[cfg(all(not(unix), not(target_family = "wasm")))]\nfn shutdown_signal()',
)
p.write_text(s)
print("applied wasm patch set")
