import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaClientMock = vi.fn();
const prismaPgMock = vi.fn();
let originalDatabaseUrl: string | undefined;

vi.mock("@prisma/client", () => ({
  PrismaClient: prismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: prismaPgMock,
}));

describe("prisma client", () => {
  beforeEach(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    prismaClientMock.mockReset();
    prismaPgMock.mockReset();
    delete (globalThis as { prisma?: unknown }).prisma;
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("does not read DATABASE_URL during module import", async () => {
    delete process.env.DATABASE_URL;

    const { getPrismaClient } = await import("./client");

    expect(prismaPgMock).not.toHaveBeenCalled();
    expect(prismaClientMock).not.toHaveBeenCalled();
    expect(getPrismaClient).toBeTypeOf("function");
  });

  it("builds PrismaClient with a PrismaPg adapter from DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://demo";

    const adapter = { kind: "adapter" };
    const client = { kind: "client" };

    prismaPgMock.mockReturnValue(adapter);
    prismaClientMock.mockReturnValue(client);

    const { getPrismaClient } = await import("./client");

    expect(getPrismaClient()).toBe(client);
    expect(prismaPgMock).toHaveBeenCalledWith({ connectionString: "postgresql://demo" });
    expect(prismaClientMock).toHaveBeenCalledWith({ adapter });
  });

  it("reuses the same client for repeated calls in production", async () => {
    process.env.DATABASE_URL = "postgresql://demo";
    vi.stubEnv("NODE_ENV", "production");

    const adapter = { kind: "adapter" };
    const client = { kind: "client" };

    prismaPgMock.mockReturnValue(adapter);
    prismaClientMock.mockReturnValue(client);

    const { getPrismaClient } = await import("./client");

    expect(getPrismaClient()).toBe(client);
    expect(getPrismaClient()).toBe(client);
    expect(prismaPgMock).toHaveBeenCalledTimes(1);
    expect(prismaClientMock).toHaveBeenCalledTimes(1);
  });
});
