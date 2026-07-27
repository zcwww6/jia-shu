import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { createMemoryAiJob } = vi.hoisted(() => ({ createMemoryAiJob: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/ai-job.service", () => ({ createMemoryAiJob }));

import { POST } from "./route";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/memories/memory-1/ai-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/memories/:memoryId/ai-jobs", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    createMemoryAiJob.mockReset();
  });

  it("creates only a scoped consented queued job and returns the safe 202 DTO", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createMemoryAiJob.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 202,
      response: {
        id: "job-1",
        kind: "text_extraction",
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      },
    });

    const response = await POST(request({
      consent: true,
      purpose: "memory_extraction",
    }, { "Idempotency-Key": "ai-job-create-key-0001" }), {
      params: Promise.resolve({ memoryId: "memory-1" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      id: "job-1",
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      errorCode: null,
      completedAt: null,
    });
    expect(createMemoryAiJob).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      "memory-1",
      {
        consent: true,
        purpose: "memory_extraction",
        idempotencyKey: "ai-job-create-key-0001",
      },
    );
  });

  it("requires authentication and fresh consent before job creation", async () => {
    auth.mockResolvedValue(null);

    const unauthenticated = await POST(request({ consent: true }, {
      "Idempotency-Key": "ai-job-create-key-0001",
    }), { params: Promise.resolve({ memoryId: "memory-1" }) });

    expect(unauthenticated.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createMemoryAiJob).not.toHaveBeenCalled();

    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    const withoutConsent = await POST(request({}, {
      "Idempotency-Key": "ai-job-create-key-0001",
    }), { params: Promise.resolve({ memoryId: "memory-1" }) });

    expect(withoutConsent.status).toBe(400);
    await expect(withoutConsent.json()).resolves.toMatchObject({ code: "AI_JOB_INPUT_INVALID" });
    expect(createMemoryAiJob).not.toHaveBeenCalled();
  });

  it("returns the text AI configuration preflight error for an otherwise valid request", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createMemoryAiJob.mockRejectedValue(new DomainError(
      "AI_NOT_CONFIGURED",
      503,
      "AI 功能尚未配置。",
    ));

    const response = await POST(request({ consent: true }, {
      "Idempotency-Key": "ai-job-unconfigured-key-01",
    }), { params: Promise.resolve({ memoryId: "memory-1" }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("rejects browser-supplied queue state and provider controls instead of forwarding them", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(request({
      consent: true,
      status: "succeeded",
      model: "attacker-model",
      requestHash: "attacker-hash",
    }, { "Idempotency-Key": "ai-job-create-key-0001" }), {
      params: Promise.resolve({ memoryId: "memory-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AI_JOB_INPUT_INVALID" });
    expect(createMemoryAiJob).not.toHaveBeenCalled();
  });
});
