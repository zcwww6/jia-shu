"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { galaxyZones } from "@/shared/mock/galaxy-data";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function DemoLoopShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#15100f_0%,#182322_50%,#211a25_100%)] p-5 text-stone-50 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" className="justify-start px-0">
            <Link href="/galaxy">返回星系</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/memory/new">重新点亮记忆星</Link>
          </Button>
        </div>

        <Card className="p-6 md:p-8">
          <Badge>{eyebrow}</Badge>
          <h1 className="mt-5 text-3xl font-semibold md:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300 md:text-base">{description}</p>
        </Card>

        {children}

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {galaxyZones.map((zone) => (
            <Link
              href={zone.href}
              className="rounded-lg border border-white/10 bg-white/[0.05] p-4 text-sm transition hover:bg-white/[0.08]"
              key={zone.key}
            >
              <strong className="block text-stone-50">{zone.label}</strong>
              <span className="mt-2 block leading-6 text-stone-400">{zone.description}</span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
