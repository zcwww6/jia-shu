import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { getAiJobForOwner } from "@/server/services/ai-job.service";

type AiJobContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: AiJobContext) {
  try {
    const scope = await requireScope();
    const { jobId } = await context.params;
    const job = await getAiJobForOwner(scope, jobId);

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
  }
}

async function requireScope() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再查看 AI 作业。");
  }

  return resolvePersonalGalaxyScope(userId);
}
