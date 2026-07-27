import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

import { DomainError } from "../domain-error";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAGS = 0x0001 | 0x0040;
const STORE_COMPRESSION_METHOD = 0;
const DEFLATE_COMPRESSION_METHOD = 8;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_ENTRY_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_DECOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const WORD_DOCUMENT_XML_NAME = new TextEncoder().encode("word/document.xml");
const inflateRawAsync = promisify(inflateRaw);

type ArchiveEntry = {
  name: Uint8Array;
  flags: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

type LocalEntryData = {
  recordStart: number;
  recordEnd: number;
  compressedData: Uint8Array;
};

function invalidArchive(): never {
  throw new DomainError("DOCX_ARCHIVE_INVALID", 422);
}

function archiveLimitExceeded(): never {
  throw new DomainError("DOCX_ARCHIVE_LIMIT", 413);
}

function ensureRange(bytes: Uint8Array, offset: number, length: number, upperBound = bytes.byteLength) {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || upperBound < 0
    || offset > upperBound
    || length > upperBound - offset
  ) {
    invalidArchive();
  }
}

function readUint16(view: DataView, bytes: Uint8Array, offset: number) {
  ensureRange(bytes, offset, 2);
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, bytes: Uint8Array, offset: number) {
  ensureRange(bytes, offset, 4);
  return view.getUint32(offset, true);
}

function hasBytesAt(bytes: Uint8Array, offset: number, expected: Uint8Array) {
  if (offset < 0 || offset > bytes.byteLength - expected.byteLength) {
    return false;
  }

  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasZip64ExtraField(view: DataView, bytes: Uint8Array, offset: number, length: number) {
  ensureRange(bytes, offset, length);
  const end = offset + length;
  let cursor = offset;

  while (cursor < end) {
    if (end - cursor < 4) {
      invalidArchive();
    }

    const id = readUint16(view, bytes, cursor);
    const fieldLength = readUint16(view, bytes, cursor + 2);
    cursor += 4;

    if (fieldLength > end - cursor) {
      invalidArchive();
    }

    if (id === ZIP64_EXTRA_FIELD_ID) {
      invalidArchive();
    }

    cursor += fieldLength;
  }
}

function validateEntryMetadata(flags: number, compressionMethod: number) {
  if ((flags & ENCRYPTED_FLAGS) !== 0) {
    invalidArchive();
  }

  if (compressionMethod !== STORE_COMPRESSION_METHOD && compressionMethod !== DEFLATE_COMPRESSION_METHOD) {
    invalidArchive();
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
  if (bytes.byteLength < 22) {
    invalidArchive();
  }

  const minimumOffset = Math.max(0, bytes.byteLength - MAX_UINT16 - 22);

  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = view.getUint16(offset + 20, true);

    if (offset + 22 + commentLength !== bytes.byteLength) {
      continue;
    }

    if (
      offset >= 20
      && view.getUint32(offset - 20, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
    ) {
      invalidArchive();
    }

    const diskNumber = view.getUint16(offset + 4, true);
    const centralDirectoryStartDisk = view.getUint16(offset + 6, true);
    const entriesOnDisk = view.getUint16(offset + 8, true);
    const entryCount = view.getUint16(offset + 10, true);
    const centralDirectorySize = view.getUint32(offset + 12, true);
    const centralDirectoryOffset = view.getUint32(offset + 16, true);

    if (
      diskNumber !== 0
      || centralDirectoryStartDisk !== 0
      || entriesOnDisk !== entryCount
      || entriesOnDisk === MAX_UINT16
      || entryCount === MAX_UINT16
      || centralDirectorySize === MAX_UINT32
      || centralDirectoryOffset === MAX_UINT32
    ) {
      invalidArchive();
    }

    if (entryCount > MAX_ENTRIES || centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
      archiveLimitExceeded();
    }

    ensureRange(bytes, centralDirectoryOffset, centralDirectorySize);

    if (centralDirectoryOffset + centralDirectorySize !== offset) {
      invalidArchive();
    }

    return { centralDirectoryOffset, centralDirectorySize, entryCount };
  }

  invalidArchive();
}

function parseCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  centralDirectoryOffset: number,
  centralDirectorySize: number,
  entryCount: number,
) {
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const entries: ArchiveEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(bytes, cursor, 46, centralDirectoryEnd);

    if (readUint32(view, bytes, cursor) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      invalidArchive();
    }

    const versionNeeded = readUint16(view, bytes, cursor + 6);
    const flags = readUint16(view, bytes, cursor + 8);
    const compressionMethod = readUint16(view, bytes, cursor + 10);
    const compressedSize = readUint32(view, bytes, cursor + 20);
    const uncompressedSize = readUint32(view, bytes, cursor + 24);
    const nameLength = readUint16(view, bytes, cursor + 28);
    const extraLength = readUint16(view, bytes, cursor + 30);
    const commentLength = readUint16(view, bytes, cursor + 32);
    const diskNumberStart = readUint16(view, bytes, cursor + 34);
    const localOffset = readUint32(view, bytes, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;

    if (
      versionNeeded >= 45
      || compressedSize === MAX_UINT32
      || uncompressedSize === MAX_UINT32
      || localOffset === MAX_UINT32
      || diskNumberStart !== 0
    ) {
      invalidArchive();
    }

    validateEntryMetadata(flags, compressionMethod);
    ensureRange(bytes, cursor, recordLength, centralDirectoryEnd);

    const nameOffset = cursor + 46;
    const extraOffset = nameOffset + nameLength;
    hasZip64ExtraField(view, bytes, extraOffset, extraLength);

    entries.push({
      name: bytes.slice(nameOffset, nameOffset + nameLength),
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += recordLength;
  }

  if (cursor !== centralDirectoryEnd) {
    invalidArchive();
  }

  return entries;
}

function resolveLocalEntryData(
  bytes: Uint8Array,
  view: DataView,
  entry: ArchiveEntry,
  centralDirectoryOffset: number,
): LocalEntryData {
  if (entry.localOffset >= centralDirectoryOffset) {
    invalidArchive();
  }

  ensureRange(bytes, entry.localOffset, 30, centralDirectoryOffset);

  if (readUint32(view, bytes, entry.localOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    invalidArchive();
  }

  const versionNeeded = readUint16(view, bytes, entry.localOffset + 4);
  const flags = readUint16(view, bytes, entry.localOffset + 6);
  const compressionMethod = readUint16(view, bytes, entry.localOffset + 8);
  const localCompressedSize = readUint32(view, bytes, entry.localOffset + 18);
  const localUncompressedSize = readUint32(view, bytes, entry.localOffset + 22);
  const nameLength = readUint16(view, bytes, entry.localOffset + 26);
  const extraLength = readUint16(view, bytes, entry.localOffset + 28);
  const headerLength = 30 + nameLength + extraLength;

  if (
    versionNeeded >= 45
    || localCompressedSize === MAX_UINT32
    || localUncompressedSize === MAX_UINT32
    || flags !== entry.flags
    || compressionMethod !== entry.compressionMethod
  ) {
    invalidArchive();
  }

  validateEntryMetadata(flags, compressionMethod);
  ensureRange(bytes, entry.localOffset, headerLength, centralDirectoryOffset);

  const nameOffset = entry.localOffset + 30;
  const extraOffset = nameOffset + nameLength;

  if (nameLength !== entry.name.byteLength || !hasBytesAt(bytes, nameOffset, entry.name)) {
    invalidArchive();
  }

  hasZip64ExtraField(view, bytes, extraOffset, extraLength);

  if ((flags & DATA_DESCRIPTOR_FLAG) === 0 && (
    localCompressedSize !== entry.compressedSize
    || localUncompressedSize !== entry.uncompressedSize
  )) {
    invalidArchive();
  }

  const dataOffset = entry.localOffset + headerLength;
  ensureRange(bytes, dataOffset, entry.compressedSize, centralDirectoryOffset);

  return {
    recordStart: entry.localOffset,
    recordEnd: dataOffset + entry.compressedSize,
    compressedData: bytes.subarray(dataOffset, dataOffset + entry.compressedSize),
  };
}

function isWordDocumentXml(name: Uint8Array) {
  return hasBytesAt(name, 0, WORD_DOCUMENT_XML_NAME) && name.byteLength === WORD_DOCUMENT_XML_NAME.byteLength;
}

function isOutputLimitError(error: unknown) {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

async function inflateEntry(entry: ArchiveEntry, compressedData: Uint8Array, remainingTotalBytes: number) {
  if (entry.compressionMethod === STORE_COMPRESSION_METHOD) {
    if (
      entry.uncompressedSize > MAX_ENTRY_DECOMPRESSED_BYTES
      || entry.compressedSize > MAX_ENTRY_DECOMPRESSED_BYTES
      || compressedData.byteLength > MAX_ENTRY_DECOMPRESSED_BYTES
      || entry.uncompressedSize > remainingTotalBytes
      || entry.compressedSize > remainingTotalBytes
      || compressedData.byteLength > remainingTotalBytes
    ) {
      archiveLimitExceeded();
    }

    if (
      entry.compressedSize !== entry.uncompressedSize
      || compressedData.byteLength !== entry.uncompressedSize
    ) {
      invalidArchive();
    }

    return compressedData;
  }

  const maxOutputLength = Math.max(
    1,
    Math.min(MAX_ENTRY_DECOMPRESSED_BYTES, remainingTotalBytes),
  );
  let inflated: Uint8Array;

  try {
    inflated = await inflateRawAsync(compressedData, { maxOutputLength });
  } catch (error) {
    if (isOutputLimitError(error)) {
      archiveLimitExceeded();
    }

    invalidArchive();
  }

  if (
    inflated.byteLength > MAX_ENTRY_DECOMPRESSED_BYTES
    || inflated.byteLength > remainingTotalBytes
  ) {
    archiveLimitExceeded();
  }

  if (inflated.byteLength !== entry.uncompressedSize) {
    invalidArchive();
  }

  return inflated;
}

export async function extractSafeDocxDocumentXml(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    archiveLimitExceeded();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { centralDirectoryOffset, centralDirectorySize, entryCount } = findEndOfCentralDirectory(bytes, view);
  const entries = parseCentralDirectory(
    bytes,
    view,
    centralDirectoryOffset,
    centralDirectorySize,
    entryCount,
  );
  const localEntries = entries.map((entry) => ({
    entry,
    data: resolveLocalEntryData(bytes, view, entry, centralDirectoryOffset),
  }));
  const sortedLocalEntries = [...localEntries].sort((left, right) => left.data.recordStart - right.data.recordStart);

  for (let index = 1; index < sortedLocalEntries.length; index += 1) {
    if (sortedLocalEntries[index].data.recordStart < sortedLocalEntries[index - 1].data.recordEnd) {
      invalidArchive();
    }
  }

  let totalDecompressedBytes = 0;
  let documentXml: Uint8Array | undefined;

  for (const { entry, data } of localEntries) {
    const inflated = await inflateEntry(
      entry,
      data.compressedData,
      MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes,
    );

    if (inflated.byteLength > MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes) {
      archiveLimitExceeded();
    }

    totalDecompressedBytes += inflated.byteLength;

    if (isWordDocumentXml(entry.name)) {
      if (documentXml) {
        invalidArchive();
      }

      documentXml = inflated.slice();
    }
  }

  if (!documentXml) {
    throw new DomainError("DOCX_DOCUMENT_XML_MISSING", 422);
  }

  return documentXml;
}
