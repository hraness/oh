//! Raw-ABI WASM artifact for the strict oh-archive reader.
//!
//! This crate intentionally avoids wasm-bindgen so the produced `.wasm` can be
//! vendored as a plain binary and instantiated with `WebAssembly` directly.
//!
//! ABI:
//! - `oh_archive_alloc(len)` returns a pointer to a `len`-byte buffer.
//! - `oh_archive_free(ptr, len)` releases a buffer returned by `alloc` or by
//!   `oh_archive_read_strict` (for the latter, `len` is the capacity header).
//! - `oh_archive_read_strict(archive_ptr, archive_len, options_ptr,
//!   options_len)` returns a pointer to a result buffer laid out as:
//!   `[u32le capacity][u32le status][u32le payload_len][payload]` where
//!   `capacity` is the total buffer size (header included), `status` is 0 for
//!   success or 1 for an error, and `payload` is either the packed entries or
//!   a UTF-8 error message. Packed entries are `[u32le count]` followed by
//!   `count` repetitions of `[u32le name_len][name][u64le data_len][data]`.

use oh_archive::strict::{read_zip_entries_strict, StrictZipOptions};

const MAX_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;
const MAX_OPTIONS_BYTES: usize = 64 * 1024;
const MAX_ALLOCATION_BYTES: usize = 1024 * 1024 * 1024;

#[unsafe(no_mangle)]
pub extern "C" fn oh_archive_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_ALLOCATION_BYTES {
        return std::ptr::null_mut();
    }
    let Ok(layout) = std::alloc::Layout::array::<u8>(len) else {
        return std::ptr::null_mut();
    };
    unsafe { std::alloc::alloc(layout) }
}

/// # Safety
/// `ptr` must come from `oh_archive_alloc` or `oh_archive_read_strict`, and
/// `len` must be the exact capacity originally allocated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn oh_archive_free(ptr: *mut u8, len: usize) {
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
    let ptr = oh_archive_alloc(capacity);
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

fn pack_entries(entries: &[oh_archive::strict::StrictZipEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for entry in entries {
        out.extend_from_slice(&(entry.name.len() as u32).to_le_bytes());
        out.extend_from_slice(entry.name.as_bytes());
        out.extend_from_slice(&(entry.bytes.len() as u64).to_le_bytes());
        out.extend_from_slice(&entry.bytes);
    }
    out
}

/// # Safety
/// Both `(archive_ptr, archive_len)` and `(options_ptr, options_len)` must
/// point at valid readable buffers inside the caller's WASM memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn oh_archive_read_strict(
    archive_ptr: *const u8,
    archive_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> *mut u8 {
    if archive_len == 0
        || archive_len > MAX_ARCHIVE_BYTES
        || archive_ptr.is_null()
        || options_len == 0
        || options_len > MAX_OPTIONS_BYTES
        || options_ptr.is_null()
    {
        return result_buffer(1, b"archive or options exceed their bounds or have an invalid pointer");
    }
    let archive = unsafe { std::slice::from_raw_parts(archive_ptr, archive_len) };
    let options_bytes = unsafe { std::slice::from_raw_parts(options_ptr, options_len) };
    let options: StrictZipOptions = match serde_json::from_slice(options_bytes) {
        Ok(options) => options,
        Err(error) => {
            return result_buffer(1, format!("invalid options JSON: {error}").as_bytes());
        }
    };
    match read_zip_entries_strict(archive, &options) {
        Ok(entries) => result_buffer(0, &pack_entries(&entries)),
        Err(error) => result_buffer(1, error.to_string().as_bytes()),
    }
}
