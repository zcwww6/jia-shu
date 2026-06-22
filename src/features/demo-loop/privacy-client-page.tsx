"use client";

import Link from "next/link";
import { useState } from "react";

import type { BookGenerateResponse, ShareConfirmationPayload } from "@/shared/types/galaxy";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

import { DemoLoopShell } from "./demo-loop-shell";
import { readBookResult, readSharePayload, writeSharePayload } from "./storage";

const defaultPayload: ShareConfirmationPayload = {
  showBody: true,
  showSourceTitles: true,
  showOriginalText: false,
};

export function PrivacyClientPage() {
  const [bookResult] = useState<BookGenerateResponse | null>(() => readBookResult());
  const [payload, setPayload] = useState<ShareConfirmationPayload>(() => readSharePayload() ?? defaultPayload);
  const [confirmed, setConfirmed] = useState(false);

  function toggle<K extends keyof ShareConfirmationPayload>(key: K) {
    const nextPayload = {
      ...payload,
      [key]: !payload[key],
    };
    setPayload(nextPayload);
    writeSharePayload(nextPayload);
    setConfirmed(false);
  }

  function confirmShare() {
    writeSharePayload(payload);
    setConfirmed(true);
  }

  return (
    <DemoLoopShell
      eyebrow="隐私星域"
      title="分享前确认范围"
      description="公开的是已经选择的一页家书，不是整颗星球。第一版把分享边界明确展示出来，让评审能看到“正文 / 来源标题 / 原始全文”是分层控制的。"
    >
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>分享前确认</Badge>
            <Badge className="bg-violet-500/10 text-violet-100">不会公开整颗星球</Badge>
          </div>

          <div className="mt-6 space-y-4">
            <ToggleRow
              checked={payload.showBody}
              description="允许分享当前家书正文，但不代表开放原始素材库。"
              label="展示家书正文"
              onChange={() => toggle("showBody")}
            />
            <ToggleRow
              checked={payload.showSourceTitles}
              description="只展示来源记忆标题，帮助建立可追溯性。"
              label="展示来源标题"
              onChange={() => toggle("showSourceTitles")}
            />
            <ToggleRow
              checked={payload.showOriginalText}
              description="原始全文默认关闭，只有明确同意才建议开放。"
              label="展示原始全文"
              onChange={() => toggle("showOriginalText")}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={confirmShare}>确认分享</Button>
            <Button asChild variant="secondary">
              <Link href="/books/new">返回家书工坊</Link>
            </Button>
          </div>

          {confirmed ? <p className="mt-4 text-sm text-emerald-300">分享范围已确认，当前演示不会公开整颗星球。</p> : null}
        </Card>

        <Card className="p-6">
          <p className="text-sm font-semibold text-stone-100">当前可分享对象</p>
          {bookResult ? (
            <div className="mt-4 space-y-3 text-sm leading-7 text-stone-300">
              <p>
                <strong className="text-stone-100">标题：</strong>
                {bookResult.draft.title}
              </p>
              <p>
                <strong className="text-stone-100">来源：</strong>
                {bookResult.draft.sourceMemoryIds.join(" / ")}
              </p>
              <p>
                <strong className="text-stone-100">状态：</strong>
                {bookResult.status}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-400">当前没有可分享的家书草稿，请先完成前一页生成。</p>
          )}
        </Card>
      </div>
    </DemoLoopShell>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      className="flex w-full items-start justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/8"
      onClick={onChange}
      type="button"
    >
      <div>
        <p className="text-sm font-semibold text-stone-100">{label}</p>
        <p className="mt-2 text-sm leading-6 text-stone-400">{description}</p>
      </div>
      <span
        className={`inline-flex min-w-16 justify-center rounded-full px-3 py-1 text-xs font-semibold ${
          checked ? "bg-emerald-500/15 text-emerald-200" : "bg-stone-700/50 text-stone-300"
        }`}
      >
        {checked ? "已开启" : "已关闭"}
      </span>
    </button>
  );
}
