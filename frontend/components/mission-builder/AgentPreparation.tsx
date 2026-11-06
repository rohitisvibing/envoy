"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Bot, Mic, RotateCcw } from "lucide-react";
import { api } from "@/services/api";
import type { ConversationMode, Mission } from "@/types/api";
import { money } from "@/lib/format";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

const STEPS = [
  "Reading your profile and sharing rules",
  "Loading the mission and hard limits",
  "Planning the conversation",
  "Writing the opening line",
  "Anticipating objections",
  "Marking the moments that need you",
];

function Brief({ mission }: { mission: Mission }) {
  const b = mission.brief!;
  return (
    <div className="space-y-6">
      <section aria-label="Opening line">
        <h2 className="text-meta font-medium text-ink-2">First thing the agent will say</h2>
        <blockquote className="mt-2 border-l-2 border-violet pl-4 text-lead text-ink">
          {b.opening_statement}
          <span className="mt-1 block text-meta text-ink-3">{b.opening_language}</span>
        </blockquote>
      </section>
      {mission.spec.hard_limits.length > 0 && (
        <section aria-label="Limits">
          <h2 className="text-meta font-medium text-ink-2">Won&apos;t go past</h2>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-body">
            {mission.spec.hard_limits.map((q) => (
              <span key={q.name}>
                {q.label} <span className="tabular">{q.direction === "max" ? "≤" : "≥"} {money(q.value, q.unit)}</span>
              </span>
            ))}
          </p>
        </section>
      )}
      <section aria-label="Plan">
        <h2 className="text-meta font-medium text-ink-2">Plan</h2>
        <ol className="mt-2 space-y-1.5">
          {b.strategy_steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-body">
              <span className="w-4 shrink-0 text-right text-meta text-ink-3 tabular">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
      {b.anticipated_objections.length > 0 && (
        <section aria-label="Likely objections">
          <h2 className="text-meta font-medium text-ink-2">If they say…</h2>
          <dl className="mt-2 space-y-3">
            {b.anticipated_objections.map((o, i) => (
              <div key={i}>
                <dt className="text-body text-ink">&ldquo;{o.objection}&rdquo;</dt>
                <dd className="mt-0.5 text-meta text-ink-2">{o.response}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {b.approval_triggers.length > 0 && (
        <section aria-label="Will ask you">
          <h2 className="text-meta font-medium text-ink-2">Will stop and ask you when</h2>
          <ul className="mt-2 space-y-1.5">
            {b.approval_triggers.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-body">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModeOption({ mode, current, onSelect, title, body, icon: Icon }: {
  mode: ConversationMode; current: ConversationMode; onSelect: (m: ConversationMode) => void; title: string; body: string; icon: typeof Bot;
}) {
  const on = current === mode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => onSelect(mode)}
      className={cn(
        "flex min-h-20 items-start gap-3 rounded-xl border border-line p-3.5 text-left transition-colors",
        on ? "border-violet/60 bg-violet-soft/50" : "hover:bg-surface",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-violet" : "text-ink-2")} />
      <span>
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-meta text-ink-2">{body}</span>
      </span>
    </button>
  );
}

export function AgentPreparation({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const mission = useQuery({ queryKey: ["mission", id], queryFn: () => api.mission(id) });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const [mode, setMode] = useState<ConversationMode>("simulated");
  const [voice, setVoice] = useState(true);
  const started = useRef(false);

  const prepare = useMutation({
    mutationFn: () => api.prepare(id),
    onSuccess: (m) => qc.setQueryData(["mission", id], m),
  });
  const open = useMutation({
    mutationFn: () => api.createConversation(id, mode, voice),
    onSuccess: (c) => router.push(`/conversations/${c.id}`),
  });

  const m = mission.data;
  useEffect(() => {
    if (m && !m.brief && m.status !== "draft" && !started.current) {
      started.current = true;
      prepare.mutate();
    }
  }, [m, prepare]);

  if (mission.error) return <ErrorNote error={mission.error} />;
  if (!m) return <p className="text-ink-3">Loading…</p>;
  if (m.status === "draft")
    return (
      <div>
        <p className="text-body text-ink-2">Approve the mission before preparing the agent.</p>
        <Button className="mt-4" onClick={() => router.push(`/missions/${id}/review`)}>
          Review mission
        </Button>
      </div>
    );

  const preparing = !m.brief;
  const speechOk = health.data?.speech.configured ?? false;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-12">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <div className="mx-auto aspect-square w-full max-w-[18rem] lg:max-w-none">
          <AgentOrb state={preparing ? "preparing" : "ready"} label={preparing ? "Preparing the agent" : "Agent ready"} />
        </div>
        <h1 className="mt-2 text-center text-title font-semibold tracking-[-0.02em] lg:text-left">{m.spec.title}</h1>
        <p className="mt-1 text-center text-meta text-ink-2 lg:text-left">{preparing ? "Preparing" : "Ready when you are"}</p>
      </div>

      <div className="min-w-0">
        {preparing ? (
          <div aria-live="polite">
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.12 }}
                  className="flex items-center gap-3 text-body text-ink-2"
                >
                  <span className="size-1.5 rounded-full bg-violet/70" aria-hidden />
                  {s}
                </motion.li>
              ))}
            </ol>
            <ErrorNote error={prepare.error} className="mt-6" />
            {prepare.error && (
              <Button className="mt-3" variant="secondary" onClick={() => prepare.mutate()}>
                <RotateCcw className="size-4" /> Try again
              </Button>
            )}
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Brief mission={m} />

            <section className="mt-8 border-t border-line/70 pt-6" aria-label="Who's on the other end">
              <h2 className="text-lead font-medium">Who&apos;s on the other end?</h2>
              <div role="radiogroup" className="mt-3 grid gap-2 sm:grid-cols-2">
                <ModeOption
                  mode="simulated"
                  current={mode}
                  onSelect={setMode}
                  icon={Bot}
                  title="Practice with a simulated counterparty"
                  body={`An AI plays the ${m.spec.counterparty.type}. Good for rehearsing before the real thing.`}
                />
                <ModeOption
                  mode="live"
                  current={mode}
                  onSelect={setMode}
                  icon={Mic}
                  title="Live voice through this device"
                  body="The other person speaks into your microphone. The agent listens and replies aloud."
                />
              </div>
              <label className="mt-4 flex min-h-11 items-center justify-between gap-4 rounded-xl border border-line px-3.5">
                <span>
                  <span className="block text-body">Speak out loud</span>
                  <span className="block text-meta text-ink-2">
                    {speechOk ? "Voices by Sarvam Bulbul. Turn off to run in text only." : "Add SARVAM_API_KEY to enable voice. Text only for now."}
                  </span>
                </span>
                <Switch checked={voice && speechOk} disabled={!speechOk} onCheckedChange={setVoice} aria-label="Speak out loud" />
              </label>
              {mode === "live" && !speechOk && (
                <p className="mt-2 text-meta text-warning">Without a Sarvam key, type what the other person says instead of speaking.</p>
              )}
            </section>

            <ErrorNote error={open.error} className="mt-4" />
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => open.mutate()} disabled={open.isPending}>
                {open.isPending ? "Opening…" : "Open conversation"}
              </Button>
              <Button variant="ghost" onClick={() => router.push(`/missions/${id}/review`)} disabled={m.status === "active"}>
                Edit mission
              </Button>
            </div>
            <p className="mt-3 text-meta text-ink-3">Nothing is said until you press Start in the workspace.</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
