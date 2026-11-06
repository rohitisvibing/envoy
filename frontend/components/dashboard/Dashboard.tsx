"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, UserRound } from "lucide-react";
import { api } from "@/services/api";
import type { MissionSummary } from "@/types/api";
import { MISSION_STATUS_LABEL, STATE_LABEL, relativeTime } from "@/lib/format";
import { StatusGlyph, missionGlyphState } from "@/components/orb/StatusGlyph";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

function missionHref(m: MissionSummary): string {
  if (m.conversation_id && (m.status === "active" || m.status === "completed" || m.status === "failed"))
    return m.status === "active" ? `/conversations/${m.conversation_id}` : `/conversations/${m.conversation_id}/report`;
  if (m.status === "prepared" || m.status === "approved") return `/missions/${m.id}/prepare`;
  return `/missions/${m.id}/review`;
}

function statusText(m: MissionSummary): string {
  if (m.status === "active" && m.conversation_state) return STATE_LABEL[m.conversation_state];
  if (m.status === "completed") return m.objective_met ? "Objective met" : "Completed";
  return MISSION_STATUS_LABEL[m.status];
}

function MissionRow({ m }: { m: MissionSummary }) {
  const attention = m.conversation_state === "awaiting_approval";
  return (
    <li>
      <Link
        href={missionHref(m)}
        className="group flex items-center gap-3 rounded-xl px-3 py-3.5 transition-colors hover:bg-surface sm:px-4"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line">
          <StatusGlyph state={missionGlyphState(m.status, m.conversation_state)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-body font-medium text-ink">{m.title}</span>
            <span className="shrink-0 text-meta text-ink-3">{relativeTime(m.last_activity)}</span>
          </span>
          <span className="mt-0.5 block truncate text-meta text-ink-2">{m.objective}</span>
          <span className="mt-1.5 flex items-center gap-2 text-[12px]">
            <span className={cn("text-ink-2", attention && "text-warning", m.objective_met && "text-success")}>{statusText(m)}</span>
            <span className="text-ink-3">{m.agent_type}</span>
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function Section({ title, items, empty }: { title: string; items: MissionSummary[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="px-1 text-meta font-medium text-ink-2">
        {title} {items.length > 0 && <span className="text-ink-3">{items.length}</span>}
      </h2>
      {items.length ? (
        <ul className="mt-2 -mx-1 divide-y divide-line/60">
          {items.map((m) => (
            <MissionRow key={m.id} m={m} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 px-1 text-meta text-ink-3">{empty}</p>
      )}
    </section>
  );
}

export function Dashboard() {
  const missions = useQuery({ queryKey: ["missions"], queryFn: api.missions, refetchInterval: 10_000 });
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const list = missions.data ?? [];
  const active = list.filter((m) => m.status === "active");
  const drafts = list.filter((m) => ["draft", "approved", "prepared"].includes(m.status));
  const done = list.filter((m) => m.status === "completed" || m.status === "failed");
  const name = profile.data?.fields.find((f) => f.key === "preferred_name")?.value;

  return (
    <>
      <section className="pt-2">
        <h1 className="text-display font-semibold tracking-[-0.025em] text-ink sm:text-hero">
          {name ? `What should your agent handle, ${name}?` : "What should your agent handle?"}
        </h1>
        <p className="mt-3 max-w-[56ch] text-lead text-ink-2">
          Describe a conversation you want handled. You review the plan, the agent makes the call, and you can step in at any point.
        </p>
        <Link
          href="/missions/new"
          className="mt-6 flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-4 text-left transition-colors hover:border-violet/50 sm:max-w-xl"
        >
          <span className="text-body text-ink-3">Negotiate my rent down to ₹30,000…</span>
          <span className="rounded-lg bg-ink px-3 py-1.5 text-meta font-medium text-bg">New mission</span>
        </Link>
      </section>

      <ErrorNote error={missions.error} className="mt-8" />

      <Section title="Live now" items={active} />
      <Section title="Waiting to start" items={drafts} />
      <Section
        title="Finished"
        items={done}
        empty={list.length === 0 && !missions.isLoading ? "Missions you complete will appear here with their outcome reports." : undefined}
      />

      {templates.data && templates.data.length > 0 && (
        <section className="mt-10" aria-label="Templates">
          <h2 className="px-1 text-meta font-medium text-ink-2">Start from a template</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {templates.data.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/missions/new?template=${t.id}`}
                  className="block h-full rounded-xl border border-line/80 px-3.5 py-3 transition-colors hover:border-line hover:bg-surface"
                >
                  <span className="block text-body font-medium text-ink">{t.name}</span>
                  <span className="mt-1 block text-meta text-ink-2">{t.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href="/profile"
        className="mt-10 flex items-center gap-3 rounded-xl border border-line/80 px-3.5 py-3 transition-colors hover:bg-surface"
      >
        <UserRound className="size-4 text-ink-2" />
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink">Your profile</span>
          <span className="block truncate text-meta text-ink-2">
            Choose what agents may share about you, field by field.
          </span>
        </span>
        <ChevronRight className="size-4 text-ink-3" />
      </Link>
    </>
  );
}
