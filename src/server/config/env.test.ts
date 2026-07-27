import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

const requiredEnv = {
  DATABASE_URL: "postgresql://demo",
  AUTH_SECRET: "secret",
  AUTH_URL: "http://localhost",
  AUTH_TRUST_HOST: "false",
  AUTH_RESEND_API_KEY: "re_test",
  AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
};

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("loadAppEnv", () => {
  it("can import the env module without required env settings", async () => {
    await expect(import("./env")).resolves.toMatchObject({
      env: expect.any(Object),
      loadAppEnv: expect.any(Function),
    });
  });

  it("reads required auth/database settings and optional AI settings", async () => {
    const { env, loadAppEnv } = await import("./env");

    const result = loadAppEnv({
      ...requiredEnv,
      OPENAI_API_KEY: "sk-demo",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_BASE_URL: "https://ai.example/v1",
      OPENAI_VISION_MODEL: "gpt-vision",
    });

    expect(result.DATABASE_URL).toBe("postgresql://demo");
    expect(result.AUTH_SECRET).toBe("secret");
    expect(result.AUTH_URL).toBe("http://localhost");
    expect(result.AUTH_TRUST_HOST).toBe(false);
    expect(result.AUTH_RESEND_API_KEY).toBe("re_test");
    expect(result.AUTH_RESEND_FROM).toBe("Jiashu <noreply@example.com>");
    expect(result.OPENAI_API_KEY).toBe("sk-demo");
    expect(result.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(result.OPENAI_BASE_URL).toBe("https://ai.example/v1");
    expect(result.OPENAI_VISION_MODEL).toBe("gpt-vision");

    process.env.DATABASE_URL = "postgresql://demo";
    process.env.AUTH_SECRET = "secret";
    process.env.AUTH_URL = "http://localhost";
    process.env.AUTH_TRUST_HOST = "false";
    process.env.AUTH_RESEND_API_KEY = "re_test";
    process.env.AUTH_RESEND_FROM = "Jiashu <noreply@example.com>";
    process.env.OPENAI_API_KEY = "sk-demo";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    process.env.OPENAI_BASE_URL = "https://ai.example/v1";
    process.env.OPENAI_VISION_MODEL = "gpt-vision";

    expect(env.DATABASE_URL).toBe("postgresql://demo");
    expect(env.AUTH_SECRET).toBe("secret");
    expect(env.AUTH_URL).toBe("http://localhost");
    expect(env.AUTH_TRUST_HOST).toBe(false);
    expect(env.AUTH_RESEND_API_KEY).toBe("re_test");
    expect(env.AUTH_RESEND_FROM).toBe("Jiashu <noreply@example.com>");
    expect(env.OPENAI_API_KEY).toBe("sk-demo");
    expect(env.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(env.OPENAI_BASE_URL).toBe("https://ai.example/v1");
    expect(env.OPENAI_VISION_MODEL).toBe("gpt-vision");
  });

  it("reads the media root and capability-specific AI models independently", async () => {
    const { loadAppEnv } = await import("./env");

    const result = loadAppEnv({
      ...requiredEnv,
      MEDIA_STORAGE_ROOT: "/data/media",
      OPENAI_MODEL: "gpt-legacy",
      OPENAI_VISION_MODEL: "gpt-vision",
      OPENAI_TRANSCRIPTION_MODEL: "gpt-transcription",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    });

    expect(result.MEDIA_STORAGE_ROOT).toBe("/data/media");
    expect(result.OPENAI_VISION_MODEL).toBe("gpt-vision");
    expect(result.OPENAI_TRANSCRIPTION_MODEL).toBe("gpt-transcription");
    expect(result.OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-large");
  });

  it("does not fall back the visual capability to the text model", async () => {
    const { loadAppEnv } = await import("./env");

    const result = loadAppEnv({
      ...requiredEnv,
      OPENAI_MODEL: "gpt-legacy",
    });

    expect(result.MEDIA_STORAGE_ROOT).toBe("/data/media");
    expect(result.OPENAI_VISION_MODEL).toBeNull();
    expect(result.OPENAI_TRANSCRIPTION_MODEL).toBeNull();
    expect(result.OPENAI_EMBEDDING_MODEL).toBeNull();
  });

  it("parses DEMO_MODE strictly and defaults to false", async () => {
    const { loadAppEnv } = await import("./env");

    expect(loadAppEnv(requiredEnv).DEMO_MODE).toBe(false);
    expect(loadAppEnv({ ...requiredEnv, DEMO_MODE: "false" }).DEMO_MODE).toBe(false);
    expect(loadAppEnv({ ...requiredEnv, DEMO_MODE: "true" }).DEMO_MODE).toBe(true);
    expect(() => loadAppEnv({ ...requiredEnv, DEMO_MODE: "yes" })).toThrow(
      "Invalid boolean env: DEMO_MODE",
    );
  });

  it("reads true AUTH_TRUST_HOST through the loader and lazy getter", async () => {
    const { env, loadAppEnv } = await import("./env");

    const result = loadAppEnv({
      ...requiredEnv,
      AUTH_TRUST_HOST: "true",
    });

    expect(result.AUTH_TRUST_HOST).toBe(true);

    process.env.AUTH_TRUST_HOST = "true";
    expect(env.AUTH_TRUST_HOST).toBe(true);
  });

  it("throws when required settings are missing", async () => {
    const { env, loadAppEnv } = await import("./env");

    expect(() =>
      loadAppEnv({
        ...requiredEnv,
        AUTH_URL: "",
      }),
    ).toThrow("AUTH_URL");

    expect(() =>
      loadAppEnv({
        ...requiredEnv,
        AUTH_TRUST_HOST: undefined,
      }),
    ).toThrow("AUTH_TRUST_HOST");
    expect(() => env.DATABASE_URL).toThrow("DATABASE_URL");
  });

  it("rejects invalid AUTH_TRUST_HOST boolean values", async () => {
    const { loadAppEnv } = await import("./env");

    expect(() =>
      loadAppEnv({
        ...requiredEnv,
        AUTH_TRUST_HOST: "yes",
      }),
    ).toThrow("Invalid boolean env: AUTH_TRUST_HOST");

    expect(() =>
      loadAppEnv({
        ...requiredEnv,
        AUTH_TRUST_HOST: " true ",
      }),
    ).toThrow("Invalid boolean env: AUTH_TRUST_HOST");
  });

  it("reads optional AI env properties without requiring auth or database settings", async () => {
    const { env } = await import("./env");

    process.env.OPENAI_API_KEY = "sk-optional";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";

    expect(env.OPENAI_API_KEY).toBe("sk-optional");
    expect(env.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(env.OPENAI_BASE_URL).toBeNull();
    expect(env.OPENAI_VISION_MODEL).toBeNull();
  });

  it("leaves missing AI endpoint and model capabilities unset instead of manufacturing defaults", async () => {
    const { loadAppEnv } = await import("./env");

    const result = loadAppEnv(requiredEnv);

    expect(result.OPENAI_API_KEY).toBeNull();
    expect(result.OPENAI_MODEL).toBeNull();
    expect(result.OPENAI_BASE_URL).toBeNull();
    expect(result.OPENAI_VISION_MODEL).toBeNull();
  });

  it("restores process.env after each test", () => {
    expect(process.env).toMatchObject(originalEnv);
  });
});
