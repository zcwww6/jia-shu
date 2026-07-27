import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { getAiJobForOwner } = vi.hoisted(() => ({ getAiJobForOwner: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/ai-job.service", () => ({ getAiJobForOwner }));

import { GET } from "./route";

describe("GET /api/ai-jobs/:jobId", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    getAiJobForOwner.mockReset();
  });

  it("returns the owner-scoped safe job status without lease or request details", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    getAiJobForOwner.mockResolvedValue({
      id: "job-1",
      kind: "text_extraction",
      status: "succeeded",
      attempts: 1,
      errorCode: null,
      completedAt: "2026-07-17T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/api/ai-jobs/job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "job-1",
      kind: "text_extraction",
      status: "succeeded",
      attempts: 1,
      errorCode: null,
      completedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(getAiJobForOwner).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1" }, "job-1");
  });

  it("does not resolve a personal galaxy or job for an unauthenticated request", async () => {
    auth.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/ai-jobs/job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(getAiJobForOwner).not.toHaveBeenCalled();
  });

  it("uses the same not-found response for a foreign owner and a missing job", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    getAiJobForOwner.mockRejectedValue(new DomainError("AI_JOB_NOT_FOUND", 404, "AI 作业不存在或无权访问。"));

    const response = await GET(new Request("http://localhost/api/ai-jobs/foreign-job"), {
      params: Promise.resolve({ jobId: "foreign-job" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "AI_JOB_NOT_FOUND",
      message: "AI 作业不存在或无权访问。",
    });
  });
});
