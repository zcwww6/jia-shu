"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { MemoryExtractResponse, ResonanceScanResponse } from "@/shared/types/galaxy";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

import { DemoLoopShell } from "./demo-loop-shell";
import { readExtractResult, writeResonanceResult } from "./storage";

export function ResonanceClientPage() {
  const router = useRouter();
  const [extractResult] = useState<MemoryExtractResponse | null>(() => readExtractResult());
  const [result, setResult] = useState<ResonanceScanResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!extractResult) {
      setError("请先在上一页确认一颗记忆星");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/intersections/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memoryId: extractResult.memory.id,
        }),
      });

      if (!response.ok) {
        throw new Error("共鸣扫描失败，请稍后重试");
      }

      const nextResult = (await response.json()) as ResonanceScanResponse;
      setResult(nextResult);
      writeResonanceResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "共鸣扫描失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleConfirm() {
    if (!result) return;
    writeResonanceResult(result);
    router.push("/galaxy");
  }

  return (
    <DemoLoopShell
      eyebrow="共鸣星轨"
      title="查看候选连接并由用户确认"
      description="AI 只负责点亮候选连接，不会替用户认定家庭故事。你可以看到双视角来源、匹配分数和理由，再决定是否带入家书工坊。"
    >
      <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">当前待比对记忆</p>
          {extractResult ? (
            <div className="mt-4 space-y-3 text-sm text-stone-300">
              <p>
                <strong className="text-stone-100">标题：</strong>
                {extractResult.memory.title}
              </p>
              <p>
                <strong className="text-stone-100">时间：</strong>
                {extractResult.memory.occurredAt}
              </p>
              <p>
                <strong className="text-stone-100">地点：</strong>
                {extractResult.memory.location}
              </p>
              <p>
                <strong className="text-stone-100">人物：</strong>
                {extractResult.memory.people.join(" / ")}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-stone-400">当前还没有已确认的记忆星，请先返回上一页完成整理。</p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handleScan} disabled={!extractResult || isSubmitting}>
              {isSubmitting ? "扫描中…" : "扫描共鸣候选"}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/memory/new">返回记忆星群</Link>
            </Button>
          </div>
          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </Card>

        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">本轮规则</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
            <li>• 先看时间、地点、人物是否重合</li>
            <li>• 再看是否指向同一段家庭经历</li>
            <li>• 只有候选状态，不会自动进入家书</li>
            <li>• 只有家庭可见且允许共鸣的内容才参与扫描</li>
          </ul>
        </Card>
      </div>

      {result ? (
        <Card className="p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>2018 除夕共鸣星轨</Badge>
            <Badge className="bg-amber-500/10 text-amber-100">匹配分数 {Math.round(result.candidate.score * 100)}%</Badge>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {result.comparedMemories.map((memory) => (
              <div key={memory.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-stone-300">
                <p className="font-semibold text-stone-100">{memory.title}</p>
                <p className="mt-2">{memory.summary}</p>
                <p className="mt-3 text-stone-400">{memory.occurredAt} · {memory.location}</p>
                <p className="mt-1 text-stone-400">{memory.people.join(" / ")}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="时间" value={result.breakdown.time} />
            <MetricCard label="人物" value={result.breakdown.people} />
            <MetricCard label="地点" value={result.breakdown.location} />
            <MetricCard label="语义" value={result.breakdown.semantic} />
          </div>

          <p className="mt-5 text-sm leading-7 text-stone-300">
            <strong className="text-stone-100">AI 判断理由：</strong>
            {result.candidate.reason}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handleConfirm}>确认这条共鸣星轨</Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              重新扫描
            </Button>
          </div>
        </Card>
      ) : null}
    </DemoLoopShell>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-stone-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-stone-50">{Math.round(value * 100)}%</p>
    </div>
  );
}
