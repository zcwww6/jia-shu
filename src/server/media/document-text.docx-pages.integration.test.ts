import { describe, expect, it, vi } from "vitest";

import { extractDocumentText } from "./document-text";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORDPROCESSINGML_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type StoredEntry = {
  name: string;
  data: Uint8Array;
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

function createStoredDocx(documentXml: string) {
  const encoder = new TextEncoder();
  const entries: StoredEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode("<Types/>") },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
  ];
  const localParts: Uint8Array[] = [];
  const localEntries: Array<{ name: Uint8Array; data: Uint8Array; offset: number }> = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, entry.data.byteLength, true);
    view.setUint32(22, entry.data.byteLength, true);
    view.setUint16(26, name.byteLength, true);

    localParts.push(header, name, entry.data);
    localEntries.push({ name, data: entry.data, offset: localOffset });
    localOffset += header.byteLength + name.byteLength + entry.data.byteLength;
  }

  const centralDirectoryOffset = localOffset;
  const centralParts: Uint8Array[] = [];

  for (const entry of localEntries) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(20, entry.data.byteLength, true);
    view.setUint32(24, entry.data.byteLength, true);
    view.setUint16(28, entry.name.byteLength, true);
    view.setUint32(42, entry.offset, true);

    centralParts.push(header, entry.name);
  }

  const centralDirectory = concatenate(centralParts);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, centralDirectoryOffset, true);

  return concatenate([...localParts, centralDirectory, endOfCentralDirectory]);
}

function wordDocumentXml(contents: string) {
  return `<x:document xmlns:x="${WORDPROCESSINGML_NAMESPACE}"><x:body>${contents}</x:body></x:document>`;
}

describe("DOCX namespace-aware logical page limits", () => {
  it.each([
    ["explicit page breaks", "<x:br x:type=\"page\"/>".repeat(100)],
    ["rendered page breaks", "<x:lastRenderedPageBreak/>".repeat(100)],
  ])("rejects 101 pages from non-w-prefixed %s before the adapter runs", async (_description, contents) => {
    const extractText = vi.fn(async () => "DOCX text");

    await expect(extractDocumentText({
      bytes: createStoredDocx(wordDocumentXml(contents)),
      mimeType: DOCX_MIME_TYPE,
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCUMENT_PAGE_LIMIT", status: 422 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("counts paginating section properties, including a missing type as the default page break", async () => {
    const extractText = vi.fn(async () => "DOCX text");
    const typedSections = Array.from({ length: 100 }, (_, index) => {
      const sectionType = ["nextPage", "oddPage", "evenPage"][index % 3];
      return `<x:sectPr><x:type x:val="${sectionType}"/></x:sectPr>`;
    }).join("");

    await expect(extractDocumentText({
      bytes: createStoredDocx(wordDocumentXml(`${typedSections}<x:sectPr/>`)),
      mimeType: DOCX_MIME_TYPE,
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCUMENT_PAGE_LIMIT", status: 422 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("permits a non-w-prefixed DOCX at the 100-page logical limit", async () => {
    const extractText = vi.fn(async () => "DOCX text");
    const bytes = createStoredDocx(wordDocumentXml("<x:br x:type=\"page\"/>".repeat(99)));

    await expect(extractDocumentText({
      bytes,
      mimeType: DOCX_MIME_TYPE,
      adapters: { docx: { extractText } },
    })).resolves.toBe("DOCX text");

    expect(extractText).toHaveBeenCalledWith(bytes);
  });

  it("maps malformed document XML to a safe domain error before the adapter runs", async () => {
    const extractText = vi.fn(async () => "DOCX text");
    const malformedXml = `<x:document xmlns:x="${WORDPROCESSINGML_NAMESPACE}"><x:body><x:br></x:body></x:document>`;

    await expect(extractDocumentText({
      bytes: createStoredDocx(malformedXml),
      mimeType: DOCX_MIME_TYPE,
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCX_XML_INVALID", status: 422 });

    expect(extractText).not.toHaveBeenCalled();
  });
});
