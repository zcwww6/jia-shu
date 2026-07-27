import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("worker Docker source closure", () => {
  it("copies the complete server dependency closure while retaining the worker command", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");
    const workerStage = dockerfile.match(/FROM base AS worker\s*([\s\S]*)$/)?.[1];

    expect(workerStage).toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/src/server ./src/server",
    );
    expect(workerStage).not.toMatch(
      /COPY --from=builder --chown=nextjs:nodejs \/app\/src\/server\/(worker|ai\/ai-job-worker)\.ts/,
    );
    expect(workerStage).toContain('CMD ["node", "--import", "tsx", "src/server/worker.ts"]');
  });

  it("does not inject default text model or endpoint values into either long-running AI service", async () => {
    const compose = await readFile(resolve(process.cwd(), "compose.yaml"), "utf8");
    const app = compose.match(/^  app:\s*$([\s\S]*?)^  worker:\s*$/m)?.[1];
    const worker = compose.match(/^  worker:\s*$([\s\S]*?)^  nginx:\s*$/m)?.[1];

    expect(app).toContain("OPENAI_MODEL: ${OPENAI_MODEL:-}");
    expect(app).toContain("OPENAI_BASE_URL: ${OPENAI_BASE_URL:-}");
    expect(worker).toContain("OPENAI_MODEL: ${OPENAI_MODEL:-}");
    expect(worker).toContain("OPENAI_BASE_URL: ${OPENAI_BASE_URL:-}");
    expect(app).not.toContain("OPENAI_MODEL: ${OPENAI_MODEL:-gpt-5.4-mini}");
    expect(app).not.toContain("OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com/v1}");
    expect(worker).not.toContain("OPENAI_MODEL: ${OPENAI_MODEL:-gpt-5.4-mini}");
    expect(worker).not.toContain("OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com/v1}");
  });

  it("keeps the dedicated worker service under a persistent restart policy", async () => {
    const compose = await readFile(resolve(process.cwd(), "compose.yaml"), "utf8");
    const worker = compose.match(/^  worker:\s*$([\s\S]*?)^  nginx:\s*$/m)?.[1];

    expect(worker).toContain("restart: unless-stopped");
    expect(worker).not.toContain('restart: "no"');
  });
});
