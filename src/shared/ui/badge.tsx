import * as React from "react";

import { cn } from "@/shared/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-xs font-medium text-stone-100",
        className,
      )}
      {...props}
    />
  );
}
