import sharp from "sharp";

import { DomainError } from "../domain-error";
import { extractAudioMetadata } from "./audio-metadata";
import { extractDocumentText } from "./document-text";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME_TYPE = "application/pdf";
const SUPPORTED_MIME_TYPES = new Set(["text/plain", "text/markdown", DOCX_MIME_TYPE, PDF_MIME_TYPE, "image/jpeg", "image/png", "image/webp", "image/avif", "audio/mpeg", "audio/x-m4a", "audio/wav"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/x-m4a", "audio/wav"]);
const DOCUMENT_MIME_TYPES = new Set(["text/plain", "text/markdown", DOCX_MIME_TYPE, PDF_MIME_TYPE]);
const TEXT_DOCUMENT_EXTENSIONS = new Map([
  ["text/plain", "txt"],
  ["text/markdown", "md"],
]);
const DISALLOWED_TEXT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ACTIVE_TEXT_URI_SCHEMES = /\b(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a)\s*:/i;
const MAX_URI_ENTITY_NORMALIZATION_ROUNDS = 8;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export type AssetValidationAdapters = {
  detect?: (bytes: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>;
  document?: (input: { bytes: Uint8Array; mimeType: string }) => Promise<string>;
  image?: {
    inspect: (bytes: Uint8Array) => Promise<{ width: number; height: number }>;
    derive: (input: {
      bytes: Uint8Array;
      mimeType: string;
    }) => Promise<{ normalizedBytes: Uint8Array; thumbnailBytes: Uint8Array }>;
  };
  audio?: (input: { bytes: Uint8Array; mimeType: string }) => Promise<{ durationMs: number }>;
};

export type AssetKind = "image" | "audio" | "document" | "planet_cover";

const defaultImageAdapter: Required<AssetValidationAdapters>["image"] = {
  async inspect(bytes) {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();

    if (!metadata.width || !metadata.height) {
      throw new DomainError("ASSET_IMAGE_DIMENSIONS", 422);
    }

    return { width: metadata.width, height: metadata.height };
  },
  async derive({ bytes }) {
    const normalizedBytes = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .toBuffer();
    const thumbnailBytes = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return { normalizedBytes, thumbnailBytes };
  },
};

const defaultAudioAdapter: Required<AssetValidationAdapters>["audio"] = (input) => extractAudioMetadata(input);
const defaultDocumentAdapter: Required<AssetValidationAdapters>["document"] = (input) => extractDocumentText(input);

async function detectFileType(bytes: Uint8Array) {
  const { fileTypeFromBuffer } = await import("file-type");
  return fileTypeFromBuffer(bytes);
}

function decodeUriCharacterReferencesOnce(text: string) {
  return text.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));?|&(amp|colon|tab|newline);/gi,
    (reference, hexadecimal: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (name) {
        switch (name.toLowerCase()) {
          case "amp":
            return "&";
          case "colon":
            return ":";
          case "tab":
            return "\t";
          case "newline":
            return "\n";
          default:
            return reference;
        }
      }

      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal === undefined ? 10 : 16);

      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return reference;
      }

      return String.fromCodePoint(codePoint);
    },
  );
}

function hasUriCharacterReference(text: string) {
  return /&#(?:x[0-9a-f]+|[0-9]+);?|&(amp|colon|tab|newline);/i.test(text);
}

function normalizeUriCharacterReferences(text: string) {
  let normalizedText = text;

  for (let round = 0; round < MAX_URI_ENTITY_NORMALIZATION_ROUNDS; round += 1) {
    const decodedText = decodeUriCharacterReferencesOnce(normalizedText);

    if (decodedText === normalizedText) {
      return { normalizedText, hasUnresolvedEntity: false };
    }

    normalizedText = decodedText;
  }

  return {
    normalizedText,
    hasUnresolvedEntity: hasUriCharacterReference(normalizedText),
  };
}

function validateTextDocumentBytes(bytes: Uint8Array) {
  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("ASSET_TEXT_INVALID", 415);
  }

  // Markdown renderers decode character references in link destinations, so inspect a bounded normalized form.
  const { normalizedText: uriNormalizedText, hasUnresolvedEntity } = normalizeUriCharacterReferences(text);

  if (
    DISALLOWED_TEXT_CONTROL_CHARACTERS.test(text)
    || text.includes("<")
    || hasUnresolvedEntity
    || DISALLOWED_TEXT_CONTROL_CHARACTERS.test(uriNormalizedText)
    || ACTIVE_TEXT_URI_SCHEMES.test(uriNormalizedText)
  ) {
    throw new DomainError("ASSET_TEXT_INVALID", 415);
  }
}

export async function validateAsset(input: {
  declaredMime: string;
  bytes: Uint8Array;
  originalName: string;
  kind?: AssetKind;
  adapters?: AssetValidationAdapters;
}) {
  const textExtension = TEXT_DOCUMENT_EXTENSIONS.get(input.declaredMime);

  if (!SUPPORTED_MIME_TYPES.has(input.declaredMime)) {
    throw new DomainError("ASSET_TYPE_UNSUPPORTED", 415);
  }

  if (input.kind === "planet_cover" && !IMAGE_MIME_TYPES.has(input.declaredMime)) {
    throw new DomainError("ASSET_KIND_INVALID", 422);
  }

  if (IMAGE_MIME_TYPES.has(input.declaredMime) && input.bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new DomainError("ASSET_SIZE_LIMIT", 413);
  }

  if (AUDIO_MIME_TYPES.has(input.declaredMime) && input.bytes.byteLength > MAX_AUDIO_SIZE_BYTES) {
    throw new DomainError("ASSET_SIZE_LIMIT", 413);
  }

  if (DOCUMENT_MIME_TYPES.has(input.declaredMime) && input.bytes.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
    throw new DomainError("ASSET_SIZE_LIMIT", 413);
  }

  if (textExtension) {
    validateTextDocumentBytes(input.bytes);
  }

  const detected = await (input.adapters?.detect ?? detectFileType)(input.bytes);

  if (detected && detected.mime !== input.declaredMime) {
    throw new DomainError("ASSET_MIME_MISMATCH", 415);
  }

  if (textExtension) {
    const document = input.adapters?.document ?? defaultDocumentAdapter;
    const extractedText = await document({
      bytes: input.bytes,
      mimeType: input.declaredMime,
    });

    return {
      trustedMime: input.declaredMime,
      extension: textExtension,
      kind: "document",
      sizeBytes: input.bytes.byteLength,
      metadata: { extractedText },
      derivatives: {},
    };
  }

  if (input.declaredMime === DOCX_MIME_TYPE && detected) {
    const document = input.adapters?.document ?? defaultDocumentAdapter;
    const extractedText = await document({
      bytes: input.bytes,
      mimeType: input.declaredMime,
    });

    return {
      trustedMime: detected.mime,
      extension: detected.ext,
      kind: "document",
      sizeBytes: input.bytes.byteLength,
      metadata: { extractedText },
      derivatives: {},
    };
  }

  if (input.declaredMime === PDF_MIME_TYPE && detected) {
    const document = input.adapters?.document ?? defaultDocumentAdapter;
    const extractedText = await document({
      bytes: input.bytes,
      mimeType: input.declaredMime,
    });

    return {
      trustedMime: detected.mime,
      extension: detected.ext,
      kind: "document",
      sizeBytes: input.bytes.byteLength,
      metadata: { extractedText },
      derivatives: {},
    };
  }

  if (IMAGE_MIME_TYPES.has(input.declaredMime) && detected) {
    const image = input.adapters?.image ?? defaultImageAdapter;

    try {
      const metadata = await image.inspect(input.bytes);

      if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        throw new DomainError("ASSET_IMAGE_DIMENSIONS", 422);
      }

      const derivatives = await image.derive({
        bytes: input.bytes,
        mimeType: input.declaredMime,
      });

      return {
        trustedMime: detected.mime,
        extension: detected.ext,
        kind: input.kind === "planet_cover" ? "planet_cover" : "image",
        sizeBytes: input.bytes.byteLength,
        metadata,
        derivatives,
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }

      throw new DomainError("ASSET_IMAGE_INVALID", 422);
    }
  }

  if (AUDIO_MIME_TYPES.has(input.declaredMime) && detected) {
    const audio = input.adapters?.audio ?? defaultAudioAdapter;
    const metadata = await audio({
      bytes: input.bytes,
      mimeType: input.declaredMime,
    });

    return {
      trustedMime: detected.mime,
      extension: detected.ext,
      kind: "audio",
      sizeBytes: input.bytes.byteLength,
      metadata,
      derivatives: {},
    };
  }

  if (!detected) {
    throw new DomainError("ASSET_MIME_MISMATCH", 415);
  }

  return { trustedMime: detected.mime, extension: detected.ext };
}
