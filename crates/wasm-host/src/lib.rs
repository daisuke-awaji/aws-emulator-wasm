//! The wasm entry point: one in-memory emulator behind a small C ABI.
//!
//! The host (JS) copies an encoded HTTP request into memory from `emu_alloc`, calls
//! `emu_handle`, and reads the encoded response at `emu_response_ptr` /
//! `emu_response_len`. Both encodings are a list of byte fields:
//! `u32 count, then count x (u32 len, len bytes)`, little-endian.
//!
//! - request:  method, uri, (header name, header value)*, body
//! - response: status, (header name, header value)*, body
//!
//! Everything runs on one current-thread tokio runtime. Tasks a handler spawns only make
//! progress while the runtime is driven, so the host calls `emu_tick` between requests.

mod services;

use std::cell::RefCell;

struct Emulator {
    runtime: tokio::runtime::Runtime,
    router: smithy_server_runtime::MultiServiceRouter,
    response: Vec<u8>,
}

thread_local! {
    static EMULATOR: RefCell<Option<Emulator>> = const { RefCell::new(None) };
}

fn with_emulator<R>(f: impl FnOnce(&mut Emulator) -> R) -> R {
    EMULATOR.with(|cell| {
        let mut slot = cell.borrow_mut();
        let emulator = slot.get_or_insert_with(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .expect("current-thread runtime");
            let engine = std::sync::Arc::new(engine::InMemoryEngine::new());
            let mut router = services::build_router(engine);
            router.set_request_authentication(false);
            Emulator { runtime, router, response: Vec::new() }
        });
        f(emulator)
    })
}

/// Splits an encoded field list; `None` when it is malformed.
pub fn decode_fields(mut buf: &[u8]) -> Option<Vec<&[u8]>> {
    fn take_u32(buf: &mut &[u8]) -> Option<usize> {
        let (head, rest) = buf.split_at_checked(4)?;
        *buf = rest;
        Some(u32::from_le_bytes(head.try_into().ok()?) as usize)
    }
    let count = take_u32(&mut buf)?;
    let mut fields = Vec::with_capacity(count.min(1024));
    for _ in 0..count {
        let len = take_u32(&mut buf)?;
        let (field, rest) = buf.split_at_checked(len)?;
        fields.push(field);
        buf = rest;
    }
    buf.is_empty().then_some(fields)
}

/// Encodes a field list.
pub fn encode_fields(fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + fields.iter().map(|f| 4 + f.len()).sum::<usize>());
    out.extend_from_slice(&(fields.len() as u32).to_le_bytes());
    for field in fields {
        out.extend_from_slice(&(field.len() as u32).to_le_bytes());
        out.extend_from_slice(field);
    }
    out
}

/// Builds the `http::Request` an encoded request describes.
pub fn decode_request(buf: &[u8]) -> Result<http::Request<bytes::Bytes>, String> {
    let fields = decode_fields(buf).ok_or("malformed request frame")?;
    if fields.len() < 3 || fields.len() % 2 == 0 {
        return Err(format!("request frame has {} fields", fields.len()));
    }
    let mut builder = http::Request::builder()
        .method(fields[0])
        .uri(std::str::from_utf8(fields[1]).map_err(|e| e.to_string())?);
    for pair in fields[2..fields.len() - 1].chunks(2) {
        builder = builder.header(pair[0], pair[1]);
    }
    builder
        .body(bytes::Bytes::copy_from_slice(fields[fields.len() - 1]))
        .map_err(|e| e.to_string())
}

/// Encodes a response.
pub fn encode_response(response: &http::Response<bytes::Bytes>) -> Vec<u8> {
    let status = response.status().as_u16().to_string();
    let mut fields: Vec<&[u8]> = vec![status.as_bytes()];
    for (name, value) in response.headers() {
        fields.push(name.as_str().as_bytes());
        fields.push(value.as_bytes());
    }
    fields.push(response.body());
    encode_fields(&fields)
}

fn error_response(status: u16, message: &str) -> Vec<u8> {
    encode_fields(&[status.to_string().as_bytes(), b"content-type", b"text/plain", message.as_bytes()])
}

/// Allocates `len` bytes for the host to write a request into.
#[unsafe(no_mangle)]
pub extern "C" fn emu_alloc(len: u32) -> *mut u8 {
    let mut buf = std::mem::ManuallyDrop::new(Vec::<u8>::with_capacity(len as usize));
    buf.as_mut_ptr()
}

/// Frees a buffer from [`emu_alloc`] that was not passed to [`emu_handle`].
///
/// # Safety
/// `ptr` and `len` must come from one `emu_alloc` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emu_dealloc(ptr: *mut u8, len: u32) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len as usize) });
}

/// Serves the encoded request at `ptr` (from [`emu_alloc`], now owned and freed here).
/// Returns the response length; read it at [`emu_response_ptr`].
///
/// # Safety
/// `ptr` and `len` must come from one `emu_alloc` call, with `len` bytes written.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emu_handle(ptr: *mut u8, len: u32) -> u32 {
    let input = unsafe { Vec::from_raw_parts(ptr, len as usize, len as usize) };
    with_emulator(|emulator| {
        emulator.response = match decode_request(&input) {
            Ok(request) => {
                let router = emulator.router.clone();
                let response = emulator.runtime.block_on(router.dispatch(request));
                encode_response(&response)
            }
            Err(message) => error_response(400, &message),
        };
        emulator.response.len() as u32
    })
}

/// The last response from [`emu_handle`].
#[unsafe(no_mangle)]
pub extern "C" fn emu_response_ptr() -> *const u8 {
    with_emulator(|emulator| emulator.response.as_ptr())
}

/// The length of the last response from [`emu_handle`].
#[unsafe(no_mangle)]
pub extern "C" fn emu_response_len() -> u32 {
    with_emulator(|emulator| emulator.response.len() as u32)
}

/// Drives tasks that handlers spawned (for example, DynamoDB exports) for a short while.
#[unsafe(no_mangle)]
pub extern "C" fn emu_tick() {
    with_emulator(|emulator| {
        emulator.runtime.block_on(async {
            for _ in 0..64 {
                tokio::task::yield_now().await;
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_round_trip() {
        let fields: [&[u8]; 3] = [b"POST", b"", b"\x00\xff"];
        let encoded = encode_fields(&fields);
        assert_eq!(decode_fields(&encoded).unwrap(), fields);
    }

    #[test]
    fn truncated_and_trailing_frames_are_rejected() {
        let encoded = encode_fields(&[b"abc"]);
        assert!(decode_fields(&encoded[..encoded.len() - 1]).is_none());
        let mut extra = encoded.clone();
        extra.push(0);
        assert!(decode_fields(&extra).is_none());
        assert!(decode_fields(&[1, 0, 0]).is_none());
    }

    #[test]
    fn request_needs_method_uri_and_body() {
        assert!(decode_request(&encode_fields(&[b"GET", b"/"])).is_err());
        assert!(decode_request(&encode_fields(&[b"GET", b"/", b"x-a"])).is_err());
        let request =
            decode_request(&encode_fields(&[b"PUT", b"http://h/p?q=1", b"x-a", b"1", b"body"])).unwrap();
        assert_eq!(request.method(), http::Method::PUT);
        assert_eq!(request.uri().query(), Some("q=1"));
        assert_eq!(request.headers()["x-a"], "1");
        assert_eq!(request.body().as_ref(), b"body");
    }
}
