"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { BookGenerateResponse, ResonanceScanResponse } from "@/shared/types/galaxy";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

import { DemoLoopShell } from "./demo-loop-shell";
import { readResonanceResult, writeBookResult } from "./storage";

export function BookNewClientPage() {
  const router = useRouter();
  const [resonanceResult] = useState<ResonanceScanResponse | null>(() => readResonanceResult());
  const [result, setResult] = useState<BookGenerateResponse | null>(null);
  const [themeTemplateKey, setThemeTemplateKey] = useState("family_reunion");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!resonanceResult) {
      setError("请先确认一条共鸣星轨");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/books/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceMemoryIds: resonanceResult.candidate.sourceMemoryIds,
          sourceRange: "binary_system",
          themeTemplateKey,
        }),
      });

      if (!response.ok) {
        throw new Error("家书生成失败，请稍后重试");
      }

      const nextResult = (await response.json()) as BookGenerateResponse;
      setResult(nextResult);
      writeBookResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "家书生成失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleContinue() {
    if (!result) return;
    writeBookResult(result);
    router.push("/settings/privacy");
  }

  return (
    <DemoLoopShell
      eyebrow="家书工坊"
      title="只基于已确认来源生成一页家书"
      description="第一版先生成稳定可展示的家书草稿，保留 sourceMemoryIds 和章节来源，不做 PDF、不做持久化分享，只完成展示闭环。"
    >
      <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">生成设置</p>
          <div className="mt-4 space-y-4 text-sm text-stone-300">
            <p>
              <strong className="text-stone-100">来源范围：</strong>
              双星系 · 妈妈的星球 + 我的星球
            </p>
            <label className="block space-y-2">
              <span className="text-stone-200">主题星云</span>
              <select
                className="h-11 w-full rounded-lg border border-white/10 bg-stone-950/60 px-4 text-sm text-stone-50"
                onChange={(event) => setThemeTemplateKey(event.target.value)}
                value={themeTemplateKey}
              >
                <option value="family_reunion">家庭团圆</option>
                <option value="parent_story">父母人生</option>
                <option value="child_growth">亲子成长</option>
                <option value="travel">旅行星云</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleGenerate} disabled={!resonanceResult || isSubmitting}>
                {isSubmitting ? "生成中…" : "生成家书草稿"}
              </Button>
              <Button asChild variant="secondary">
                <Link href="/resonance">返回共鸣星轨</Link>
              </Button>
            </div>
            {error ? <p className="text-rose-300">{error}</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">生成约束</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
            <li>• 只能使用已确认的来源记忆</li>
            <li>• 每个章节都保留 sourceMemoryIds</li>
            <li>• 不确定信息会保持克制表达</li>
            <li>• 分享前仍需再次确认可见范围</li>
          </ul>
        </Card>
      </div>

      {result ? (
        <Card className="p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>家书草稿已生成</Badge>
            <Badge className="bg-sky-500/10 text-sky-100">{result.draft.themeTemplateKey}</Badge>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-stone-50">{result.draft.title}</h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-stone-300">{result.draft.intro}</p>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-stone-300">
            <strong className="text-stone-100">sourceMemoryIds：</strong>
            {result.draft.sourceMemoryIds.join(" / ")}
          </div>
          <div className="mt-5 space-y-4">
            {result.sections.map((section) => (
              <div key={section.title} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="font-semibold text-stone-50">{section.title}</p>
                <p className="mt-2 text-sm leading-7 text-stone-300">{section.body}</p>
                <p className="mt-3 text-xs tracking-[0.16em] text-stone-400">
                  来源：{section.sourceMemoryIds.join(" / ")}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handleContinue}>进入分享前确认</Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              重新生成
            </Button>
          </div>
        </Card>
      ) : null}
    </DemoLoopShell>
  );
}
