"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";

/** Shown whenever the backend runs without real providers. */
export function DemoBadge({ className }: { className?: string }) {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });
  if (isError)
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-error/40 px-2.5 py-1 text-[12px] text-error", className)}>
        Backend offline
      </span>
    );
  if (!data) return null;
  const gaps = [data.demo_mode && "demo AI", !data.speech.configured && "no voice", !data.database.configured && "memory storage"].filter(Boolean);
  if (!gaps.length) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[12px] text-warning", className)}
      title="Add API keys to .env to use real providers"
    >
      Demo mode: {gaps.join(", ")}
    </span>
  );
}
