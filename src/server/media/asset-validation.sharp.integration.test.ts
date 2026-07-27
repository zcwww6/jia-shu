import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { DomainError } from "../domain-error";
import { validateAsset } from "./asset-validation";

describe("asset validation Sharp integration", () => {
  it("maps a truncated real PNG to a safe image validation error", async () => {
    const validPng = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    }).png().toBuffer();
    const truncatedPng = validPng.subarray(0, 24);

    expect(validPng.byteLength).toBeGreaterThan(truncatedPng.byteLength);

    const error = await validateAsset({
      declaredMime: "image/png",
      bytes: truncatedPng,
      originalName: "truncated.png",
      adapters: {
        detect: async () => ({ mime: "image/png", ext: "png" }),
      },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: "ASSET_IMAGE_INVALID",
      status: 422,
      message: "请求无法完成，请检查后重试。",
    });
  });

  it("creates a JPEG thumbnail without original EXIF metadata for AI use", async () => {
    const original = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .withMetadata({ exif: { IFD0: { Artist: "private-family-name" } } })
      .jpeg()
      .toBuffer();
    const originalMetadata = await sharp(original).metadata();

    expect(originalMetadata.exif).toBeDefined();

    const validated = await validateAsset({
      declaredMime: "image/jpeg",
      bytes: original,
      originalName: "family.jpg",
      adapters: {
        detect: async () => ({ mime: "image/jpeg", ext: "jpg" }),
      },
    });
    const image = validated as {
      derivatives: { thumbnailBytes: Uint8Array };
    };
    const thumbnailMetadata = await sharp(image.derivatives.thumbnailBytes).metadata();

    expect(thumbnailMetadata.format).toBe("jpeg");
    expect(thumbnailMetadata.width).toBeLessThanOrEqual(512);
    expect(thumbnailMetadata.height).toBeLessThanOrEqual(512);
    expect(thumbnailMetadata.exif).toBeUndefined();
  });
});
