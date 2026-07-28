import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestAuthConfigFactory = () => {
  trustHost?: boolean;
  session?: { strategy?: string };
  callbacks?: {
    session?: (args: never) => Promise<{ user?: { id?: string } }> | { user?: { id?: string } };
  };
};

const { nextAuth } = vi.hoisted(() => ({
  nextAuth: vi.fn((configFactory: TestAuthConfigFactory) => {
    void configFactory;
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  }),
}));

function configFactoryFromLastCall(): TestAuthConfigFactory {
  const configFactory = nextAuth.mock.calls[nextAuth.mock.calls.length - 1]?.[0];

  if (!configFactory) {
    throw new Error("NextAuth 未收到配置工厂。");
  }

  return configFactory;
}

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

    const config = configFactoryFromLastCall()();

    expect(config.trustHost).toBe(false);
    expect(config.session).toEqual({ strategy: "jwt" });
  });

  it("uses the JWT subject when building a session", async () => {
    process.env.AUTH_TRUST_HOST = "false";
    process.env.AUTH_RESEND_API_KEY = "re_test";
    process.env.AUTH_RESEND_FROM = "Jiashu <noreply@example.com>";

    await import("./auth");

    const sessionCallback = configFactoryFromLastCall()().callbacks?.session;

    const session = await sessionCallback?.({
      session: { user: {}, expires: "2030-01-01T00:00:00.000Z" },
      token: { sub: "user-1" },
    } as never);

    expect(session?.user?.id).toBe("user-1");
  });

  it("does not throw or invent a user ID when a JWT has no subject", async () => {
    process.env.AUTH_TRUST_HOST = "false";
    process.env.AUTH_RESEND_API_KEY = "re_test";
    process.env.AUTH_RESEND_FROM = "Jiashu <noreply@example.com>";

    await import("./auth");

    const sessionCallback = configFactoryFromLastCall()().callbacks?.session;

    const session = await sessionCallback?.({
      session: { user: {}, expires: "2030-01-01T00:00:00.000Z" },
      token: {},
    } as never);

    expect(session).toEqual({ user: {}, expires: "2030-01-01T00:00:00.000Z" });
  });
});
