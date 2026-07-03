import { afterEach, describe, expect, it, vi } from "vitest";

const prismaClientMock = vi.fn();
const prismaPgMock = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: prismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: prismaPgMock,
}));

describe("prisma client", () => {
  afterEach(() => {
    vi.resetModules();
    prismaClientMock.mockReset();
    prismaPgMock.mockReset();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("builds PrismaClient with a PrismaPg adapter from DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://demo";

    const adapter = { kind: "adapter" };
    const client = { kind: "client" };

    prismaPgMock.mockReturnValue(adapter);
    prismaClientMock.mockReturnValue(client);

    const { prisma } = await import("./client");

    expect(prismaPgMock).toHaveBeenCalledWith({ connectionString: "postgresql://demo" });
    expect(prismaClientMock).toHaveBeenCalledWith({ adapter });
    expect(prisma).toBe(client);
  });
});
