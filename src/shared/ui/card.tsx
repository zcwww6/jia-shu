import * as React from "react";

import { cn } from "@/shared/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/12 bg-stone-950/55 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
