"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Minus, X } from "lucide-react";
import { api, ApiError } from "@/services/api";
import type { Offer } from "@/types/api";
import { money } from "@/lib/format";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="border-t border-line/70 py-5" aria-label={title}>
      <h2 className="text-meta font-medium text-ink-2">{title}</h2>
      {items.length ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((t, i) => (
            <li key={i} className="text-body text-ink">
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-meta text-ink-3">{empty}</p>
      )}
    </section>
  );
}

function OfferTimeline({ made, received }: { made: Offer[]; received: Offer[] }) {
  const all = [...made.map((o) => ({ ...o, side: "agent" })), ...received.map((o) => ({ ...o, side: "them" }))].sort((a, b) => a.turn - b.turn);
  if (!all.length) return <p className="mt-2 text-meta text-ink-3">No offers were exchanged.</p>;
  return (
    <ol className="mt-3 space-y-2">
      {all.map((o, i) => (
        <li key={i} className={cn("flex items-baseline gap-3", o.side === "agent" ? "" : "")}>
          <span className={cn("w-16 shrink-0 text-meta", o.side === "agent" ? "text-violet" : "text-ink-2")}>{o.side === "agent" ? "Agent" : "Them"}</span>
          <span className="w-24 shrink-0 font-mono text-body tabular text-ink">{o.amount != null ? money(o.amount) : "—"}</span>
          <span className="min-w-0 truncate text-meta text-ink-2">{o.terms}</span>
        </li>
      ))}
    </ol>
  );
}

export function OutcomeReportView({ id }: { id: string }) {
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
      <div className="flex flex-col items-center pt-10" aria-live="polite">
        <div className="size-40">
          <AgentOrb state="thinking" label="Writing the report" />
        </div>
        <p className="mt-2 text-body text-ink-2">Writing the outcome report…</p>
      </div>
    );

  const mission = detail.data?.mission;
  return (
    <div>
      <p className="text-meta text-ink-3">{mission?.spec.title ?? "Outcome"}</p>
      <div className="mt-2 flex items-start gap-4">
        <div className="size-16 shrink-0">
          <AgentOrb state={r.objective_achieved ? "completed" : "paused"} label={r.objective_achieved ? "Objective achieved" : "Objective not achieved"} />
        </div>
        <div className="min-w-0">
          <h1 className={cn("text-display font-semibold tracking-[-0.025em]", r.objective_achieved ? "text-success" : "text-ink")}>
            {r.objective_achieved ? "Objective achieved" : "Objective not achieved"}
          </h1>
          <p className="mt-1 text-body text-ink-2">{r.achievement_rationale}</p>
        </div>
      </div>

      <section className="mt-8" aria-label="Outcome">
        <h2 className="text-meta font-medium text-ink-2">What happened</h2>
        <p className="mt-1.5 max-w-[65ch] text-lead text-ink">{r.final_outcome}</p>
        <p className="mt-3 text-meta text-ink-3">Original objective: {r.objective}</p>
      </section>

      {r.comparisons.length > 0 && (
        <section className="mt-8 overflow-x-auto" aria-label="Target versus achieved">
          <table className="w-full min-w-[22rem] text-left">
            <caption className="mb-2 text-left text-meta font-medium text-ink-2">Target versus achieved</caption>
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-3">
                <th className="py-2 pr-3 font-normal" scope="col"></th>
                <th className="py-2 pr-3 font-normal" scope="col">Target</th>
                <th className="py-2 pr-3 font-normal" scope="col">Limit</th>
                <th className="py-2 pr-3 font-normal" scope="col">Agreed</th>
                <th className="py-2 font-normal" scope="col"><span className="sr-only">Met</span></th>
              </tr>
            </thead>
            <tbody>
              {r.comparisons.map((c) => (
                <tr key={c.name} className="border-b border-line/60">
                  <th scope="row" className="py-3 pr-3 text-body font-normal text-ink">{c.label}</th>
                  <td className="py-3 pr-3 font-mono text-body tabular text-ink-2">{money(c.target, c.unit)}</td>
                  <td className="py-3 pr-3 font-mono text-body tabular text-ink-2">{money(c.limit, c.unit)}</td>
                  <td className="py-3 pr-3 font-mono text-body tabular text-ink">{money(c.achieved, c.unit)}</td>
                  <td className="py-3">
                    {c.met === true ? <Check className="size-4 text-success" aria-label="Met" /> : c.met === false ? <X className="size-4 text-error" aria-label="Missed" /> : <Minus className="size-4 text-ink-3" aria-label="Not agreed" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {r.criteria.length > 0 && (
        <section className="mt-8" aria-label="Success criteria">
          <h2 className="text-meta font-medium text-ink-2">Success criteria</h2>
          <ul className="mt-2 space-y-3">
            {r.criteria.map((c, i) => (
              <li key={i} className="flex gap-3">
                {c.met ? <Check className="mt-1 size-4 shrink-0 text-success" aria-label="Met" /> : <X className="mt-1 size-4 shrink-0 text-error" aria-label="Not met" />}
                <span>
                  <span className="block text-body text-ink">{c.criterion}</span>
                  <span className="block text-meta text-ink-2">{c.evidence}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 border-t border-line/70 py-5" aria-label="Offers">
        <h2 className="text-meta font-medium text-ink-2">Offers made and received</h2>
        <OfferTimeline made={r.offers_made} received={r.offers_received} />
      </section>
      <List title="Agreements" items={r.agreements} empty="Nothing was agreed." />
      <List title="Commitments made" items={r.commitments} empty="No commitments were made on your behalf." />
      <List title="Unresolved" items={r.unresolved_issues} empty="Nothing left open." />

      {r.excerpts.length > 0 && (
        <section className="border-t border-line/70 py-5" aria-label="Key moments">
          <h2 className="text-meta font-medium text-ink-2">Key moments</h2>
          <ul className="mt-3 space-y-3">
            {r.excerpts.map((x, i) => (
              <li key={i} className="border-l-2 border-line pl-3">
                <span className="block text-[12px] text-ink-3">{x.speaker}</span>
                <span className="block text-body text-ink">{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <List title="Recommended next steps" items={r.next_steps} empty="No follow-up needed." />

      <div className="mt-6 flex flex-wrap gap-3">
        <Button size="lg" render={<Link href="/missions/new" />}>
          New mission
        </Button>
        {mission && (
          <Button size="lg" variant="secondary" render={<Link href={`/missions/${mission.id}/prepare`} />}>
            Run it again
          </Button>
        )}
      </div>
    </div>
  );
}
