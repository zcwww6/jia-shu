import Link from "next/link";
import { ArrowLeft, BookOpen, Plus } from "lucide-react";

import { memoryStars, planets, storyNodes } from "@/shared/mock/galaxy-data";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function PlanetExplorer({ planetId }: { planetId: string }) {
  const planet = planets.find((item) => item.id === planetId) ?? planets[0];
  const nodes = storyNodes.filter((node) => node.planetId === planet.id);
  const memories = memoryStars.filter((memory) => memory.planetId === planet.id);

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#171210,#1f2220_52%,#1b1724_100%)] p-5 text-stone-50 md:p-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[20rem_1fr]">
        <aside>
          <Button asChild variant="ghost" className="mb-4 justify-start px-0">
            <Link href="/galaxy">
              <ArrowLeft size={16} />
              返回星系
            </Link>
          </Button>
          <Card className="p-5">
            <Badge>{planet.role}</Badge>
            <h1 className="mt-4 text-3xl font-semibold">{planet.name}</h1>
            <p className="mt-3 text-sm leading-6 text-stone-300">{planet.summary}</p>
            <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-white/[0.05] p-3">
                <dt className="text-xl font-semibold">{planet.stats.memoryStars}</dt>
                <dd className="text-xs text-stone-400">记忆星</dd>
              </div>
              <div className="rounded-md bg-white/[0.05] p-3">
                <dt className="text-xl font-semibold">{planet.stats.resonanceTracks}</dt>
                <dd className="text-xs text-stone-400">星轨</dd>
              </div>
              <div className="rounded-md bg-white/[0.05] p-3">
                <dt className="text-xl font-semibold">{planet.stats.bookDrafts}</dt>
                <dd className="text-xs text-stone-400">家书</dd>
              </div>
            </dl>
            <div className="mt-5 grid gap-3">
              <Button asChild>
                <Link href="/memory/new">
                  <Plus size={16} />
                  点亮记忆星
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/books/new">
                  <BookOpen size={16} />
                  写成家书
                </Link>
              </Button>
            </div>
          </Card>
        </aside>

        <section className="grid gap-5">
          <Card className="p-5">
            <h2 className="text-xl font-semibold">时间轨迹</h2>
            <div className="mt-5 grid gap-3">
              {nodes.map((node) => (
                <article
                  className="grid gap-3 rounded-md border border-white/10 bg-white/[0.04] p-4 md:grid-cols-[5rem_1fr]"
                  key={node.id}
                >
                  <div className="text-lg font-semibold text-amber-100">{node.year}</div>
                  <div>
                    <h3 className="font-semibold text-stone-50">{node.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-stone-300">{node.summary}</p>
                    <p className="mt-2 text-xs text-stone-400">{node.sourceLabel}</p>
                  </div>
                </article>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-xl font-semibold">已点亮记忆星</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {memories.map((memory) => (
                <article className="rounded-md bg-white/[0.05] p-4" key={memory.id}>
                  <h3 className="font-semibold">{memory.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-300">{memory.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{memory.occurredAt}</Badge>
                    <Badge>{memory.location}</Badge>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
