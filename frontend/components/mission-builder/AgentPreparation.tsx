"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bot, ChevronDown, Mic, Pencil, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { api } from "@/services/api";
import type { ConversationMode, Mission } from "@/types/api";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { AmbientGlow } from "@/components/shell/AmbientGlow";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { DealLine, dealFrom } from "@/components/viz/DealLine";
import { cn } from "@/lib/utils";

function Plan({ mission }: { mission: Mission }) {
  const b = mission.brief!;
  return (
    <div className="space-y-8 pt-4 text-left">
      <section aria-label="Plan">
        <h2 className="text-meta text-ink-3">Plan</h2>
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
        <section aria-label="If they push back">
          <h2 className="text-meta text-ink-3">If they push back</h2>
          <dl className="mt-2 space-y-3">
            {b.anticipated_objections.map((o, i) => (
              <div key={i}>
                <dt className="text-body text-ember">&ldquo;{o.objection}&rdquo;</dt>
                <dd className="mt-0.5 text-body text-ink-2">{o.response}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {b.approval_triggers.length > 0 && (
        <section aria-label="Stops to ask you">
          <h2 className="text-meta text-ink-3">Stops to ask you</h2>
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

const MODES: { mode: ConversationMode; label: string; hint: string; icon: typeof Bot }[] = [
  { mode: "simulated", label: "Practice", hint: "An AI plays the other side", icon: Bot },
  { mode: "live", label: "Live", hint: "The other person speaks into this device", icon: Mic },
];

export function AgentPreparation({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const mission = useQuery({ queryKey: ["mission", id], queryFn: () => api.mission(id) });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const [mode, setMode] = useState<ConversationMode>("simulated");
  const [voice, setVoice] = useState(true);
  const [plan, setPlan] = useState(false);
  const speechOk = health.data?.speech.configured ?? false;
  const started = useRef(false);

  const prepare = useMutation({
    mutationFn: () => api.prepare(id),
    onSuccess: (m) => qc.setQueryData(["mission", id], m),
  });
  const open = useMutation({
    mutationFn: () => api.createConversation(id, mode, voice && speechOk),
    // Straight into the call: the workspace starts it as soon as it connects.
    onSuccess: (c) => router.push(`/conversations/${c.id}?autostart=1`),
  });

  const m = mission.data;
  useEffect(() => {
    if (m && !m.brief && m.status !== "draft" && !started.current) {
      started.current = true;
      prepare.mutate();
    }
  }, [m, prepare]);

  const preparing = !m?.brief;
  useEffect(() => {
    // Only trust a fresh read: a cached copy may predate the approval.
    if (m?.status === "draft" && mission.isFetchedAfterMount) router.replace(`/missions/${id}/review`);
  }, [m?.status, mission.isFetchedAfterMount, router, id]);

  if (mission.error) return <ErrorNote error={mission.error} />;
  if (!m) return <AmbientGlow state="preparing" />;
  if (m.status === "draft") return null;

  const deal = dealFrom(m.spec);

  return (
    <div className="flex flex-col items-center text-center">
      <AmbientGlow state={preparing ? "preparing" : "ready"} />
      <div className={cn("aspect-square transition-[width] duration-700", preparing ? "mt-[8vh] w-[min(78vw,22rem)]" : "w-[min(56vw,15rem)]")}>
        <AgentOrb state={preparing ? "preparing" : "ready"} label={preparing ? "Preparing the agent" : "Agent ready"} />
      </div>

      {preparing ? (
        <div className="mt-4 w-full max-w-md text-left">
          <ErrorNote error={prepare.error} />
          {prepare.error && (
            <Button className="mt-3" variant="secondary" onClick={() => prepare.mutate()}>
              <RotateCcw className="size-4" /> Try again
            </Button>
          )}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className="w-full"
        >
          <p className="text-meta text-ink-3">{m.spec.title}</p>
          <blockquote lang={m.brief!.opening_language === "English" ? "en" : undefined} className="mx-auto mt-3 max-w-[30ch] font-serif text-[1.75rem] leading-[1.2] text-ink sm:text-[2rem]">
            &ldquo;{m.brief!.opening_statement}&rdquo;
          </blockquote>

          {deal && <DealLine deal={deal} className="mx-auto mt-10 max-w-md text-left" />}

          <div className="mt-10 flex items-center justify-center gap-2">
            <div role="radiogroup" aria-label="Who's on the other end" className="flex rounded-full bg-surface/80 p-1 ring-1 ring-line">
              {MODES.map(({ mode: v, label, hint, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  title={hint}
                  onClick={() => setMode(v)}
                  className={cn(
                    "flex min-h-10 items-center gap-2 rounded-full px-4 text-meta text-ink-2 transition-colors hover:text-ink",
                    mode === v && "bg-elevated text-ink",
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            <IconButton
              label={!speechOk ? "Voice needs a Sarvam key" : voice ? "Voice on" : "Text only"}
              icon={voice && speechOk ? Volume2 : VolumeX}
              active={voice && speechOk}
              disabled={!speechOk}
              onClick={() => setVoice((v) => !v)}
            />
          </div>

          <ErrorNote error={open.error} className="mx-auto mt-6 max-w-md text-left" />
          <Button
            size="lg"
            onClick={() => open.mutate()}
            disabled={open.isPending}
            className="mt-8 h-14 rounded-full px-12 text-lead shadow-[0_10px_50px_-10px_rgb(157_176_255/0.7)]"
          >
            Start
          </Button>

          <div className="mt-10 flex items-center justify-center gap-1">
            <button
              type="button"
              aria-expanded={plan}
              onClick={() => setPlan((v) => !v)}
              className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-meta text-ink-2 hover:text-ink"
            >
              <ChevronDown className={cn("size-4 transition-transform", plan && "rotate-180")} />
              Plan
            </button>
            {m.status !== "active" && <IconButton label="Edit mission" icon={Pencil} size="sm" onClick={() => router.push(`/missions/${id}/review`)} />}
          </div>
          <AnimatePresence initial={false}>
            {plan && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mx-auto max-w-xl overflow-hidden">
                <Plan mission={m} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
