"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, X } from "lucide-react";
import { api, ApiError } from "@/services/api";
import type { Offer } from "@/types/api";
import { money } from "@/lib/format";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { AmbientGlow } from "@/components/shell/AmbientGlow";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { DealLine, dealFrom } from "@/components/viz/DealLine";
import { cn } from "@/lib/utils";

function List({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="text-meta text-ink-3">{title}</h2>
      <ul className="mt-1.5 space-y-1">
        {items.map((t, i) => (
          <li key={i} className={cn("text-body", tone ?? "text-ink")}>
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Offers({ made, received }: { made: Offer[]; received: Offer[] }) {
  const all = [...made.map((o) => ({ ...o, side: "agent" })), ...received.map((o) => ({ ...o, side: "them" }))].sort((a, b) => a.turn - b.turn);
  if (!all.length) return null;
  return (
    <section aria-label="Offers">
      <h2 className="text-meta text-ink-3">Offers</h2>
      <ol className="mt-1.5 space-y-1">
        {all.map((o, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className={cn("w-20 shrink-0 text-body tabular", o.side === "agent" ? "text-aurora" : "text-ember")}>
              <span className="sr-only">{o.side === "agent" ? "Agent" : "Them"}: </span>
              {o.amount != null ? money(o.amount) : "—"}
            </span>
            <span className="min-w-0 truncate text-meta text-ink-2">{o.terms}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OutcomeReportView({ id }: { id: string }) {
  const [details, setDetails] = useState(false);
  const report = useQuery({
    queryKey: ["report", id],
    queryFn: () => api.report(id),
    retry: (n, err) => n < 20 && err instanceof ApiError && err.status === 409,
    retryDelay: 1500,
  });
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.conversation(id) });

  if (report.error) return <ErrorNote error={report.error} />;
  const r = report.data;
  if (!r)
    return (
      <div className="grid place-items-center pt-[10vh]" aria-live="polite">
        <AmbientGlow state="thinking" />
        <div className="size-56">
          <AgentOrb state="thinking" label="Writing the outcome" />
        </div>
      </div>
    );

  const mission = detail.data?.mission;
  const agreed = r.comparisons.find((c) => c.achieved != null)?.achieved ?? null;
  const deal = mission ? dealFrom(mission.spec, r, agreed) : null;
  const met = r.objective_achieved;
  // Lead with the first sentence; the full account waits in Details.
  const [lead, ...restParts] = r.final_outcome.split(/(?<=[.!?])\s+/);
  const rest = restParts.join(" ");

  return (
    <div className="pt-4 sm:pt-10">
      <AmbientGlow state={met ? "completed" : "paused"} />
      <p className="text-meta text-ink-3">{mission?.spec.title ?? ""}</p>
      <div className="mt-1 flex items-center gap-3">
        <h1 className={cn("font-serif text-[4rem] leading-none sm:text-[5rem]", met ? "text-success" : "text-ink")}>{met ? "Met" : "Not met"}</h1>
        <div className="size-16 shrink-0 sm:size-20">
          <AgentOrb state={met ? "completed" : "paused"} label={met ? "Objective met" : "Objective not met"} />
        </div>
      </div>
      <p className="mt-4 max-w-[48ch] text-title text-ink">{lead}</p>

      {deal && <DealLine deal={deal} play className="mt-12 max-w-lg" />}

      {r.criteria.length > 0 && (
        <ul className="mt-12 space-y-1" aria-label="Success criteria">
          {r.criteria.map((c, i) => (
            <li key={i}>
              <details className="group">
                <summary className="flex min-h-9 cursor-pointer list-none items-start gap-3 py-1 text-body text-ink [&::-webkit-details-marker]:hidden">
                  {c.met ? (
                    <Check className="mt-1 size-4 shrink-0 text-success" aria-label="Met" />
                  ) : (
                    <X className="mt-1 size-4 shrink-0 text-error" aria-label="Not met" />
                  )}
                  {c.criterion}
                </summary>
                <p className="pb-2 pl-7 text-meta text-ink-2">{c.evidence}</p>
              </details>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        aria-expanded={details}
        onClick={() => setDetails((v) => !v)}
        className="mt-8 flex min-h-10 items-center gap-1.5 text-meta text-ink-2 hover:text-ink"
      >
        <ChevronDown className={cn("size-4 transition-transform", details && "rotate-180")} />
        Details
      </button>
      <AnimatePresence initial={false}>
        {details && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-7 pb-2 pt-4">
              {rest && <p className="max-w-[65ch] text-body text-ink">{rest}</p>}
              <p className="max-w-[65ch] text-body text-ink-2">{r.achievement_rationale}</p>
              <Offers made={r.offers_made} received={r.offers_received} />
              <List title="Agreed" items={r.agreements} tone="text-success" />
              <List title="Committed for you" items={r.commitments} />
              <List title="Still open" items={r.unresolved_issues} />
              {r.excerpts.length > 0 && (
                <section aria-label="Key moments">
                  <h2 className="text-meta text-ink-3">Key moments</h2>
                  <ul className="mt-1.5 space-y-2.5">
                    {r.excerpts.map((x, i) => {
                      const them = !/agent/i.test(x.speaker);
                      return (
                        <li key={i} className={cn("text-body", them ? "border-r-2 border-ember/60 pr-3 text-right text-ember" : "border-l-2 border-aurora/60 pl-3 text-ink")}>
                          <span className="sr-only">{x.speaker}: </span>
                          {x.text}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <List title="Next" items={r.next_steps} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-10 flex flex-wrap items-center gap-2">
        <Button size="lg" className="h-12 rounded-full px-7" nativeButton={false} render={<Link href="/" />}>
          New mission
        </Button>
        {mission && (
          <Button size="lg" variant="ghost" className="h-12 rounded-full px-3" nativeButton={false} render={<Link href={`/missions/${mission.id}/prepare`} />}>
            Run again
          </Button>
        )}
        <Button size="lg" variant="ghost" className="h-12 rounded-full px-3" nativeButton={false} render={<Link href={`/conversations/${id}`} />}>
          Transcript
        </Button>
      </div>
    </div>
  );
}
