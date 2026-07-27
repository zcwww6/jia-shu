import { describe, expect, it, vi } from "vitest";

const musicMetadata = vi.hoisted(() => ({
  parseBuffer: vi.fn(),
}));

vi.mock("music-metadata", () => musicMetadata);

import { DomainError } from "../domain-error";
import { extractAudioMetadata } from "./audio-metadata";

describe("audio metadata", () => {
  it.each([
    ["audio/mpeg", "audio/mpeg"],
    ["audio/x-m4a", "audio/m4a"],
    ["audio/wav", "audio/wav"],
  ])("passes trusted %s to the default parser as %s with bounded options", async (mimeType, parserMimeType) => {
    const bytes = new Uint8Array([1, 2, 3]);
    musicMetadata.parseBuffer.mockReset();
    musicMetadata.parseBuffer.mockResolvedValue({ format: { duration: 12.345 } });

    await expect(extractAudioMetadata({ bytes, mimeType })).resolves.toEqual({ durationMs: 12_345 });

    expect(musicMetadata.parseBuffer).toHaveBeenCalledWith(
      bytes,
      { mimeType: parserMimeType, size: bytes.byteLength },
      { duration: true, skipCovers: true },
    );
  });

  it("returns a persistable duration from an injected buffer parser", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const calls: Array<{
      bytes: Uint8Array;
      fileInfo: { mimeType: string; size: number };
      options: { duration: true; skipCovers: true };
    }> = [];
    const parser = {
      async parseBuffer(
        receivedBytes: Uint8Array,
        fileInfo: { mimeType: string; size: number },
        options: { duration: true; skipCovers: true },
      ) {
        calls.push({ bytes: receivedBytes, fileInfo, options });
        return { format: { duration: 12.345 } };
      },
    };

    await expect(extractAudioMetadata({ bytes, mimeType: "audio/mpeg", parser }))
      .resolves.toEqual({ durationMs: 12_345 });
    expect(calls).toEqual([{
      bytes,
      fileInfo: { mimeType: "audio/mpeg", size: bytes.byteLength },
      options: { duration: true, skipCovers: true },
    }]);
  });

  it("maps external parser failures to a safe domain error", async () => {
    musicMetadata.parseBuffer.mockReset();
    musicMetadata.parseBuffer.mockRejectedValue(new Error("parser internals must not escape"));

    const error = await extractAudioMetadata({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "AUDIO_METADATA_INVALID", status: 422 });
    expect(error).not.toMatchObject({ message: "parser internals must not escape" });
  });

  it("rejects a zero parsed duration", async () => {
    const parser = {
      async parseBuffer() {
        return { format: { duration: 0 } };
      },
    };

    const error = await extractAudioMetadata({
      bytes: new Uint8Array([1]),
      mimeType: "audio/mpeg",
      parser,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "AUDIO_METADATA_INVALID" });
  });

  it("rejects an unavailable parsed duration", async () => {
    const parser = {
      async parseBuffer() {
        return { format: {} };
      },
    };

    await expect(extractAudioMetadata({
      bytes: new Uint8Array([1]),
      mimeType: "audio/mpeg",
      parser,
    })).rejects.toMatchObject({ code: "AUDIO_METADATA_INVALID" });
  });

  it("rejects a negative parsed duration", async () => {
    const parser = {
      async parseBuffer() {
        return { format: { duration: -1 } };
      },
    };

    await expect(extractAudioMetadata({
      bytes: new Uint8Array([1]),
      mimeType: "audio/mpeg",
      parser,
    })).rejects.toMatchObject({ code: "AUDIO_METADATA_INVALID" });
  });

  it("rejects a non-finite parsed duration", async () => {
    const parser = {
      async parseBuffer() {
        return { format: { duration: Number.NaN } };
      },
    };

    await expect(extractAudioMetadata({
      bytes: new Uint8Array([1]),
      mimeType: "audio/mpeg",
      parser,
    })).rejects.toMatchObject({ code: "AUDIO_METADATA_INVALID" });
  });

  it("accepts 600 seconds but rejects a longer duration before rounding", async () => {
    const atLimitParser = {
      async parseBuffer() {
        return { format: { duration: 600 } };
      },
    };
    const overLimitParser = {
      async parseBuffer() {
        return { format: { duration: 600.0004 } };
      },
    };
    const input = { bytes: new Uint8Array([1]), mimeType: "audio/mpeg" };

    await expect(extractAudioMetadata({ ...input, parser: atLimitParser }))
      .resolves.toEqual({ durationMs: 600_000 });
    await expect(extractAudioMetadata({ ...input, parser: overLimitParser }))
      .rejects.toMatchObject({ code: "AUDIO_DURATION_EXCEEDED" });
  });
});
