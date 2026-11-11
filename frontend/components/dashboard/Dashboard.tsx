"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { MissionSummary } from "@/types/api";
import { relativeTime } from "@/lib/format";
import { StatusGlyph, missionGlyphState } from "@/components/orb/StatusGlyph";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { MissionComposer } from "@/components/mission-builder/MissionComposer";
import { cn } from "@/lib/utils";

function missionHref(m: MissionSummary): string {
  if (m.conversation_id && (m.status === "active" || m.status === "completed" || m.status === "failed"))
    return m.status === "active" ? `/conversations/${m.conversation_id}` : `/conversations/${m.conversation_id}/report`;
  if (m.status === "prepared" || m.status === "approved") return `/missions/${m.id}/prepare`;
  return `/missions/${m.id}/review`;
}

/** One word, and only when it says something the glyph doesn't. */
function word(m: MissionSummary): { text: string; tone: string } | null {
  if (m.status === "active") return m.conversation_state === "awaiting_approval" ? { text: "needs you", tone: "text-warning" } : { text: "live", tone: "text-aurora" };
  if (m.status === "completed") return m.objective_met ? { text: "met", tone: "text-success" } : { text: "not met", tone: "text-ink-2" };
  if (m.status === "failed") return { text: "stopped", tone: "text-error" };
  if (m.status === "draft") return { text: "draft", tone: "text-ink-3" };
  return null;
}

const ORDER: Record<string, number> = { active: 0, prepared: 1, approved: 1, draft: 2, completed: 3, failed: 3 };

export function Dashboard() {
  const missions = useQuery({ queryKey: ["missions"], queryFn: api.missions, refetchInterval: 10_000 });
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const name = profile.data?.fields.find((f) => f.key === "preferred_name")?.value ?? undefined;
  const list = [...(missions.data ?? [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || +new Date(b.last_activity) - +new Date(a.last_activity),
  );

  return (
    <>
      <MissionComposer greeting={name} />
      <ErrorNote error={missions.error} className="mt-10" />
      {list.length > 0 && (
        <ul className="mt-14 sm:mt-20" aria-label="Your missions">
          {list.map((m) => {
            const w = word(m);
            return (
              <li key={m.id}>
                <Link
                  href={missionHref(m)}
                  className="-mx-3 flex min-h-14 items-center gap-3.5 rounded-2xl px-3 transition-colors hover:bg-surface/70"
                >
                  <StatusGlyph state={missionGlyphState(m.status, m.conversation_state)} />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{m.title}</span>
                  {w && <span className={cn("shrink-0 text-meta", w.tone)}>{w.text}</span>}
                  <span className="w-10 shrink-0 text-right text-meta text-ink-3 tabular">{relativeTime(m.last_activity)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
