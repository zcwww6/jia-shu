import Link from "next/link";

import type { Planet } from "@/shared/types/galaxy";

const colorByType: Record<Planet["type"], string> = {
  self: "from-teal-200 via-slate-300 to-stone-700",
  parent: "from-amber-200 via-orange-300 to-rose-800",
  child: "from-yellow-100 via-lime-200 to-emerald-500",
  memorial: "from-violet-200 via-purple-300 to-slate-700",
  public: "from-emerald-200 via-cyan-200 to-stone-600",
  partner: "from-rose-200 via-sky-200 to-stone-700",
};

export function PlanetNode({ planet }: { planet: Planet }) {
  return (
    <Link
      href={`/planet/${planet.id}`}
      className="group absolute isolate flex w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center outline-none"
      style={{ left: `${planet.position.x}%`, top: `${planet.position.y}%` }}
      aria-label={`进入${planet.name}漫游`}
    >
      <span
        className={`relative block size-20 rounded-full bg-gradient-to-br ${colorByType[planet.type]} shadow-[0_0_38px_rgba(242,206,137,0.24)] transition duration-300 group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-amber-100`}
      >
        <span className="absolute inset-3 rounded-full border border-white/20" />
        <span className="absolute left-1/2 top-1/2 h-[1px] w-28 -translate-x-1/2 rotate-[-14deg] bg-white/24" />
      </span>
      <span className="rounded-md border border-white/10 bg-stone-950/70 px-3 py-1 text-xs font-semibold text-stone-100 backdrop-blur">
        {planet.name}
      </span>
    </Link>
  );
}
