import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const childProgram = `
function createPcmWave(durationSeconds) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = sampleRate * durationSeconds * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  const writeAscii = (offset, value) => bytes.set(encoder.encode(value), offset);

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

const source = await import(process.env.AUDIO_METADATA_SOURCE_URL);
const extractAudioMetadata = source.extractAudioMetadata ?? source.default?.extractAudioMetadata;

if (typeof extractAudioMetadata !== "function") {
  throw new Error("extractAudioMetadata was not exported by the TSX-loaded source module");
}

const result = await extractAudioMetadata({
  bytes: createPcmWave(1),
  mimeType: "audio/wav",
});

if (result.durationMs !== 1_000) {
  throw new Error(\`Expected 1000ms, received \${result.durationMs}ms\`);
}

process.stdout.write(String(result.durationMs));
`;

describe("audio metadata TSX runtime integration", () => {
  it("parses a real WAV with the default parser under the production loader", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", childProgram],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AUDIO_METADATA_SOURCE_URL: pathToFileURL(
            resolve(process.cwd(), "src/server/media/audio-metadata.ts"),
          ).href,
        },
      },
    );

    if (result.error || result.status !== 0) {
      throw new Error([
        "The TSX child process failed.",
        result.error?.stack,
        result.stderr,
        result.stdout,
      ].filter(Boolean).join("\n"));
    }

    expect(result.stdout.trim()).toBe("1000");
  });
});
