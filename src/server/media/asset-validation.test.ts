import { describe, expect, it, vi } from "vitest";

const fileType = vi.hoisted(() => ({
  fileTypeFromBuffer: vi.fn(),
}));
const sharp = vi.hoisted(() => vi.fn());
const audioMetadata = vi.hoisted(() => ({
  extractAudioMetadata: vi.fn(),
}));
const documentText = vi.hoisted(() => ({
  extractDocumentText: vi.fn(),
}));

vi.mock("file-type", () => fileType);
vi.mock("sharp", () => ({ default: sharp }));
vi.mock("./audio-metadata", () => audioMetadata);
vi.mock("./document-text", () => documentText);

import { DomainError } from "../domain-error";
import { validateAsset } from "./asset-validation";

describe("asset validation", () => {
  it("rejects a declared PNG whose magic MIME is JPEG", async () => {
    const error = await validateAsset({
      declaredMime: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "photo.png",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
      },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "ASSET_MIME_MISMATCH" });
  });

  it("returns trusted persisted metadata for a plain-text document", async () => {
    const bytes = new TextEncoder().encode("A family memory");
    const calls: Array<{ bytes: Uint8Array; mimeType: string }> = [];

    const result = await validateAsset({
      declaredMime: "text/plain",
      bytes,
      originalName: "memory.txt",
      adapters: {
        detect: async () => undefined,
        document: async ({ bytes: receivedBytes, mimeType }) => {
          calls.push({ bytes: receivedBytes, mimeType });
          return "A family memory";
        },
      },
    });

    expect(result).toEqual({
      trustedMime: "text/plain",
      extension: "txt",
      kind: "document",
      sizeBytes: bytes.byteLength,
      metadata: { extractedText: "A family memory" },
      derivatives: {},
    });
    expect(calls).toEqual([{ bytes, mimeType: "text/plain" }]);
  });

  it.each([
    ["script markup", "text/plain", new TextEncoder().encode("<script>alert(1)</script>"), "txt"],
    ["invalid UTF-8", "text/plain", new Uint8Array([0, 255, 1, 2]), "txt"],
    ["NUL/control bytes", "text/markdown", new TextEncoder().encode("# Memory\u0000\u0001"), "md"],
  ])("rejects detected %s before document extraction", async (_description, declaredMime, bytes, extension) => {
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime,
      bytes,
      originalName: `unsafe.${extension}`,
      adapters: {
        detect: async () => ({ mime: declaredMime, ext: extension }),
        document,
      },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(document).not.toHaveBeenCalled();
  });

  it("rejects a text disguise before a mismatched detector result can bypass textuality validation", async () => {
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime: "text/plain",
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      originalName: "unsafe.txt",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
        document,
      },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(document).not.toHaveBeenCalled();
  });

  it.each([
    ["an SVG event-handler payload", "<svg/onload=alert(1)>"],
    ["a javascript URI", "[Open](javascript:alert(1))"],
    ["an entity-encoded javascript URI", "[Open](javascript&#58;alert(1))"],
    ["a character-reference-obfuscated javascript URI", "[Open](jav&#x61;script&colon;alert(1))"],
    ["a vbscript URI", "[Open](vbscript:msgbox(1))"],
    ["a dangerous data URL", "[Open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["an entity-encoded dangerous data URL", "[Open](data&#x3A;text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["a whitespace-obfuscated dangerous data URL", "[Open](da&Tab;ta:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["a numeric-reference-obfuscated dangerous data URL", "[Open](d&#x0A;ata:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["a double-encoded javascript URI", "[x](javascript&amp;#58;alert(1))"],
    ["a double-encoded character-reference javascript URI", "[x](java&amp;#x73;cript&colon;alert(1))"],
    ["a double-encoded dangerous data URL", "[x](data&amp;#58;text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["an entity URI beyond the normalization limit", `[x](javascript&${"amp;".repeat(9)}#58;alert(1))`],
  ])("rejects %s before detection or document extraction", async (_description, payload) => {
    const detect = vi.fn(async () => {
      throw new Error("detection should not run");
    });
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime: "text/markdown",
      bytes: new TextEncoder().encode(payload),
      originalName: "unsafe.md",
      adapters: { detect, document },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(detect).not.toHaveBeenCalled();
    expect(document).not.toHaveBeenCalled();
  });

  it("accepts a benign escaped ampersand in Markdown", async () => {
    const bytes = new TextEncoder().encode("Fish &amp; Chips");

    await expect(validateAsset({
      declaredMime: "text/markdown",
      bytes,
      originalName: "memory.md",
      adapters: {
        detect: async () => undefined,
        document: async () => "Fish &amp; Chips",
      },
    })).resolves.toMatchObject({
      trustedMime: "text/markdown",
      metadata: { extractedText: "Fish &amp; Chips" },
    });
  });

  it("rejects oversized invalid UTF-8 text before detection, decoding, or document extraction", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    bytes[0] = 0xff;
    const detect = vi.fn(async () => undefined);
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });
    const decode = vi.spyOn(TextDecoder.prototype, "decode");

    try {
      await expect(validateAsset({
        declaredMime: "text/plain",
        bytes,
        originalName: "too-large.txt",
        adapters: { detect, document },
      })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT", status: 413 });

      expect(detect).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
      expect(document).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });

  it.each([
    ["text/plain", "txt", "A family memory"],
    ["text/markdown", "md", "# A family memory"],
  ])("extracts detected %s with the whitelisted extension", async (declaredMime, extension, extractedText) => {
    const bytes = new TextEncoder().encode(extractedText);
    const calls: Array<{ bytes: Uint8Array; mimeType: string }> = [];

    const result = await validateAsset({
      declaredMime,
      bytes,
      originalName: "memory.txt",
      adapters: {
        detect: async () => ({ mime: declaredMime, ext: "untrusted-extension" }),
        document: async ({ bytes: receivedBytes, mimeType }) => {
          calls.push({ bytes: receivedBytes, mimeType });
          return extractedText;
        },
      },
    });

    expect(result).toEqual({
      trustedMime: declaredMime,
      extension,
      kind: "document",
      sizeBytes: bytes.byteLength,
      metadata: { extractedText },
      derivatives: {},
    });
    expect(calls).toEqual([{ bytes, mimeType: declaredMime }]);
  });

  it("rejects invalid UTF-8 bytes declared as plain text before document extraction", async () => {
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime: "text/plain",
      bytes: new Uint8Array([0, 255, 1, 2]),
      originalName: "unsafe.txt",
      adapters: {
        detect: async () => undefined,
        document,
      },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(document).not.toHaveBeenCalled();
  });

  it("rejects NUL and control characters declared as Markdown before document extraction", async () => {
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime: "text/markdown",
      bytes: new TextEncoder().encode("# Family memory\u0000\u0001"),
      originalName: "unsafe.md",
      adapters: {
        detect: async () => undefined,
        document,
      },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(document).not.toHaveBeenCalled();
  });

  it.each([
    ["a script marker", "text/plain", "<script"],
    ["script markup", "text/plain", "<script>alert(1)</script>"],
    ["HTML document markup", "text/markdown", "<!DOCTYPE html><html><body>unsafe</body></html>"],
    ["a javascript URI", "text/markdown", "[Open](javascript:alert(1))"],
  ])("rejects %s declared as %s before document extraction", async (_description, declaredMime, payload) => {
    const document = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    await expect(validateAsset({
      declaredMime,
      bytes: new TextEncoder().encode(payload),
      originalName: "unsafe.txt",
      adapters: {
        detect: async () => undefined,
        document,
      },
    })).rejects.toMatchObject({ code: "ASSET_TEXT_INVALID", status: 415 });

    expect(document).not.toHaveBeenCalled();
  });

  it("rejects HTML even when no binary magic type is available", async () => {
    await expect(validateAsset({
      declaredMime: "text/html",
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      originalName: "unsafe.html",
      adapters: {
        detect: async () => undefined,
      },
    })).rejects.toMatchObject({ code: "ASSET_TYPE_UNSUPPORTED" });
  });

  it("normalizes a trusted JPEG and returns private image derivatives", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const normalizedBytes = new Uint8Array([4, 5]);
    const thumbnailBytes = new Uint8Array([6, 7]);
    const calls: string[] = [];

    const result = await validateAsset({
      declaredMime: "image/jpeg",
      bytes,
      originalName: "photo.jpg",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
        image: {
          inspect: async (receivedBytes) => {
            calls.push(`inspect:${receivedBytes.byteLength}`);
            return { width: 1600, height: 900 };
          },
          derive: async ({ bytes: receivedBytes, mimeType }) => {
            calls.push(`derive:${mimeType}:${receivedBytes.byteLength}`);
            return { normalizedBytes, thumbnailBytes };
          },
        },
      },
    });

    expect(result).toEqual({
      trustedMime: "image/jpeg",
      extension: "jpg",
      kind: "image",
      sizeBytes: bytes.byteLength,
      metadata: { width: 1600, height: 900 },
      derivatives: { normalizedBytes, thumbnailBytes },
    });
    expect(calls).toEqual(["inspect:3", "derive:image/jpeg:3"]);
  });

  it("rejects an image larger than 10 MiB before decoding it", async () => {
    await expect(validateAsset({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      originalName: "too-large.jpg",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
        image: {
          inspect: async () => {
            throw new Error("image decoder should not run");
          },
          derive: async () => {
            throw new Error("image decoder should not run");
          },
        },
      },
    })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT" });
  });

  it("rejects an image above the explicit pixel limit before deriving bytes", async () => {
    await expect(validateAsset({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "too-many-pixels.jpg",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
        image: {
          inspect: async () => ({ width: 10_001, height: 4_000 }),
          derive: async () => {
            throw new Error("derivation should not run");
          },
        },
      },
    })).rejects.toMatchObject({ code: "ASSET_IMAGE_DIMENSIONS" });
  });

  it("only permits images as planet covers", async () => {
    await expect(validateAsset({
      declaredMime: "text/plain",
      bytes: new TextEncoder().encode("not a cover image"),
      originalName: "memory.txt",
      kind: "planet_cover",
      adapters: {
        detect: async () => undefined,
        document: async () => "not a cover image",
      },
    })).rejects.toMatchObject({ code: "ASSET_KIND_INVALID" });
  });

  it("delegates a trusted MP3 and persists its duration metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const calls: Array<{ bytes: Uint8Array; mimeType: string }> = [];

    const result = await validateAsset({
      declaredMime: "audio/mpeg",
      bytes,
      originalName: "memory.mp3",
      adapters: {
        detect: async () => ({ mime: "audio/mpeg", ext: "mp3" }),
        audio: async ({ bytes: receivedBytes, mimeType }) => {
          calls.push({ bytes: receivedBytes, mimeType });
          return { durationMs: 12_345 };
        },
      },
    });

    expect(result).toEqual({
      trustedMime: "audio/mpeg",
      extension: "mp3",
      kind: "audio",
      sizeBytes: bytes.byteLength,
      metadata: { durationMs: 12_345 },
      derivatives: {},
    });
    expect(calls).toEqual([{ bytes, mimeType: "audio/mpeg" }]);
  });

  it("rejects audio larger than 20 MiB before duration parsing", async () => {
    await expect(validateAsset({
      declaredMime: "audio/mpeg",
      bytes: new Uint8Array(20 * 1024 * 1024 + 1),
      originalName: "too-large.mp3",
      adapters: {
        detect: async () => ({ mime: "audio/mpeg", ext: "mp3" }),
        audio: async () => {
          throw new Error("audio parser should not run");
        },
      },
    })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT" });
  });

  it("accepts the file-type canonical M4A MIME", async () => {
    const result = await validateAsset({
      declaredMime: "audio/x-m4a",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "memory.m4a",
      adapters: {
        detect: async () => ({ mime: "audio/x-m4a", ext: "m4a" }),
        audio: async () => ({ durationMs: 12_345 }),
      },
    });

    expect(result).toMatchObject({
      trustedMime: "audio/x-m4a",
      extension: "m4a",
      kind: "audio",
      metadata: { durationMs: 12_345 },
    });
  });

  it("accepts the file-type canonical WAV MIME", async () => {
    const result = await validateAsset({
      declaredMime: "audio/wav",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "memory.wav",
      adapters: {
        detect: async () => ({ mime: "audio/wav", ext: "wav" }),
        audio: async () => ({ durationMs: 12_345 }),
      },
    });

    expect(result).toMatchObject({
      trustedMime: "audio/wav",
      extension: "wav",
      kind: "audio",
    });
  });

  it("accepts Markdown without a binary magic MIME", async () => {
    const result = await validateAsset({
      declaredMime: "text/markdown",
      bytes: new TextEncoder().encode("# A memory"),
      originalName: "memory.md",
      adapters: {
        detect: async () => undefined,
        document: async () => "# A memory",
      },
    });

    expect(result).toMatchObject({
      trustedMime: "text/markdown",
      extension: "md",
      kind: "document",
      metadata: { extractedText: "# A memory" },
    });
  });

  it("delegates a trusted DOCX to document text extraction", async () => {
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const result = await validateAsset({
      declaredMime: docxMime,
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "memory.docx",
      adapters: {
        detect: async () => ({ mime: docxMime, ext: "docx" }),
        document: async () => "DOCX memory",
      },
    });

    expect(result).toMatchObject({
      trustedMime: docxMime,
      extension: "docx",
      kind: "document",
      metadata: { extractedText: "DOCX memory" },
    });
  });

  it("delegates a trusted PDF to document text extraction", async () => {
    const result = await validateAsset({
      declaredMime: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "memory.pdf",
      adapters: {
        detect: async () => ({ mime: "application/pdf", ext: "pdf" }),
        document: async () => "PDF memory",
      },
    });

    expect(result).toMatchObject({
      trustedMime: "application/pdf",
      extension: "pdf",
      kind: "document",
      metadata: { extractedText: "PDF memory" },
    });
  });

  it("rejects a document larger than 10 MiB before text extraction", async () => {
    await expect(validateAsset({
      declaredMime: "application/pdf",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      originalName: "too-large.pdf",
      adapters: {
        detect: async () => ({ mime: "application/pdf", ext: "pdf" }),
        document: async () => {
          throw new Error("document parser should not run");
        },
      },
    })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT" });
  });

  it("uses file-type by default when detection is not injected", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fileType.fileTypeFromBuffer.mockReset();
    fileType.fileTypeFromBuffer.mockResolvedValue({ mime: "image/jpeg", ext: "jpg" });

    const result = await validateAsset({
      declaredMime: "image/jpeg",
      bytes,
      originalName: "photo.jpg",
      adapters: {
        image: {
          inspect: async () => ({ width: 10, height: 10 }),
          derive: async () => ({ normalizedBytes: new Uint8Array([4]), thumbnailBytes: new Uint8Array([5]) }),
        },
      },
    });

    expect(fileType.fileTypeFromBuffer).toHaveBeenCalledWith(bytes);
    expect(result).toMatchObject({ trustedMime: "image/jpeg", extension: "jpg" });
  });

  it("uses Sharp by default to inspect and derive private image bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const normalizedBytes = new Uint8Array([4]);
    const thumbnailBytes = new Uint8Array([5]);
    const metadata = vi.fn().mockResolvedValue({ width: 10, height: 20 });
    const normalizedToBuffer = vi.fn().mockResolvedValue(normalizedBytes);
    const normalizedRotate = vi.fn().mockReturnValue({ toBuffer: normalizedToBuffer });
    const thumbnailToBuffer = vi.fn().mockResolvedValue(thumbnailBytes);
    const jpeg = vi.fn().mockReturnValue({ toBuffer: thumbnailToBuffer });
    const resize = vi.fn().mockReturnValue({ jpeg });
    const thumbnailRotate = vi.fn().mockReturnValue({ resize });

    fileType.fileTypeFromBuffer.mockReset();
    fileType.fileTypeFromBuffer.mockResolvedValue({ mime: "image/jpeg", ext: "jpg" });
    sharp.mockReset();
    sharp.mockImplementationOnce(() => ({ metadata }));
    sharp.mockImplementationOnce(() => ({ rotate: normalizedRotate }));
    sharp.mockImplementationOnce(() => ({ rotate: thumbnailRotate }));

    const result = await validateAsset({
      declaredMime: "image/jpeg",
      bytes,
      originalName: "photo.jpg",
    });

    expect(result).toMatchObject({
      metadata: { width: 10, height: 20 },
      derivatives: { normalizedBytes, thumbnailBytes },
    });
    expect(sharp).toHaveBeenCalledTimes(3);
    expect(resize).toHaveBeenCalledWith({
      width: 512,
      height: 512,
      fit: "inside",
      withoutEnlargement: true,
    });
    expect(jpeg).toHaveBeenCalledWith({ quality: 80 });
  });

  it.each([
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("accepts supported image MIME %s", async (mimeType, extension) => {
    const result = await validateAsset({
      declaredMime: mimeType,
      bytes: new Uint8Array([1, 2, 3]),
      originalName: `photo.${extension}`,
      adapters: {
        detect: async () => ({ mime: mimeType, ext: extension }),
        image: {
          inspect: async () => ({ width: 10, height: 10 }),
          derive: async () => ({ normalizedBytes: new Uint8Array([4]), thumbnailBytes: new Uint8Array([5]) }),
        },
      },
    });

    expect(result).toMatchObject({ trustedMime: mimeType, extension, kind: "image" });
  });

  it("uses extractAudioMetadata by default for trusted audio", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fileType.fileTypeFromBuffer.mockReset();
    fileType.fileTypeFromBuffer.mockResolvedValue({ mime: "audio/mpeg", ext: "mp3" });
    audioMetadata.extractAudioMetadata.mockReset();
    audioMetadata.extractAudioMetadata.mockResolvedValue({ durationMs: 12_345 });

    const result = await validateAsset({
      declaredMime: "audio/mpeg",
      bytes,
      originalName: "memory.mp3",
    });

    expect(audioMetadata.extractAudioMetadata).toHaveBeenCalledWith({
      bytes,
      mimeType: "audio/mpeg",
    });
    expect(result).toMatchObject({ metadata: { durationMs: 12_345 }, kind: "audio" });
  });

  it("uses extractDocumentText by default for trusted PDFs", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fileType.fileTypeFromBuffer.mockReset();
    fileType.fileTypeFromBuffer.mockResolvedValue({ mime: "application/pdf", ext: "pdf" });
    documentText.extractDocumentText.mockReset();
    documentText.extractDocumentText.mockResolvedValue("PDF memory");

    const result = await validateAsset({
      declaredMime: "application/pdf",
      bytes,
      originalName: "memory.pdf",
    });

    expect(documentText.extractDocumentText).toHaveBeenCalledWith({
      bytes,
      mimeType: "application/pdf",
    });
    expect(result).toMatchObject({ metadata: { extractedText: "PDF memory" }, kind: "document" });
  });

  it("persists a valid image cover with the planet_cover kind", async () => {
    const result = await validateAsset({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "cover.jpg",
      kind: "planet_cover",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
        image: {
          inspect: async () => ({ width: 10, height: 10 }),
          derive: async () => ({ normalizedBytes: new Uint8Array([4]), thumbnailBytes: new Uint8Array([5]) }),
        },
      },
    });

    expect(result).toMatchObject({ kind: "planet_cover", trustedMime: "image/jpeg" });
  });
});
