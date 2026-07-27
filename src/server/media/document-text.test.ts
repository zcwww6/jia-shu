import { describe, expect, it, vi } from "vitest";

const mammoth = vi.hoisted(() => ({
  extractRawText: vi.fn(),
}));
const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock("mammoth", () => ({ default: mammoth }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => pdfjs);

import { DomainError } from "../domain-error";
import { extractDocumentText } from "./document-text";

const WORDPROCESSINGML_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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

function createStoredDocx(documentXml = `<x:document xmlns:x="${WORDPROCESSINGML_NAMESPACE}"><x:body/></x:document>`) {
  const encoder = new TextEncoder();
  const entries = [
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
    view.setUint16(8, 0, true);
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

describe("document text", () => {
  it("decodes supported plain text from bytes", async () => {
    await expect(extractDocumentText({
      bytes: new TextEncoder().encode("A family memory"),
      mimeType: "text/plain",
    })).resolves.toBe("A family memory");
  });

  it.each(["text/plain", "text/markdown"])("rejects oversized %s before decoding", async (mimeType) => {
    await expect(extractDocumentText({
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      mimeType,
    })).rejects.toMatchObject({ code: "DOCUMENT_SIZE_LIMIT", status: 413 });
  });

  it("normalizes extracted text before returning it", async () => {
    await expect(extractDocumentText({
      bytes: new TextEncoder().encode("\uFEFF  First line  \r\n\r\nSecond line  "),
      mimeType: "text/plain",
    })).resolves.toBe("First line\n\nSecond line");
  });

  it("rejects HTML before decoding its bytes", async () => {
    const error = await extractDocumentText({
      bytes: new TextEncoder().encode("<p>not an upload type</p>"),
      mimeType: "text/html",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "DOCUMENT_TYPE_UNSUPPORTED" });
  });

  it("decodes Markdown through TextDecoder", async () => {
    await expect(extractDocumentText({
      bytes: new TextEncoder().encode("# A title"),
      mimeType: "text/markdown",
    })).resolves.toBe("# A title");
  });

  it("rejects text over the extracted character limit", async () => {
    await expect(extractDocumentText({
      bytes: new TextEncoder().encode("a".repeat(100_001)),
      mimeType: "text/plain",
    })).rejects.toMatchObject({ code: "DOCUMENT_TEXT_LIMIT" });
  });

  it("normalizes text returned by an injected DOCX adapter", async () => {
    const bytes = createStoredDocx();
    const calls: Uint8Array[] = [];
    const adapters = {
      docx: {
        async extractText(receivedBytes: Uint8Array) {
          calls.push(receivedBytes);
          return "  DOCX memory\r\n";
        },
      },
    };

    await expect(extractDocumentText({
      bytes,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      adapters,
    })).resolves.toBe("DOCX memory");
    expect(calls).toEqual([bytes]);
  });

  it("rejects oversized DOCX bytes before calling an adapter", async () => {
    const extractText = vi.fn(async () => "DOCX memory");

    await expect(extractDocumentText({
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCUMENT_SIZE_LIMIT", status: 413 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("rejects an invalid DOCX archive before calling an adapter", async () => {
    const extractText = vi.fn(async () => "DOCX memory");

    await expect(extractDocumentText({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCX_ARCHIVE_INVALID", status: 422 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("rejects a DOCX with more than 100 logical page boundaries before calling an adapter", async () => {
    const extractText = vi.fn(async () => "DOCX memory");
    const documentXml = [
      `<x:document xmlns:x="${WORDPROCESSINGML_NAMESPACE}">`,
      "<x:lastRenderedPageBreak/>".repeat(50),
      "<x:br x:type=\"page\"/>".repeat(50),
      "</x:document>",
    ].join("");

    await expect(extractDocumentText({
      bytes: createStoredDocx(documentXml),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      adapters: { docx: { extractText } },
    })).rejects.toMatchObject({ code: "DOCUMENT_PAGE_LIMIT", status: 422 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("uses Mammoth by default when no DOCX adapter is injected", async () => {
    const bytes = createStoredDocx();
    mammoth.extractRawText.mockReset();
    mammoth.extractRawText.mockResolvedValue({ value: "  Default DOCX\r\n" });

    await expect(extractDocumentText({
      bytes,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).resolves.toBe("Default DOCX");
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: Buffer.from(bytes) });
  });

  it("normalizes text returned by an injected PDF adapter", async () => {
    const adapters = {
      pdf: {
        async extractText() {
          return { pages: 1, text: "  PDF memory\r\n" };
        },
      },
    };

    await expect(extractDocumentText({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
      adapters,
    })).resolves.toBe("PDF memory");
  });

  it("rejects oversized PDF bytes before calling an adapter", async () => {
    const extractText = vi.fn(async () => ({ pages: 1, text: "PDF memory" }));

    await expect(extractDocumentText({
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      mimeType: "application/pdf",
      adapters: { pdf: { extractText } },
    })).rejects.toMatchObject({ code: "DOCUMENT_SIZE_LIMIT", status: 413 });

    expect(extractText).not.toHaveBeenCalled();
  });

  it("uses PDF.js by default and destroys the parsed document", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: { items: [{ str: "Default " }, { str: "PDF" }] } })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const streamTextContent = vi.fn(() => ({ getReader: () => reader }));
    const getPage = vi.fn().mockResolvedValue({ streamTextContent });
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({ numPages: 1, getPage }),
    });

    await expect(extractDocumentText({
      bytes,
      mimeType: "application/pdf",
    })).resolves.toBe("Default PDF");
    expect(pdfjs.getDocument).toHaveBeenCalledWith({
      data: bytes,
      stopAtErrors: true,
      isEvalSupported: false,
      useWasm: false,
      maxImageSize: 4_000_000,
    });
    expect(getPage).toHaveBeenCalledWith(1);
    expect(streamTextContent).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("stops reading a PDF text stream at 100001 characters and destroys the loading task", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: { items: [{ str: "a".repeat(100_001) }] } })
        .mockResolvedValueOnce({ done: false, value: { items: [{ str: "must not be read" }] } }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const getPage = vi.fn().mockResolvedValue({
      streamTextContent: () => ({ getReader: () => reader }),
    });
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({ numPages: 1, getPage }),
    });

    await expect(extractDocumentText({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    })).rejects.toMatchObject({ code: "DOCUMENT_TEXT_LIMIT", status: 422 });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("maps a truncated PDF.js parse failure and destroys the loading task", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue({
      destroy,
      promise: Promise.reject(new Error("PDF.js parser details must not escape")),
    });

    const error = await extractDocumentText({
      bytes: new TextEncoder().encode("%PDF"),
      mimeType: "application/pdf",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: "DOCUMENT_PDF_INVALID",
      status: 422,
      message: "请求无法完成，请检查后重试。",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps a PDF domain error when loading-task destruction fails", async () => {
    const destroy = vi.fn().mockRejectedValue(new Error("PDF.js destroy details must not escape"));
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({ numPages: 101, getPage: vi.fn() }),
    });

    await expect(extractDocumentText({
      bytes: new TextEncoder().encode("%PDF"),
      mimeType: "application/pdf",
    })).rejects.toMatchObject({
      code: "DOCUMENT_PAGE_LIMIT",
      status: 422,
    });

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects a PDF above the page limit", async () => {
    const adapters = {
      pdf: {
        async extractText() {
          return { pages: 101, text: "PDF memory" };
        },
      },
    };

    await expect(extractDocumentText({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
      adapters,
    })).rejects.toMatchObject({ code: "DOCUMENT_PAGE_LIMIT" });
  });

  it("rejects PDF text above the extracted character limit", async () => {
    const adapters = {
      pdf: {
        async extractText() {
          return { pages: 1, text: "a".repeat(100_001) };
        },
      },
    };

    await expect(extractDocumentText({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
      adapters,
    })).rejects.toMatchObject({ code: "DOCUMENT_TEXT_LIMIT" });
  });

  it("rejects a blank PDF as a scanned document", async () => {
    const adapters = {
      pdf: {
        async extractText() {
          return { pages: 1, text: " \r\n\t " };
        },
      },
    };

    await expect(extractDocumentText({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
      adapters,
    })).rejects.toMatchObject({ code: "DOCUMENT_TEXT_REQUIRED" });
  });
});
