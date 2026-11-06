"use client";

import type { MissionSpec, NegotiationState, Offer } from "@/types/api";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

function lastOffer(list: Offer[], name: string): Offer | undefined {
  return [...list].reverse().find((o) => o.amount != null && (o.quantity_name == null || o.quantity_name === name));
}

/** Live mission state: targets vs offers, limits, next step, agreements. */
export function MissionStatePanel({ spec, n, className }: { spec: MissionSpec; n: NegotiationState | null; className?: string }) {
  const names = Array.from(new Set([...spec.targets.map((t) => t.name), ...spec.hard_limits.map((l) => l.name)]));
  return (
    <div className={cn("space-y-6", className)}>
      <section aria-label="Objective">
        <h3 className="text-meta text-ink-2">Objective</h3>
        <p className="mt-1 text-body text-ink">{spec.objective}</p>
        {n?.phase && <p className="mt-1 text-[12px] capitalize text-ink-3">Phase: {n.phase}</p>}
      </section>

      {names.map((name) => {
        const target = spec.targets.find((t) => t.name === name);
        const limit = spec.hard_limits.find((l) => l.name === name);
        const ref = target ?? limit!;
        const theirs = n ? lastOffer(n.offers_received, name) : undefined;
        const ours = n ? lastOffer(n.offers_made, name) : undefined;
        const rows: [string, number | null | undefined, string?][] = [
          ["Target", target?.value],
          ["Their last offer", theirs?.amount, "text-ink"],
          ["Our last offer", ours?.amount, "text-violet"],
          ["Your limit", limit?.value, "text-warning"],
        ];
        return (
          <section key={name} aria-label={ref.label}>
            <h3 className="text-meta text-ink-2">{ref.label}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              {rows.map(([label, v, tone]) => (
                <div key={label}>
                  <dt className="text-[11px] text-ink-3">{label}</dt>
                  <dd className={cn("text-body tabular", v == null ? "text-ink-3" : tone ?? "text-ink")}>{money(v ?? null, ref.unit)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      {n?.next_action && (
        <section aria-label="Next step">
          <h3 className="text-meta text-ink-2">Agent&apos;s next step</h3>
          <p className="mt-1 text-body text-ink">{n.next_action}</p>
        </section>
      )}
      {n && n.agreements.length > 0 && (
        <section aria-label="Agreed">
          <h3 className="text-meta text-ink-2">Agreed</h3>
          <ul className="mt-1 space-y-1">
            {n.agreements.map((a, i) => (
              <li key={i} className="text-body text-success">
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}
      {n && n.objections.length > 0 && (
        <section aria-label="Objections">
          <h3 className="text-meta text-ink-2">Objections raised</h3>
          <ul className="mt-1 space-y-1">
            {n.objections.slice(-4).map((a, i) => (
              <li key={i} className="text-meta text-ink-2">
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
