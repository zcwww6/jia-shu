import Link from "next/link";
import { BookOpen, GitBranch, Sparkles } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

const steps = [
  {
    label: "靠近妈妈的星球",
    detail: "查看她的故事星节点和可生成的家书线索",
    href: "/planet/mock-mom",
  },
  {
    label: "点亮记忆星",
    detail: "先留下一句话，AI 再整理为结构化记忆",
    href: "/memory/new",
  },
  {
    label: "沿共鸣星轨前进",
    detail: "确认两颗星球是否记住了同一天",
    href: "/resonance",
  },
  {
    label: "写成一页家书",
    detail: "只基于已确认记忆，分享前再次确认",
    href: "/books/new",
  },
];

export function RouteGuide() {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-amber-200 text-stone-950">
          <Sparkles size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-stone-50">新手推荐航线</h2>
          <p className="text-sm text-stone-300">从漫游到家书的最短演示路径</p>
        </div>
      </div>
      <div className="grid gap-3">
        {steps.map((step, index) => (
          <Link
            href={step.href}
            key={step.href}
            className="group grid grid-cols-[2.25rem_1fr] gap-3 rounded-md border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.08]"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-white/10 text-sm font-bold text-amber-100">
              {index + 1}
            </span>
            <span>
              <strong className="block text-sm text-stone-50">{step.label}</strong>
              <span className="text-xs leading-5 text-stone-300">{step.detail}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild size="sm">
          <Link href="/resonance">
            <GitBranch size={15} />
            共鸣星轨
          </Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/books/new">
            <BookOpen size={15} />
            家书工坊
          </Link>
        </Button>
      </div>
    </Card>
  );
}
