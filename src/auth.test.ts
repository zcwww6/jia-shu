import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nextAuth } = vi.hoisted(() => ({
  nextAuth: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("next-auth", () => ({ default: nextAuth }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("next-auth/providers/resend", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@/server/db/client", () => ({ getPrismaClient: vi.fn(() => ({})) }));

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  vi.resetModules();
  nextAuth.mockClear();
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("primary auth configuration", () => {
  it("passes a false AUTH_TRUST_HOST value to NextAuth", async () => {
    process.env.AUTH_TRUST_HOST = "false";
    process.env.AUTH_RESEND_API_KEY = "re_test";
    process.env.AUTH_RESEND_FROM = "Jiashu <noreply@example.com>";

    await import("./auth");

    const configFactory = nextAuth.mock.calls[0]?.[0] as () => { trustHost?: boolean };
    expect(configFactory().trustHost).toBe(false);
  });
});
