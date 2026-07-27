import { describe, expect, it } from "vitest";

import { validateAsset } from "./asset-validation";

function createPcmWave(durationSeconds: number) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = sampleRate * durationSeconds * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();

  function writeAscii(offset: number, value: string) {
    bytes.set(encoder.encode(value), offset);
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  return bytes;
}

describe("audio validation integration", () => {
  it("detects and parses a real PCM WAV through the default validation pipeline", async () => {
    const bytes = createPcmWave(1);

    const result = await validateAsset({
      declaredMime: "audio/wav",
      bytes,
      originalName: "memory.wav",
    });

    expect(result).toMatchObject({
      trustedMime: "audio/wav",
      extension: "wav",
      kind: "audio",
      sizeBytes: bytes.byteLength,
      metadata: { durationMs: 1_000 },
    });
  });
});
