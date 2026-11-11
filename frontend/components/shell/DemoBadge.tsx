"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A single dot when something isn't real: demo AI, no voice, memory storage, or no backend. */
export function DemoBadge({ className }: { className?: string }) {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });
  const gaps = isError
    ? ["Backend offline"]
    : data
      ? [data.demo_mode && "Demo AI", !data.speech.configured && "No voice", !data.database.configured && "Not saved"].filter(
          (g): g is string => Boolean(g),
        )
      : [];
  if (!gaps.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            role="status"
            aria-label={gaps.join(", ")}
            className={cn("grid size-6 place-items-center rounded-full", className)}
          />
        }
      >
        <span className={cn("size-1.5 rounded-full", isError ? "bg-error" : "bg-warning")} />
      </TooltipTrigger>
      <TooltipContent>{gaps.join(", ")}</TooltipContent>
    </Tooltip>
  );
}
