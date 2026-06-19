"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BookOpen, Map, Plus, ScanLine } from "lucide-react";

import { PlanetNode } from "@/features/galaxy/planet-node";
import { RouteGuide } from "@/features/galaxy/route-guide";
import {
  bookDrafts,
  galaxyZones,
  planets,
  resonanceTracks,
} from "@/shared/mock/galaxy-data";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function GalaxyWorkspace() {
  const activeTrack = resonanceTracks[0];
  const activeBook = bookDrafts[0];

  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(135deg,#15100f_0%,#132022_48%,#221b27_100%)] text-stone-50">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[18rem_1fr_22rem]">
        <aside className="border-b border-white/10 bg-stone-950/55 p-5 backdrop-blur lg:border-b-0 lg:border-r">
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.28em] text-amber-100/70">Jia Shu Planet</p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-50">我的星系</h1>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              家庭星系操作台，先用 Mock 数据跑通 v7.3 主体验。
            </p>
          </div>
          <nav className="grid gap-2" aria-label="星域导航">
            {galaxyZones.map((zone) => (
              <Link
                className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-stone-200 transition hover:border-amber-100/40 hover:bg-amber-100/10"
                href={zone.href}
                key={zone.key}
              >
                <span className="block font-medium text-stone-50">{zone.label}</span>
                <span className="text-xs text-stone-400">{zone.description}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <section className="relative min-h-[620px] overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px]" />
          <div className="absolute left-[34%] top-[38%] h-[1px] w-[32%] rotate-[7deg] bg-amber-100/35" />
          <div className="absolute left-[48%] top-[52%] h-[1px] w-[24%] rotate-[-18deg] bg-teal-100/25" />

          {planets.map((planet, index) => (
            <motion.div
              animate={{ y: [0, index % 2 === 0 ? -7 : 7, 0] }}
              className="absolute inset-0"
              key={planet.id}
              transition={{ duration: 5 + index, repeat: Infinity, ease: "easeInOut" }}
            >
              <PlanetNode planet={planet} />
            </motion.div>
          ))}

          <div className="absolute left-5 top-5 right-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge>4 条共鸣候选</Badge>
              <Badge>2 页家书待确认</Badge>
              <Badge>长辈大字模式</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href="/memory/new">
                  <Plus size={15} />
                  点亮记忆星
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/books/new">
                  <BookOpen size={15} />
                  生成家书
                </Link>
              </Button>
            </div>
          </div>

          <Card className="absolute bottom-5 left-5 max-w-sm p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-100">
              <ScanLine size={16} />
              星图助手
            </div>
            <p className="text-sm leading-6 text-stone-200">
              推荐从妈妈的星球开始，沿着共鸣星轨进入家书工坊，完成一次“点亮记忆星到分享前确认”的演示。
            </p>
          </Card>
        </section>

        <aside className="border-t border-white/10 bg-stone-950/50 p-5 backdrop-blur lg:border-l lg:border-t-0">
          <RouteGuide />
          <Card className="mt-4 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-50">
              <Map size={16} />
              当前 Mock 闭环
            </div>
            <p className="text-sm leading-6 text-stone-300">{activeTrack.reason}</p>
            <div className="mt-4 rounded-md bg-white/[0.04] p-3">
              <strong className="block text-sm text-stone-50">{activeBook.title}</strong>
              <span className="text-xs leading-5 text-stone-400">{activeBook.intro}</span>
            </div>
          </Card>
        </aside>
      </div>
    </main>
  );
}
