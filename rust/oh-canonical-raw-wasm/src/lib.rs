//! Raw-ABI WASM artifact for the Oh canonical-JSON engine.
//!
//! Like `oh-archive-strict-wasm`, this crate avoids wasm-bindgen so the
//! produced `.wasm` is a plain binary that hosts instantiate with
//! `WebAssembly` directly (Convex, Bun, Node, browsers).
//!
//! ABI:
//! - `oh_canonical_alloc(len)` returns a pointer to a `len`-byte buffer.
//! - `oh_canonical_free(ptr, len)` releases such a buffer.
//! - `oh_canonical_json(in_ptr, in_len)` canonicalizes the UTF-8 JSON text at
//!   `in_ptr` and returns a result buffer laid out as
//!   `[u32le capacity][u32le status][u32le payload_len][payload]`. `status` 0
//!   means `payload` is the canonical JSON text; nonzero means it is a UTF-8
//!   error message.
//! - `oh_canonical_sha256(in_ptr, in_len)` is identical but returns the
//!   SHA-256 hex of the canonical form.

use oh_canonical::{canonical_json_str, canonical_sha256_str};

const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_ALLOCATION_BYTES: usize = MAX_INPUT_BYTES + 12;

#[unsafe(no_mangle)]
pub extern "C" fn oh_canonical_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_ALLOCATION_BYTES {
        return std::ptr::null_mut();
    }
    let Ok(layout) = std::alloc::Layout::array::<u8>(len) else {
        return std::ptr::null_mut();
    };
    unsafe { std::alloc::alloc(layout) }
}

/// # Safety
/// `ptr` must come from `oh_canonical_alloc` or a `oh_canonical_*` call, and
/// `len` must be the exact capacity originally allocated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn oh_canonical_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 || len > MAX_ALLOCATION_BYTES {
        return;
    }
    let Ok(layout) = std::alloc::Layout::array::<u8>(len) else {
        return;
    };
    unsafe { std::alloc::dealloc(ptr, layout) }
}

fn result_buffer(status: u32, payload: &[u8]) -> *mut u8 {
    let Some(capacity) = 12usize.checked_add(payload.len()) else {
        return std::ptr::null_mut();
    };
    let (Ok(capacity_u32), Ok(payload_u32)) = (u32::try_from(capacity), u32::try_from(payload.len())) else {
        return std::ptr::null_mut();
    };
    let ptr = oh_canonical_alloc(capacity);
    if ptr.is_null() {
        return std::ptr::null_mut();
    }
    let header = [
        capacity_u32.to_le_bytes(),
        status.to_le_bytes(),
        payload_u32.to_le_bytes(),
    ]
    .concat();
    unsafe {
        std::ptr::copy_nonoverlapping(header.as_ptr(), ptr, 12);
        if !payload.is_empty() {
            std::ptr::copy_nonoverlapping(payload.as_ptr(), ptr.add(12), payload.len());
        }
    }
    ptr
}

unsafe fn run(
    in_ptr: *const u8,
    in_len: usize,
    f: impl Fn(&str) -> Result<String, oh_canonical::CanonicalError>,
) -> *mut u8 {
    if in_len > MAX_INPUT_BYTES || (in_len > 0 && in_ptr.is_null()) {
        return result_buffer(1, b"input exceeds its byte limit or has an invalid pointer");
    }
    let bytes = if in_len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(in_ptr, in_len) }
    };
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return result_buffer(1, b"input is not valid UTF-8"),
    };
    match f(text) {
        Ok(output) => result_buffer(0, output.as_bytes()),
        Err(error) => result_buffer(1, error.to_string().as_bytes()),
    }
}

/// # Safety
/// `(in_ptr, in_len)` must point at a valid readable buffer in the caller's
/// WASM memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn oh_canonical_json(in_ptr: *const u8, in_len: usize) -> *mut u8 {
    unsafe { run(in_ptr, in_len, canonical_json_str) }
}

/// # Safety
/// `(in_ptr, in_len)` must point at a valid readable buffer in the caller's
/// WASM memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn oh_canonical_sha256(in_ptr: *const u8, in_len: usize) -> *mut u8 {
    unsafe { run(in_ptr, in_len, canonical_sha256_str) }
}
