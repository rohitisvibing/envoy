"use client";

import type { MissionSpec, NegotiationState } from "@/types/api";
import { cn } from "@/lib/utils";

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-meta text-ink-3">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** What the agent is working towards, and what has moved. Numbers live on the deal line. */
export function MissionStatePanel({ spec, n, className }: { spec: MissionSpec; n: NegotiationState | null; className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <p className="text-body text-ink">{spec.objective}</p>
      {n?.next_action && (
        <Part title="Next">
          <p className="text-body text-ink-2">{n.next_action}</p>
        </Part>
      )}
      {n && n.agreements.length > 0 && (
        <Part title="Agreed">
          <ul className="space-y-1">
            {n.agreements.map((a, i) => (
              <li key={i} className="text-body text-success">
                {a}
              </li>
            ))}
          </ul>
        </Part>
      )}
      {n && n.objections.length > 0 && (
        <Part title="Pushback">
          <ul className="space-y-1">
            {n.objections.slice(-4).map((a, i) => (
              <li key={i} className="text-body text-ember/90">
                {a}
              </li>
            ))}
          </ul>
        </Part>
      )}
    </div>
  );
}
