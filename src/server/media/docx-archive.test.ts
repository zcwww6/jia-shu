import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { DomainError } from "../domain-error";
import { extractSafeDocxDocumentXml } from "./docx-archive";

type ZipEntry = {
  name: string;
  localName?: string;
  compressedData: Uint8Array;
  uncompressedSize: number;
  method: number;
  flags?: number;
  centralCompressedSize?: number;
  centralUncompressedSize?: number;
  localCompressedSize?: number;
  localUncompressedSize?: number;
};

function concatenate(parts: Uint8Array[]) {
  const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralEntries: Array<{
    entry: ZipEntry;
    localOffset: number;
  }> = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.localName ?? entry.name);
    const localHeader = new Uint8Array(30);
    const view = new DataView(localHeader.buffer);
    const compressedSize = entry.localCompressedSize ?? entry.compressedData.byteLength;
    const uncompressedSize = entry.localUncompressedSize ?? entry.uncompressedSize;

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, entry.flags ?? 0, true);
    view.setUint16(8, entry.method, true);
    view.setUint32(14, 0, true);
    view.setUint32(18, compressedSize, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, name.byteLength, true);
    view.setUint16(28, 0, true);

    localParts.push(localHeader, name, entry.compressedData);
    centralEntries.push({ entry, localOffset });
    localOffset += localHeader.byteLength + name.byteLength + entry.compressedData.byteLength;
  }

  const centralDirectoryOffset = localOffset;
  const centralParts: Uint8Array[] = [];

  for (const { entry, localOffset: entryOffset } of centralEntries) {
    const centralName = encoder.encode(entry.name);
    const centralHeader = new Uint8Array(46);
    const view = new DataView(centralHeader.buffer);
    const compressedSize = entry.centralCompressedSize ?? entry.compressedData.byteLength;
    const uncompressedSize = entry.centralUncompressedSize ?? entry.uncompressedSize;

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, entry.flags ?? 0, true);
    view.setUint16(10, entry.method, true);
    view.setUint32(16, 0, true);
    view.setUint32(20, compressedSize, true);
    view.setUint32(24, uncompressedSize, true);
    view.setUint16(28, centralName.byteLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entryOffset, true);

    centralParts.push(centralHeader, centralName);
  }

  const centralDirectory = concatenate(centralParts);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, centralDirectoryOffset, true);

  return {
    bytes: concatenate([...localParts, centralDirectory, endOfCentralDirectory]),
    centralDirectoryOffset,
    endOfCentralDirectoryOffset: centralDirectoryOffset + centralDirectory.byteLength,
  };
}

async function expectArchiveError(bytes: Uint8Array) {
  const error = await extractSafeDocxDocumentXml(bytes).catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(DomainError);
  return error;
}

describe("DOCX archive validation", () => {
  it("returns word/document.xml from a minimal stored DOCX archive", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([
      {
        name: "[Content_Types].xml",
        compressedData: new TextEncoder().encode("<Types/>"),
        uncompressedSize: 8,
        method: 0,
      },
      {
        name: "word/document.xml",
        compressedData: documentXml,
        uncompressedSize: documentXml.byteLength,
        method: 0,
      },
    ]);

    const extractedDocumentXml = await extractSafeDocxDocumentXml(archive.bytes);

    expect([...extractedDocumentXml]).toEqual([...documentXml]);
  });

  it("accepts a stored word/document.xml at the 8 MiB entry limit", async () => {
    const documentXml = new Uint8Array(8 * 1024 * 1024).fill(0x20);
    documentXml.set(new TextEncoder().encode("<w:document/>"));
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      method: 0,
    }]);

    expect(archive.bytes.byteLength).toBeLessThan(10 * 1024 * 1024);

    const extractedDocumentXml = await extractSafeDocxDocumentXml(archive.bytes);

    expect(extractedDocumentXml.byteLength).toBe(documentXml.byteLength);
  });

  it("rejects a stored word/document.xml above the 8 MiB entry limit", async () => {
    const documentXml = new Uint8Array(8 * 1024 * 1024 + 1).fill(0x20);
    documentXml.set(new TextEncoder().encode("<w:document/>"));
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      method: 0,
    }]);

    expect(archive.bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });

  it("rejects raw DOCX bytes above 10 MiB", async () => {
    await expect(expectArchiveError(new Uint8Array(10 * 1024 * 1024 + 1))).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });

  it("rejects an archive with more than 1024 central-directory entries", async () => {
    const archive = createZip(Array.from({ length: 1025 }, (_, index) => ({
      name: index === 0 ? "word/document.xml" : `word/entry-${index}.xml`,
      compressedData: new Uint8Array(),
      uncompressedSize: 0,
      method: 0 as const,
    })));

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });

  it("rejects a central directory larger than 1 MiB", async () => {
    const longNamePrefix = "a".repeat(1_000);
    const archive = createZip(Array.from({ length: 1024 }, (_, index) => ({
      name: `${longNamePrefix}-${index}`,
      compressedData: new Uint8Array(),
      uncompressedSize: 0,
      method: 0,
    })));

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });

  it("rejects an entry whose central-directory local offset is out of bounds", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      method: 0,
    }]);
    new DataView(archive.bytes.buffer).setUint32(
      archive.centralDirectoryOffset + 42,
      archive.bytes.byteLength,
      true,
    );

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_INVALID",
      status: 422,
    });
  });

  it("rejects a local entry name that differs from the central-directory name", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([{
      name: "word/document.xml",
      localName: "word/document.xml.hidden",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      method: 0,
    }]);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_INVALID",
      status: 422,
    });
  });

  it.each([
    ["encrypted", { flags: 0x0001, method: 0 }],
    ["unsupported compression", { method: 12 }],
  ])("rejects %s entry metadata", async (_description, overrides) => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      ...overrides,
    }]);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_INVALID",
      status: 422,
    });
  });

  it("rejects a stored entry whose declared uncompressed size differs from its actual data", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      centralUncompressedSize: 1,
      localUncompressedSize: 1,
      method: 0,
    }]);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_INVALID",
      status: 422,
    });
  });

  it("rejects ZIP64 sentinel values in the end of central directory", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const archive = createZip([{
      name: "word/document.xml",
      compressedData: documentXml,
      uncompressedSize: documentXml.byteLength,
      method: 0,
    }]);
    new DataView(archive.bytes.buffer).setUint16(archive.endOfCentralDirectoryOffset + 10, 0xffff, true);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_INVALID",
      status: 422,
    });
  });

  it("rejects deflate data whose actual expansion exceeds the entry limit despite a small declared size", async () => {
    const expandedData = new Uint8Array(8 * 1024 * 1024 + 1);
    const compressedData = new Uint8Array(deflateRawSync(expandedData));
    const archive = createZip([{
      name: "word/document.xml",
      compressedData,
      uncompressedSize: expandedData.byteLength,
      centralUncompressedSize: 1,
      localUncompressedSize: 1,
      method: 8,
    }]);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });

  it("rejects cumulative actual DEFLATE output above the 32 MiB archive limit", async () => {
    const documentXml = new TextEncoder().encode("<w:document/>");
    const expandedData = new Uint8Array(8 * 1024 * 1024);
    const compressedData = new Uint8Array(deflateRawSync(expandedData));
    const archive = createZip([
      {
        name: "word/document.xml",
        compressedData: documentXml,
        uncompressedSize: documentXml.byteLength,
        method: 0,
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        name: `word/part-${index}.xml`,
        compressedData,
        uncompressedSize: expandedData.byteLength,
        method: 8,
      })),
    ]);

    await expect(expectArchiveError(archive.bytes)).resolves.toMatchObject({
      code: "DOCX_ARCHIVE_LIMIT",
      status: 413,
    });
  });
});
