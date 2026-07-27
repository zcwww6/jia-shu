import { DOMParser } from "@xmldom/xmldom";
import mammoth from "mammoth";

import { DomainError } from "../domain-error";
import { extractSafeDocxDocumentXml } from "./docx-archive";

const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown"]);
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME_TYPE = "application/pdf";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_PAGES = 100;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const WORDPROCESSINGML_NAMESPACES = [
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
];

export type DocumentTextAdapters = {
  docx?: {
    extractText: (bytes: Uint8Array) => Promise<string>;
  };
  pdf?: {
    extractText: (bytes: Uint8Array) => Promise<{ pages: number; text: string }>;
  };
};

const defaultDocxAdapter: Required<DocumentTextAdapters>["docx"] = {
  async extractText(bytes) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  },
};

function isTextItem(item: unknown): item is { str: string } {
  return (
    typeof item === "object"
    && item !== null
    && "str" in item
    && typeof (item as { str?: unknown }).str === "string"
  );
}

function isPdfTextChunk(value: unknown): value is { items: unknown[] } {
  return (
    typeof value === "object"
    && value !== null
    && "items" in value
    && Array.isArray((value as { items?: unknown }).items)
  );
}

function invalidDocxXml(): never {
  throw new DomainError("DOCX_XML_INVALID", 422);
}

function mapPdfError(error: unknown) {
  if (error instanceof DomainError) {
    return error;
  }

  return new DomainError("DOCUMENT_PDF_INVALID", 422);
}

function parseDocxDocumentXml(documentXml: Uint8Array) {
  let parseFailed = false;
  let xml: string;

  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(documentXml);
  } catch {
    invalidDocxXml();
  }

  try {
    const document = new DOMParser({
      errorHandler: {
        warning: () => {
          parseFailed = true;
        },
        error: () => {
          parseFailed = true;
        },
        fatalError: () => {
          parseFailed = true;
        },
      },
    }).parseFromString(xml, "application/xml");

    if (parseFailed || !document.documentElement) {
      invalidDocxXml();
    }

    return document;
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    invalidDocxXml();
  }
}

function getWordprocessingElements(document: Document, localName: string) {
  return WORDPROCESSINGML_NAMESPACES.flatMap((namespace) => Array.from(
    document.getElementsByTagNameNS(namespace, localName),
  ));
}

function getWordprocessingAttribute(element: Element, localName: string) {
  for (const namespace of WORDPROCESSINGML_NAMESPACES) {
    const value = element.getAttributeNS(namespace, localName);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function isWordprocessingElement(element: Element, localName: string) {
  const namespace = element.namespaceURI;

  return (
    element.localName === localName
    && namespace !== null
    && WORDPROCESSINGML_NAMESPACES.includes(namespace)
  );
}

function isPaginatingSectionBoundary(sectionProperties: Element) {
  let sectionType: Element | undefined;

  for (let child = sectionProperties.firstElementChild; child; child = child.nextElementSibling) {
    if (isWordprocessingElement(child, "type")) {
      sectionType = child;
      break;
    }
  }

  if (!sectionType) {
    return true;
  }

  return getWordprocessingAttribute(sectionType, "val") !== "continuous";
}

function countDocxLogicalPages(documentXml: Uint8Array) {
  const document = parseDocxDocumentXml(documentXml);
  let pageBreakCount = 0;

  // DOCX stores pagination hints rather than rendered pages, so this is a conservative logical estimate.
  for (let index = 0; index < getWordprocessingElements(document, "lastRenderedPageBreak").length; index += 1) {
    pageBreakCount += 1;

    if (pageBreakCount >= MAX_DOCUMENT_PAGES) {
      return MAX_DOCUMENT_PAGES + 1;
    }
  }

  for (const lineBreak of getWordprocessingElements(document, "br")) {
    if (getWordprocessingAttribute(lineBreak, "type") !== "page") {
      continue;
    }

    pageBreakCount += 1;

    if (pageBreakCount >= MAX_DOCUMENT_PAGES) {
      return MAX_DOCUMENT_PAGES + 1;
    }
  }

  for (const sectionProperties of getWordprocessingElements(document, "sectPr")) {
    if (!isPaginatingSectionBoundary(sectionProperties)) {
      continue;
    }

    pageBreakCount += 1;

    if (pageBreakCount >= MAX_DOCUMENT_PAGES) {
      return MAX_DOCUMENT_PAGES + 1;
    }
  }

  return pageBreakCount + 1;
}

async function readPdfPageText(page: { streamTextContent: () => ReadableStream<unknown> }, initialCharacterCount: number) {
  const reader = page.streamTextContent().getReader();
  const textParts: string[] = [];
  let extractedCharacterCount = initialCharacterCount;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return { text: textParts.join(""), extractedCharacterCount };
      }

      if (!isPdfTextChunk(value)) {
        continue;
      }

      for (const item of value.items) {
        if (!isTextItem(item)) {
          continue;
        }

        extractedCharacterCount += item.str.length;

        if (extractedCharacterCount > MAX_EXTRACTED_CHARACTERS) {
          await reader.cancel().catch(() => undefined);
          throw new DomainError("DOCUMENT_TEXT_LIMIT", 422);
        }

        textParts.push(item.str);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const defaultPdfAdapter: Required<DocumentTextAdapters>["pdf"] = {
  async extractText(bytes) {
    let loadingTask: { destroy: () => Promise<void> | void } | undefined;
    let primaryError: DomainError | undefined;

    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // These options and streaming cap memory/recovery work, but PDF.js still parses on this thread.
      // A hard CPU deadline requires worker isolation and cannot be provided by this adapter alone.
      const documentOptions: Parameters<typeof pdfjs.getDocument>[0] & { isEvalSupported: boolean } = {
        data: bytes,
        stopAtErrors: true,
        isEvalSupported: false,
        useWasm: false,
        maxImageSize: 4_000_000,
      };
      const task = pdfjs.getDocument(documentOptions);
      loadingTask = task;
      const document = await task.promise;

      if (document.numPages > MAX_DOCUMENT_PAGES) {
        throw new DomainError("DOCUMENT_PAGE_LIMIT", 422);
      }

      const pageTexts: string[] = [];
      let extractedCharacterCount = 0;

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);

        if (pageTexts.length > 0) {
          extractedCharacterCount += 1;
        }

        if (extractedCharacterCount > MAX_EXTRACTED_CHARACTERS) {
          throw new DomainError("DOCUMENT_TEXT_LIMIT", 422);
        }

        const pageText = await readPdfPageText(page, extractedCharacterCount);
        extractedCharacterCount = pageText.extractedCharacterCount;
        pageTexts.push(pageText.text);
      }

      return { pages: document.numPages, text: pageTexts.join("\n") };
    } catch (error) {
      primaryError = mapPdfError(error);
      throw primaryError;
    } finally {
      if (loadingTask) {
        try {
          await loadingTask.destroy();
        } catch (error) {
          if (!primaryError) {
            throw mapPdfError(error);
          }
        }
      }
    }
  },
};

function normalizeText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function normalizeAndLimitText(text: string) {
  const normalizedText = normalizeText(text);

  if (normalizedText.length > MAX_EXTRACTED_CHARACTERS) {
    throw new DomainError("DOCUMENT_TEXT_LIMIT", 422);
  }

  return normalizedText;
}

export async function extractDocumentText(input: {
  bytes: Uint8Array;
  mimeType: string;
  adapters?: DocumentTextAdapters;
}) {
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DomainError("DOCUMENT_SIZE_LIMIT", 413);
  }

  if (TEXT_MIME_TYPES.has(input.mimeType)) {
    return normalizeAndLimitText(new TextDecoder().decode(input.bytes));
  }

  if (input.mimeType === DOCX_MIME_TYPE) {
    const documentXml = await extractSafeDocxDocumentXml(input.bytes);

    if (countDocxLogicalPages(documentXml) > MAX_DOCUMENT_PAGES) {
      throw new DomainError("DOCUMENT_PAGE_LIMIT", 422);
    }

    const adapter = input.adapters?.docx ?? defaultDocxAdapter;
    return normalizeAndLimitText(await adapter.extractText(input.bytes));
  }

  if (input.mimeType === PDF_MIME_TYPE) {
    const adapter = input.adapters?.pdf ?? defaultPdfAdapter;
    const result = await adapter.extractText(input.bytes);

    if (result.pages > MAX_DOCUMENT_PAGES) {
      throw new DomainError("DOCUMENT_PAGE_LIMIT", 422);
    }

    const text = normalizeAndLimitText(result.text);

    if (!text) {
      throw new DomainError("DOCUMENT_TEXT_REQUIRED", 422);
    }

    return text;
  }

  throw new DomainError("DOCUMENT_TYPE_UNSUPPORTED", 415);
}
