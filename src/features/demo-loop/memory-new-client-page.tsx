"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { demoSession } from "@/shared/mock/demo-session";
import type { MemoryExtractResponse, Visibility } from "@/shared/types/galaxy";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

import { DemoLoopShell } from "./demo-loop-shell";
import { writeExtractResult } from "./storage";

const defaultContent =
  "2018 年除夕我们第一次在新房里过年。妈妈忙了一整天，最后在客厅拍下了全家福，那一刻我突然觉得我们终于在这座城市安了家。";

export function MemoryNewClientPage() {
  const router = useRouter();
  const [content, setContent] = useState(defaultContent);
  const [visibility, setVisibility] = useState<Visibility>("family");
  const [result, setResult] = useState<MemoryExtractResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExtract() {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planetId: demoSession.defaultPlanetId,
          visibility,
          content,
        }),
      });

      if (!response.ok) {
        throw new Error("AI 整理失败，请稍后重试");
      }

      const nextResult = (await response.json()) as MemoryExtractResponse;
      setResult(nextResult);
      writeExtractResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI 整理失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleConfirm() {
    if (!result) return;
    writeExtractResult(result);
    router.push("/galaxy");
  }

  return (
    <DemoLoopShell
      eyebrow="记忆星群"
      title="点亮记忆星"
      description="先用一段文字点亮记忆星，再由 AI 整理出时间、地点、人物、情绪与摘要。第一版默认使用稳定的演示服务，并保留待确认字段。"
    >
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-stone-100">当前星球</p>
              <p className="mt-1 text-sm text-stone-400">妈妈的星球 · 家庭可见演示闭环</p>
            </div>
            <label className="block space-y-2 text-sm text-stone-200">
              <span>先写下一段记忆</span>
              <textarea
                className="min-h-48 w-full rounded-lg border border-white/10 bg-stone-950/60 p-4 text-sm leading-7 text-stone-50 outline-none ring-0 placeholder:text-stone-500"
                onChange={(event) => setContent(event.target.value)}
                value={content}
              />
            </label>
            <label className="block space-y-2 text-sm text-stone-200">
              <span>可见范围</span>
              <select
                className="h-11 w-full rounded-lg border border-white/10 bg-stone-950/60 px-4 text-sm text-stone-50"
                onChange={(event) => setVisibility(event.target.value as Visibility)}
                value={visibility}
              >
                <option value="private">私密核心</option>
                <option value="family">家庭可见</option>
                <option value="selected">特定可见</option>
                <option value="public">公开分享</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleExtract} disabled={isSubmitting || content.trim().length === 0}>
                {isSubmitting ? "AI 整理中…" : "AI 整理为记忆星"}
              </Button>
              <Button asChild variant="secondary">
                <Link href="/galaxy">回到推荐航线</Link>
              </Button>
            </div>
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">这一步会产出什么</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
            <li>• AI 提取标题、时间、地点、人物、情绪和摘要</li>
            <li>• 拿不准的字段会标注为待确认</li>
            <li>• 这颗记忆星不会自动公开，也不会自动进入家书</li>
            <li>• 确认后才会带入共鸣星轨</li>
          </ul>
        </Card>
      </div>

      {result ? (
        <Card className="p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>AI 已整理为记忆星</Badge>
            <Badge className="bg-emerald-500/10 text-emerald-200">{result.memory.visibility}</Badge>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 text-sm text-stone-300">
              <p>
                <strong className="text-stone-100">标题：</strong>
                {result.memory.title}
              </p>
              <p>
                <strong className="text-stone-100">时间：</strong>
                {result.memory.occurredAt}
              </p>
              <p>
                <strong className="text-stone-100">地点：</strong>
                {result.memory.location}
              </p>
              <p>
                <strong className="text-stone-100">人物：</strong>
                {result.memory.people.join(" / ")}
              </p>
              <p>
                <strong className="text-stone-100">情绪：</strong>
                {result.memory.emotions.join(" / ")}
              </p>
            </div>
            <div className="space-y-3 text-sm text-stone-300">
              <p>
                <strong className="text-stone-100">摘要：</strong>
                {result.memory.summary}
              </p>
              <p>
                <strong className="text-stone-100">待确认字段：</strong>
                {result.suggestion.uncertainFields.length > 0
                  ? result.suggestion.uncertainFields.join(" / ")
                  : "无，当前演示结果可直接带入下一步"}
              </p>
              <p>
                <strong className="text-stone-100">原始文本：</strong>
                {result.sourceText}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handleConfirm}>确认并进入共鸣星轨</Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              重新整理
            </Button>
          </div>
        </Card>
      ) : null}
    </DemoLoopShell>
  );
}
