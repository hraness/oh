//! Strict in-memory ZIP/ZIP64 reader.
//!
//! This is a Rust port of the bounded X-archive ZIP reader used by Textbutler
//! (`src/x-archive-zip.ts`). It validates the complete archive structure —
//! end records, central directory, local headers, data descriptors, CRC-32,
//! compression-ratio and path safety — and returns only the selected members'
//! uncompressed bytes in memory. Nothing is written to disk.

use flate2::read::DeflateDecoder;
use regex::RegexSet;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use unicode_normalization::is_nfc;

const EOCD: u32 = 0x0605_4b50;
const ZIP64_EOCD: u32 = 0x0606_4b50;
const ZIP64_LOCATOR: u32 = 0x0706_4b50;
const CENTRAL: u32 = 0x0201_4b50;
const LOCAL: u32 = 0x0403_4b50;
const DESCRIPTOR: u32 = 0x0807_4b50;
const ZIP64_EXTRA: u16 = 0x0001;
const STORED: u16 = 0;
const DEFLATE: u16 = 8;
const DESCRIPTOR_FLAG: u16 = 0x0008;
const UTF8_FLAG: u16 = 0x0800;
const ENCRYPTED_FLAG: u16 = 0x0001;
const STRONG_ENCRYPTION_FLAG: u16 = 0x0040;
const MASKED_HEADER_FLAG: u16 = 0x2000;
const DEFLATE_OPTION_FLAGS: u16 = 0x0006;
const UNIX_HOST: u16 = 3;
const MACOS_HOST: u16 = 19;
const UNIX_TYPE_MASK: u32 = 0o170000;
const UNIX_REGULAR: u32 = 0o100000;
const UNIX_DIRECTORY: u32 = 0o040000;
const DOS_DIRECTORY: u32 = 0x10;
const U16_MAX: u16 = 0xffff;
const U32_MAX: u32 = 0xffff_ffff;

/// Bounds enforced while reading a strict archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrictZipLimits {
    /// Maximum archive size in bytes.
    pub max_archive_bytes: u64,
    /// Maximum uncompressed size of a selected member.
    pub max_member_bytes: u64,
    /// Maximum compressed size of a selected member.
    pub max_compressed_member_bytes: u64,
    /// Maximum number of central-directory entries.
    pub max_entries: u64,
    /// Maximum central-directory byte size.
    pub max_central_bytes: u64,
    /// Maximum total uncompressed bytes across selected members.
    pub max_total_selected_bytes: u64,
    /// Maximum total declared uncompressed bytes across all entries.
    pub max_total_declared_bytes: u64,
    /// Maximum member-name byte length.
    pub max_name_bytes: usize,
    /// Maximum uncompressed-to-compressed ratio for selected members.
    pub max_ratio: u64,
}

impl Default for StrictZipLimits {
    fn default() -> Self {
        Self {
            max_archive_bytes: 16 * 1024 * 1024 * 1024,
            max_member_bytes: 256 * 1024 * 1024,
            max_compressed_member_bytes: 64 * 1024 * 1024,
            max_entries: 100_000,
            max_central_bytes: 64 * 1024 * 1024,
            max_total_selected_bytes: 768 * 1024 * 1024,
            max_total_declared_bytes: 64 * 1024 * 1024 * 1024,
            max_name_bytes: 4 * 1024,
            max_ratio: 200,
        }
    }
}

/// Options controlling strict archive reads.
#[derive(Debug, Clone, Deserialize)]
pub struct StrictZipOptions {
    /// Regex patterns; only entries whose full name matches at least one
    /// pattern are decoded and returned.
    pub patterns: Vec<String>,
    #[serde(default)]
    pub limits: StrictZipLimits,
}

/// A selected member's bytes.
#[derive(Debug, Clone, Serialize)]
pub struct StrictZipEntry {
    /// Full member name inside the archive.
    pub name: String,
    /// Uncompressed bytes.
    pub bytes: Vec<u8>,
}

/// Errors returned by strict archive reads.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum StrictZipError {
    Invalid { message: String },
    Limit { message: String },
}

impl std::fmt::Display for StrictZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StrictZipError::Invalid { message } | StrictZipError::Limit { message } => {
                f.write_str(message)
            }
        }
    }
}

impl std::error::Error for StrictZipError {}

type Result<T> = std::result::Result<T, StrictZipError>;

fn invalid(message: impl Into<String>) -> StrictZipError {
    StrictZipError::Invalid { message: message.into() }
}

#[derive(Debug, Clone, Copy)]
struct Directory {
    count: u64,
    offset: usize,
    end: usize,
}

#[derive(Debug, Clone)]
struct Entry {
    name: String,
    name_bytes: Vec<u8>,
    directory: bool,
    selected: bool,
    version_made_by: u16,
    version_needed: u16,
    flags: u16,
    method: u16,
    modified_time: u16,
    modified_date: u16,
    crc32: u32,
    compressed_size: u64,
    uncompressed_size: u64,
    external_attributes: u32,
    local_header_offset: u64,
}

#[derive(Debug, Clone, Copy)]
struct LocalRange {
    data_offset: usize,
    data_end: usize,
}

fn checked_end(offset: usize, length: usize, label: &str) -> Result<usize> {
    offset
        .checked_add(length)
        .ok_or_else(|| invalid(format!("X ZIP {label} has invalid bounds")))
}

fn read_exact<'a>(archive: &'a [u8], offset: usize, length: usize, label: &str) -> Result<&'a [u8]> {
    let end = checked_end(offset, length, label)?;
    archive
        .get(offset..end)
        .ok_or_else(|| invalid(format!("X ZIP {label} is truncated")))
}

fn u16_le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

fn u64_field(bytes: &[u8], offset: usize, label: &str) -> Result<u64> {
    if bytes.len().saturating_sub(offset) < 8 {
        return Err(invalid(format!("X ZIP {label} is truncated")));
    }
    Ok(u64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ]))
}

fn field_value(legacy: u64, resolved: u64, sentinel: u64, label: &str) -> Result<()> {
    if legacy != sentinel && legacy != resolved {
        return Err(invalid(format!("X ZIP legacy {label} contradicts ZIP64 metadata")));
    }
    Ok(())
}

fn directory_from_eocd(archive: &[u8], limits: &StrictZipLimits) -> Result<Directory> {
    let archive_size = archive.len();
    let tail_length = archive_size.min(22 + U16_MAX as usize + 20);
    let tail_offset = archive_size - tail_length;
    let tail = read_exact(archive, tail_offset, tail_length, "end records")?;
    let mut candidates: Vec<usize> = Vec::new();
    for offset in (0..=tail.len() - 22).rev() {
        if u32_le(tail, offset) == EOCD
            && tail_offset + offset + 22 + u16_le(tail, offset + 20) as usize == archive_size
        {
            candidates.push(tail_offset + offset);
        }
    }
    if candidates.len() != 1 {
        return Err(invalid(if candidates.is_empty() {
            "X ZIP end-of-central-directory record is missing".to_string()
        } else {
            "X ZIP end-of-central-directory record is ambiguous".to_string()
        }));
    }
    let eocd_offset = candidates[0];
    let eocd = read_exact(archive, eocd_offset, archive_size - eocd_offset, "end-of-central-directory record")?;
    if eocd.len() != 22 || u16_le(eocd, 20) != 0 {
        return Err(invalid("X ZIP archive comments are not supported"));
    }
    let legacy_disk = u16_le(eocd, 4);
    let legacy_central_disk = u16_le(eocd, 6);
    let legacy_on_disk = u16_le(eocd, 8);
    let legacy_count = u16_le(eocd, 10);
    let legacy_size = u32_le(eocd, 12);
    let legacy_offset = u32_le(eocd, 16);
    let locator_offset = eocd_offset.wrapping_sub(20);
    let has_zip64 = eocd_offset >= 20
        && read_exact(archive, locator_offset, 4, "ZIP64 locator signature")
            .map(|b| u32_le(b, 0) == ZIP64_LOCATOR)
            .unwrap_or(false);
    if !has_zip64 {
        if [legacy_disk, legacy_central_disk, legacy_on_disk, legacy_count].contains(&U16_MAX)
            || [legacy_size, legacy_offset].contains(&U32_MAX)
        {
            return Err(invalid("X ZIP archive is missing required ZIP64 end metadata"));
        }
        if legacy_disk != 0 || legacy_central_disk != 0 || legacy_on_disk != legacy_count {
            return Err(invalid("X ZIP multi-disk archives are not supported"));
        }
        if legacy_count < 1
            || legacy_count as u64 > limits.max_entries
            || legacy_size as u64 > limits.max_central_bytes
        {
            return Err(invalid("X ZIP central directory exceeds its bounds"));
        }
        let end = checked_end(legacy_offset as usize, legacy_size as usize, "central directory")?;
        if end != eocd_offset {
            return Err(invalid("X ZIP central directory has invalid bounds"));
        }
        return Ok(Directory {
            count: legacy_count as u64,
            offset: legacy_offset as usize,
            end,
        });
    }
    let locator = read_exact(archive, locator_offset, 20, "ZIP64 locator")?;
    if u32_le(locator, 4) != 0 || u32_le(locator, 16) != 1 {
        return Err(invalid("X ZIP multi-disk archives are not supported"));
    }
    let zip64_offset = u64_field(locator, 8, "ZIP64 end record offset")? as usize;
    let zip64 = read_exact(archive, zip64_offset, 56, "ZIP64 end record")?;
    if u32_le(zip64, 0) != ZIP64_EOCD || u64_field(zip64, 4, "ZIP64 end record size")? != 44 {
        return Err(invalid("X ZIP64 end record has an unsupported shape"));
    }
    if zip64_offset + zip64.len() != locator_offset
        || u32_le(zip64, 16) != 0
        || u32_le(zip64, 20) != 0
    {
        return Err(invalid("X ZIP64 end record has invalid bounds or disk ownership"));
    }
    let on_disk = u64_field(zip64, 24, "ZIP64 entries on disk")?;
    let count = u64_field(zip64, 32, "ZIP64 entry count")?;
    let size = u64_field(zip64, 40, "ZIP64 central directory size")?;
    let offset = u64_field(zip64, 48, "ZIP64 central directory offset")?;
    if on_disk != count {
        return Err(invalid("X ZIP multi-disk archives are not supported"));
    }
    if count < 1 || count > limits.max_entries || size > limits.max_central_bytes {
        return Err(invalid("X ZIP central directory exceeds its bounds"));
    }
    let end = checked_end(offset as usize, size as usize, "ZIP64 central directory")?;
    if end != zip64_offset {
        return Err(invalid("X ZIP64 central directory has invalid bounds"));
    }
    field_value(legacy_disk as u64, 0, U16_MAX as u64, "disk number")?;
    field_value(legacy_central_disk as u64, 0, U16_MAX as u64, "central disk number")?;
    field_value(legacy_on_disk as u64, on_disk, U16_MAX as u64, "entries-on-disk count")?;
    field_value(legacy_count as u64, count, U16_MAX as u64, "entry count")?;
    field_value(legacy_size as u64, size, U32_MAX as u64, "central directory size")?;
    field_value(legacy_offset as u64, offset, U32_MAX as u64, "central directory offset")?;
    Ok(Directory {
        count,
        offset: offset as usize,
        end,
    })
}

fn extra_fields<'a>(bytes: &'a [u8], label: &str) -> Result<HashMap<u16, &'a [u8]>> {
    let mut fields: HashMap<u16, &[u8]> = HashMap::new();
    let mut position = 0usize;
    while position < bytes.len() {
        if bytes.len() - position < 4 {
            return Err(invalid(format!("X ZIP {label} contains a truncated extra field")));
        }
        let id = u16_le(bytes, position);
        let length = u16_le(bytes, position + 2) as usize;
        let next = checked_end(position + 4, length, &format!("{label} extra field"))?;
        if next > bytes.len() {
            return Err(invalid(format!("X ZIP {label} contains a truncated extra field")));
        }
        if fields.insert(id, &bytes[position + 4..next]).is_some() {
            return Err(invalid(format!("X ZIP {label} contains duplicate extra field {id}")));
        }
        position = next;
    }
    Ok(fields)
}

fn decode_name(name_bytes: &[u8], flags: u16, selected: bool, limits: &StrictZipLimits) -> Result<(String, bool)> {
    if name_bytes.is_empty() || name_bytes.len() > limits.max_name_bytes {
        return Err(invalid("X ZIP member name exceeds its bounds"));
    }
    let decoded: String = if (flags & UTF8_FLAG) != 0 {
        String::from_utf8(name_bytes.to_vec())
            .map_err(|_| invalid("X ZIP member name is not valid UTF-8"))?
    } else {
        if name_bytes.iter().any(|byte| *byte > 0x7f) {
            return Err(invalid("X ZIP non-UTF-8 member names must be ASCII"));
        }
        name_bytes.iter().map(|b| *b as char).collect()
    };
    if !is_nfc(decoded.as_str()) {
        return Err(invalid("X ZIP member name is not NFC-normalized"));
    }
    let bytes_decoded = decoded.as_bytes();
    if bytes_decoded.len() >= 3
        && bytes_decoded[0].is_ascii_alphabetic()
        && bytes_decoded[1] == b':'
        && bytes_decoded[2] == b'/'
        || decoded.starts_with('/')
    {
        return Err(invalid("X ZIP member has an absolute name"));
    }
    if decoded.contains('\\') {
        return Err(invalid("X ZIP member name contains a backslash"));
    }
    if decoded.chars().any(|c| (c as u32) < 0x20 || (0x7f..=0x9f).contains(&(c as u32))) {
        return Err(invalid("X ZIP member name contains a control character"));
    }
    let directory = decoded.ends_with('/');
    let path = if directory { &decoded[..decoded.len() - 1] } else { decoded.as_str() };
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().any(|part| *part == "." || *part == "..")
        || (selected && parts.iter().any(|part| part.is_empty()))
    {
        return Err(invalid("X ZIP selected member has an unsafe path component"));
    }
    Ok((decoded, directory))
}

fn validate_flags(flags: u16, method: u16) -> Result<()> {
    if (flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) != 0 {
        return Err(invalid("X ZIP encrypted members are not supported"));
    }
    if (flags & MASKED_HEADER_FLAG) != 0 {
        return Err(invalid("X ZIP members with masked local headers are not supported"));
    }
    let allowed = UTF8_FLAG | DESCRIPTOR_FLAG | if method == DEFLATE { DEFLATE_OPTION_FLAGS } else { 0 };
    if (flags & !allowed) != 0 {
        return Err(invalid("X ZIP member uses unsupported general-purpose flags"));
    }
    Ok(())
}

fn validate_type(entry: &Entry) -> Result<()> {
    let host = entry.version_made_by >> 8;
    let unix_type = if host == UNIX_HOST || host == MACOS_HOST {
        (entry.external_attributes >> 16) & UNIX_TYPE_MASK
    } else {
        0
    };
    if entry.directory {
        if entry.crc32 != 0
            || entry.uncompressed_size != 0
            || (entry.method == STORED && entry.compressed_size != 0)
        {
            return Err(invalid("X ZIP directory member must expand to empty data"));
        }
        if unix_type != 0 && unix_type != UNIX_DIRECTORY {
            return Err(invalid("X ZIP member is a symlink or another non-regular file"));
        }
    } else if (entry.external_attributes & DOS_DIRECTORY) != 0
        || (unix_type != 0 && unix_type != UNIX_REGULAR)
    {
        return Err(invalid("X ZIP member is not a regular file"));
    }
    Ok(())
}

fn central_entries(
    archive: &[u8],
    directory: Directory,
    selection: &RegexSet,
    limits: &StrictZipLimits,
) -> Result<Vec<Entry>> {
    let bytes = read_exact(archive, directory.offset, directory.end - directory.offset, "central directory")?;
    let mut entries: Vec<Entry> = Vec::new();
    let mut names: HashSet<String> = HashSet::new();
    let mut declared: u64 = 0;
    let mut selected_total: u64 = 0;
    let mut position = 0usize;
    for index in 0..directory.count {
        if bytes.len() - position < 46 || u32_le(bytes, position) != CENTRAL {
            return Err(invalid("X ZIP central directory entry is invalid or truncated"));
        }
        let version_made_by = u16_le(bytes, position + 4);
        let version_needed = u16_le(bytes, position + 6);
        let flags = u16_le(bytes, position + 8);
        let method = u16_le(bytes, position + 10);
        let modified_time = u16_le(bytes, position + 12);
        let modified_date = u16_le(bytes, position + 14);
        let checksum = u32_le(bytes, position + 16);
        let compressed_legacy = u32_le(bytes, position + 20);
        let uncompressed_legacy = u32_le(bytes, position + 24);
        let name_length = u16_le(bytes, position + 28) as usize;
        let extra_length = u16_le(bytes, position + 30) as usize;
        let comment_length = u16_le(bytes, position + 32) as usize;
        let disk_legacy = u16_le(bytes, position + 34);
        let external_attributes = u32_le(bytes, position + 38);
        let offset_legacy = u32_le(bytes, position + 42);
        let next = checked_end(
            position + 46,
            name_length + extra_length + comment_length,
            "central directory entry",
        )?;
        if next > bytes.len() {
            return Err(invalid("X ZIP central directory entry is truncated"));
        }
        let name_bytes = bytes[position + 46..position + 46 + name_length].to_vec();
        let extra_start = position + 46 + name_length;
        let fields = extra_fields(
            &bytes[extra_start..extra_start + extra_length],
            &format!("central directory entry {}", index + 1),
        )?;
        let zip64 = fields.get(&ZIP64_EXTRA).copied();
        let mut zip64_position = 0usize;
        let mut next_zip64 = |label: &str| -> Result<u64> {
            let zip64 = zip64.ok_or_else(|| invalid(format!("X ZIP {label} is missing ZIP64 metadata")))?;
            let value = u64_field(zip64, zip64_position, label)?;
            zip64_position += 8;
            Ok(value)
        };
        let uncompressed_size = if uncompressed_legacy == U32_MAX {
            next_zip64("uncompressed size")?
        } else {
            uncompressed_legacy as u64
        };
        let compressed_size = if compressed_legacy == U32_MAX {
            next_zip64("compressed size")?
        } else {
            compressed_legacy as u64
        };
        let local_header_offset = if offset_legacy == U32_MAX {
            next_zip64("local header offset")?
        } else {
            offset_legacy as u64
        };
        let mut disk = disk_legacy;
        if disk_legacy == U16_MAX {
            let zip64_bytes = zip64
                .ok_or_else(|| invalid("X ZIP disk number is missing ZIP64 metadata"))?;
            if zip64_bytes.len() - zip64_position < 4 {
                return Err(invalid("X ZIP disk number is missing ZIP64 metadata"));
            }
            disk = u32_le(zip64_bytes, zip64_position) as u16;
            zip64_position += 4;
        }
        if (zip64.is_none() && zip64_position != 0)
            || (zip64.is_some() && zip64_position != zip64.map(|z| z.len()).unwrap_or(0))
        {
            return Err(invalid("X ZIP central directory contains ambiguous ZIP64 metadata"));
        }
        if disk != 0 {
            return Err(invalid("X ZIP multi-disk archives are not supported"));
        }
        validate_flags(flags, method)?;
        if method != STORED && method != DEFLATE {
            return Err(invalid(format!("X ZIP compression method {method} is unsupported")));
        }
        let (provisional_name, provisional_directory) =
            decode_name(&name_bytes, flags, false, limits)?;
        let selected = !provisional_directory && selection.is_match(&provisional_name);
        let (name, directory_flag) = if selected {
            decode_name(&name_bytes, flags, true, limits)?
        } else {
            (provisional_name, provisional_directory)
        };
        let entry = Entry {
            name: name.clone(),
            name_bytes,
            directory: directory_flag,
            selected,
            version_made_by,
            version_needed,
            flags,
            method,
            modified_time,
            modified_date,
            crc32: checksum,
            compressed_size,
            uncompressed_size,
            external_attributes,
            local_header_offset,
        };
        if !names.insert(name) {
            return Err(invalid("X ZIP archive contains duplicate member names"));
        }
        if compressed_size as usize > archive.len() || local_header_offset >= directory.offset as u64 {
            return Err(invalid("X ZIP member exceeds archive bounds"));
        }
        if method == STORED && compressed_size != uncompressed_size {
            return Err(invalid("X ZIP stored member has inconsistent sizes"));
        }
        if selected
            && (compressed_size < 1
                || uncompressed_size < 1
                || compressed_size > limits.max_compressed_member_bytes
                || uncompressed_size > limits.max_member_bytes)
        {
            return Err(invalid("selected X ZIP member exceeds its size bounds"));
        }
        if selected && uncompressed_size > compressed_size.saturating_mul(limits.max_ratio) {
            return Err(invalid("selected X ZIP member exceeds its compression-ratio limit"));
        }
        declared = declared
            .checked_add(uncompressed_size)
            .filter(|value| *value <= limits.max_total_declared_bytes)
            .ok_or_else(|| invalid("X ZIP archive exceeds its declared uncompressed-size limit"))?;
        if selected {
            selected_total = selected_total
                .checked_add(uncompressed_size)
                .filter(|value| *value <= limits.max_total_selected_bytes)
                .ok_or_else(|| invalid("selected X ZIP members exceed their total size limit"))?;
        }
        validate_type(&entry)?;
        entries.push(entry);
        position = next;
    }
    if position != bytes.len() {
        return Err(invalid("X ZIP central directory contains unindexed data"));
    }
    Ok(entries)
}

struct LocalSizes {
    compressed: u64,
    uncompressed: u64,
    zip64: bool,
}

fn local_sizes(
    compressed: u32,
    uncompressed: u32,
    fields: &HashMap<u16, &[u8]>,
    label: &str,
) -> Result<LocalSizes> {
    let zip64 = fields.get(&ZIP64_EXTRA).copied();
    if compressed != U32_MAX && uncompressed != U32_MAX {
        if zip64.is_some() {
            return Err(invalid(format!("X ZIP {label} contains redundant ZIP64 size metadata")));
        }
        return Ok(LocalSizes {
            compressed: compressed as u64,
            uncompressed: uncompressed as u64,
            zip64: false,
        });
    }
    let zip64 = zip64.ok_or_else(|| invalid(format!("X ZIP {label} is missing ZIP64 size metadata")))?;
    let mut position = 0usize;
    let mut resolved_uncompressed = uncompressed as u64;
    let mut resolved_compressed = compressed as u64;
    if uncompressed == U32_MAX {
        resolved_uncompressed = u64_field(zip64, position, &format!("{label} uncompressed size"))?;
        position += 8;
    }
    if compressed == U32_MAX {
        resolved_compressed = u64_field(zip64, position, &format!("{label} compressed size"))?;
        position += 8;
    }
    if position != zip64.len() {
        return Err(invalid(format!("X ZIP {label} contains ambiguous ZIP64 size metadata")));
    }
    Ok(LocalSizes {
        compressed: resolved_compressed,
        uncompressed: resolved_uncompressed,
        zip64: true,
    })
}

fn validate_descriptor(bytes: &[u8], entry: &Entry) -> Result<()> {
    let mut position = 0usize;
    if bytes.len() == 16 || bytes.len() == 24 {
        if u32_le(bytes, 0) != DESCRIPTOR {
            return Err(invalid("X ZIP data descriptor signature is invalid"));
        }
        position = 4;
    } else if bytes.len() != 12 && bytes.len() != 20 {
        return Err(invalid("X ZIP data descriptor has an invalid length"));
    }
    if u32_le(bytes, position) != entry.crc32 {
        return Err(invalid("X ZIP data descriptor checksum disagrees with the central directory"));
    }
    position += 4;
    let zip64 = bytes.len() - position == 16;
    let compressed = if zip64 {
        u64_field(bytes, position, "descriptor compressed size")?
    } else {
        u32_le(bytes, position) as u64
    };
    position += if zip64 { 8 } else { 4 };
    let uncompressed = if zip64 {
        u64_field(bytes, position, "descriptor uncompressed size")?
    } else {
        u32_le(bytes, position) as u64
    };
    if compressed != entry.compressed_size || uncompressed != entry.uncompressed_size {
        return Err(invalid("X ZIP data descriptor sizes disagree with the central directory"));
    }
    Ok(())
}

fn local_ranges(
    archive: &[u8],
    entries: &[Entry],
    central_offset: usize,
) -> Result<HashMap<u64, LocalRange>> {
    let mut ordered: Vec<&Entry> = entries.iter().collect();
    ordered.sort_by_key(|entry| entry.local_header_offset);
    let mut ranges: HashMap<u64, LocalRange> = HashMap::new();
    let mut expected: u64 = 0;
    for (index, entry) in ordered.iter().enumerate() {
        let label = format!("local member {}", index + 1);
        let offset = entry.local_header_offset;
        if offset != expected {
            return Err(invalid(if offset < expected {
                "X ZIP local member ranges overlap"
            } else {
                "X ZIP archive contains unindexed local data"
            }));
        }
        let offset_usize = offset as usize;
        let header = read_exact(archive, offset_usize, 30, &format!("{label} header"))?;
        if u32_le(header, 0) != LOCAL {
            return Err(invalid("X ZIP local header signature is invalid"));
        }
        let version = u16_le(header, 4);
        let flags = u16_le(header, 6);
        let method = u16_le(header, 8);
        let modified_time = u16_le(header, 10);
        let modified_date = u16_le(header, 12);
        let checksum = u32_le(header, 14);
        let compressed_legacy = u32_le(header, 18);
        let uncompressed_legacy = u32_le(header, 22);
        let name_length = u16_le(header, 26) as usize;
        let extra_length = u16_le(header, 28) as usize;
        if version != entry.version_needed
            || flags != entry.flags
            || method != entry.method
            || modified_time != entry.modified_time
            || modified_date != entry.modified_date
        {
            return Err(invalid("X ZIP local header disagrees with the central directory"));
        }
        let variable = read_exact(
            archive,
            offset_usize + 30,
            name_length + extra_length,
            &format!("{label} fields"),
        )?;
        if variable[..name_length] != entry.name_bytes[..] {
            return Err(invalid("X ZIP local member name disagrees with the central directory"));
        }
        let fields = extra_fields(&variable[name_length..], &format!("{label} header"))?;
        let sizes = local_sizes(compressed_legacy, uncompressed_legacy, &fields, &format!("{label} header"))?;
        if (flags & DESCRIPTOR_FLAG) == 0 {
            if checksum != entry.crc32
                || sizes.compressed != entry.compressed_size
                || sizes.uncompressed != entry.uncompressed_size
            {
                return Err(invalid("X ZIP local sizes or checksum disagree with the central directory"));
            }
        } else if (checksum != 0 && checksum != entry.crc32)
            || (sizes.compressed != 0 && sizes.compressed != entry.compressed_size)
            || (sizes.uncompressed != 0 && sizes.uncompressed != entry.uncompressed_size)
        {
            return Err(invalid("X ZIP local descriptor placeholders disagree with the central directory"));
        }
        let data_offset = checked_end(offset_usize + 30, name_length + extra_length, "local member data offset")?;
        let data_end = checked_end(data_offset, entry.compressed_size as usize, "local member compressed data")?;
        let next = ordered
            .get(index + 1)
            .map(|e| e.local_header_offset as usize)
            .unwrap_or(central_offset);
        if data_end > next {
            return Err(invalid("X ZIP local member ranges overlap"));
        }
        if (flags & DESCRIPTOR_FLAG) == 0 {
            if data_end != next {
                return Err(invalid("X ZIP archive contains unindexed local data"));
            }
        } else {
            let descriptor_length = next - data_end;
            let allowed: &[usize] = if sizes.zip64 { &[20, 24] } else { &[12, 16] };
            if !allowed.contains(&descriptor_length) {
                return Err(invalid("X ZIP data descriptor has an invalid width"));
            }
            validate_descriptor(read_exact(archive, data_end, descriptor_length, &format!("{label} descriptor"))?, entry)?;
        }
        ranges.insert(offset, LocalRange { data_offset, data_end });
        expected = next as u64;
    }
    if expected != central_offset as u64 {
        return Err(invalid("X ZIP archive contains unindexed local data"));
    }
    Ok(ranges)
}

fn read_selected(archive: &[u8], entry: &Entry, range: LocalRange, limits: &StrictZipLimits) -> Result<StrictZipEntry> {
    let compressed = read_exact(
        archive,
        range.data_offset,
        range.data_end - range.data_offset,
        &format!("selected member {}", entry.name),
    )?;
    let output: Vec<u8> = if entry.method == STORED {
        compressed.to_vec()
    } else {
        let cap = (limits.max_member_bytes + 1).min(entry.uncompressed_size + 1);
        let mut decoder = DeflateDecoder::new(compressed).take(cap);
        let mut buffer = Vec::with_capacity(entry.uncompressed_size as usize);
        decoder
            .read_to_end(&mut buffer)
            .map_err(|_| invalid(format!("selected X ZIP member is invalid: {}", entry.name)))?;
        buffer
    };
    if output.len() as u64 != entry.uncompressed_size {
        return Err(invalid("selected X ZIP member has an incorrect output size"));
    }
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(&output);
    if hasher.finalize() != entry.crc32 {
        return Err(invalid("selected X ZIP member failed its CRC-32 check"));
    }
    Ok(StrictZipEntry {
        name: entry.name.clone(),
        bytes: output,
    })
}

/// Read and strictly validate an archive held in memory, returning only the
/// members whose names match `options.patterns`.
pub fn read_zip_entries_strict(
    archive: &[u8],
    options: &StrictZipOptions,
) -> Result<Vec<StrictZipEntry>> {
    let limits = &options.limits;
    if archive.is_empty() || archive.len() as u64 > limits.max_archive_bytes {
        return Err(invalid("X archive size is invalid"));
    }
    let selection = RegexSet::new(&options.patterns)
        .map_err(|e| invalid(format!("X ZIP selection patterns are invalid: {e}")))?;
    let directory = directory_from_eocd(archive, limits)?;
    let entries = central_entries(archive, directory, &selection, limits)?;
    let ranges = local_ranges(archive, &entries, directory.offset)?;
    let mut selected: HashMap<String, StrictZipEntry> = HashMap::new();
    for entry in &entries {
        if !entry.selected {
            continue;
        }
        let range = ranges
            .get(&entry.local_header_offset)
            .copied()
            .ok_or_else(|| invalid("X ZIP selected member has no validated local range"))?;
        let member = read_selected(archive, entry, range, limits)?;
        if selected.insert(member.name.clone(), member).is_some() {
            return Err(invalid("X ZIP archive contains a duplicate selected member"));
        }
    }
    Ok(selected.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut cursor);
            for (name, bytes) in entries {
                zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn options(patterns: &[&str]) -> StrictZipOptions {
        StrictZipOptions {
            patterns: patterns.iter().map(|p| p.to_string()).collect(),
            limits: StrictZipLimits::default(),
        }
    }

    #[test]
    fn reads_selected_deflated_and_stored_members() {
        let archive = make_test_zip(&[
            ("data/manifest.js", b"manifest-bytes"),
            ("data/account.js", b"account-bytes"),
            ("data/direct-messages.js", b"dm-bytes"),
            ("assets/image.png", b"not-selected"),
        ]);
        let entries = read_zip_entries_strict(&archive, &options(&[r"^data/.*\.js$"])).unwrap();
        let names: HashSet<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names.len(), 3);
        assert!(names.contains("data/manifest.js"));
        let manifest = entries.iter().find(|e| e.name == "data/manifest.js").unwrap();
        assert_eq!(manifest.bytes, b"manifest-bytes");
    }

    #[test]
    fn rejects_truncated_archive() {
        let archive = make_test_zip(&[("data/manifest.js", b"x")]);
        let truncated = &archive[..archive.len() - 4];
        assert!(read_zip_entries_strict(truncated, &options(&[r"^data/.*\.js$"])).is_err());
    }

    #[test]
    fn rejects_nonmatching_archives() {
        let archive = make_test_zip(&[("readme.txt", b"hi")]);
        let entries = read_zip_entries_strict(&archive, &options(&[r"^data/.*\.js$"])).unwrap();
        assert!(entries.is_empty());
    }
}
