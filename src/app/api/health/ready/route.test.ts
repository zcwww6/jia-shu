import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient: () => ({ $queryRaw: queryRaw }),
}));

import { GET } from "./route";

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns ready when the database is reachable", async () => {
    queryRaw.mockResolvedValue([{ ready: 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns not_ready without leaking database errors", async () => {
    queryRaw.mockRejectedValue(new Error("password=secret"));

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "not_ready" });
    expect(body).not.toContain("password");
  });
});
