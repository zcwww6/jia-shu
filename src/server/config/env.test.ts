import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

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
      DATABASE_URL: "postgresql://demo",
      AUTH_SECRET: "secret",
      AUTH_URL: "http://localhost",
      AUTH_TRUST_HOST: "true",
      AUTH_RESEND_API_KEY: "re_test",
      AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
      OPENAI_API_KEY: "sk-demo",
      OPENAI_MODEL: "gpt-5.4-mini",
    });

    expect(result.DATABASE_URL).toBe("postgresql://demo");
    expect(result.AUTH_SECRET).toBe("secret");
    expect(result.AUTH_URL).toBe("http://localhost");
    expect(result.AUTH_TRUST_HOST).toBe(true);
    expect(result.AUTH_RESEND_API_KEY).toBe("re_test");
    expect(result.AUTH_RESEND_FROM).toBe("Jiashu <noreply@example.com>");
    expect(result.OPENAI_API_KEY).toBe("sk-demo");
    expect(result.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(result.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");

    process.env.DATABASE_URL = "postgresql://demo";
    process.env.AUTH_SECRET = "secret";
    process.env.AUTH_URL = "http://localhost";
    process.env.AUTH_TRUST_HOST = "true";
    process.env.AUTH_RESEND_API_KEY = "re_test";
    process.env.AUTH_RESEND_FROM = "Jiashu <noreply@example.com>";
    process.env.OPENAI_API_KEY = "sk-demo";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";

    expect(env.DATABASE_URL).toBe("postgresql://demo");
    expect(env.AUTH_SECRET).toBe("secret");
    expect(env.AUTH_URL).toBe("http://localhost");
    expect(env.AUTH_TRUST_HOST).toBe(true);
    expect(env.AUTH_RESEND_API_KEY).toBe("re_test");
    expect(env.AUTH_RESEND_FROM).toBe("Jiashu <noreply@example.com>");
    expect(env.OPENAI_API_KEY).toBe("sk-demo");
    expect(env.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(env.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
  });

  it("throws when required settings are missing", async () => {
    const { env, loadAppEnv } = await import("./env");

    expect(() =>
      loadAppEnv({
        DATABASE_URL: "postgresql://demo",
        AUTH_SECRET: "secret",
        AUTH_RESEND_API_KEY: "re_test",
        AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
      }),
    ).toThrow("AUTH_URL");
    expect(() => env.DATABASE_URL).toThrow("DATABASE_URL");
  });

  it("rejects invalid AUTH_TRUST_HOST boolean values", async () => {
    const { loadAppEnv } = await import("./env");

    expect(() =>
      loadAppEnv({
        DATABASE_URL: "postgresql://demo",
        AUTH_SECRET: "secret",
        AUTH_URL: "http://localhost",
        AUTH_TRUST_HOST: "yes",
        AUTH_RESEND_API_KEY: "re_test",
        AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
      }),
    ).toThrow("Invalid boolean env: AUTH_TRUST_HOST");

    expect(() =>
      loadAppEnv({
        DATABASE_URL: "postgresql://demo",
        AUTH_SECRET: "secret",
        AUTH_URL: "http://localhost",
        AUTH_TRUST_HOST: " true ",
        AUTH_RESEND_API_KEY: "re_test",
        AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
      }),
    ).toThrow("Invalid boolean env: AUTH_TRUST_HOST");
  });

  it("reads optional AI env properties without requiring auth or database settings", async () => {
    const { env } = await import("./env");

    process.env.OPENAI_API_KEY = "sk-optional";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";

    expect(env.OPENAI_API_KEY).toBe("sk-optional");
    expect(env.OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(env.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
  });

  it("restores process.env after each test", () => {
    expect(process.env).toMatchObject(originalEnv);
  });
});
