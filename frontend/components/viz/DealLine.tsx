"use client";

import { motion, useReducedMotion } from "motion/react";
import type { MissionSpec, NegotiationState, Offer, Quantity } from "@/types/api";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DealPoint {
  side: "agent" | "them";
  amount: number;
}

export interface Deal {
  label: string;
  unit: string;
  target?: Quantity;
  limit?: Quantity;
  offers: DealPoint[];
  agreed?: number | null;
}

function matches(o: Offer, name: string) {
  return o.amount != null && (o.quantity_name == null || o.quantity_name === name);
}

/** The first numeric quantity of a mission, with the offers made on it so far. */
export function dealFrom(
  spec: MissionSpec,
  n?: Pick<NegotiationState, "offers_made" | "offers_received"> | null,
  agreed?: number | null,
): Deal | null {
  const ref = spec.targets[0] ?? spec.hard_limits[0];
  if (!ref) return null;
  const target = spec.targets.find((t) => t.name === ref.name) ?? spec.targets[0];
  const limit = spec.hard_limits.find((l) => l.name === ref.name) ?? spec.hard_limits[0];
  const offers: (DealPoint & { turn: number })[] = n
    ? [
        ...n.offers_made.filter((o) => matches(o, ref.name)).map((o) => ({ side: "agent" as const, amount: o.amount!, turn: o.turn })),
        ...n.offers_received.filter((o) => matches(o, ref.name)).map((o) => ({ side: "them" as const, amount: o.amount!, turn: o.turn })),
      ].sort((a, b) => a.turn - b.turn)
    : [];
  return { label: ref.label, unit: ref.unit, target, limit, offers, agreed };
}

function short(v: number, unit: string) {
  if ((unit === "INR" || unit === "₹") && Math.abs(v) >= 1000) {
    const k = v / 1000;
    return "₹" + (Number.isInteger(k) ? k : k.toFixed(1)) + "k";
  }
  return money(v, unit);
}

function lean(self: Quantity, other: Quantity | undefined, x: (v: number) => number) {
  if (!other || Math.abs(x(self.value) - x(other.value)) > 18) return "-translate-x-1/2";
  return x(self.value) <= x(other.value) ? "-translate-x-full pr-1.5" : "pl-1.5";
}

/**
 * A negotiation drawn as one line: your aim (ring), your hard limit (bar, with the
 * no-go side shaded), offers as dots (cool = the agent, warm = them) and, at the end,
 * where it landed. Numbers appear only where they matter.
 */
export function DealLine({ deal, play = false, className }: { deal: Deal; play?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const { target, limit, offers, agreed, unit } = deal;
  const values = [target?.value, limit?.value, ...offers.map((o) => o.amount), agreed ?? undefined].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (!values.length) return null;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) * 0.2 || 1;
  lo -= span * 0.18;
  hi += span * 0.18;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;

  const lastAgent = [...offers].reverse().find((o) => o.side === "agent");
  const lastThem = [...offers].reverse().find((o) => o.side === "them");
  const anim = play && !reduce;
  const step = 0.14;

  const summary = [
    target && `aim ${money(target.value, unit)}`,
    limit && `limit ${money(limit.value, unit)}`,
    lastThem && `their last ${money(lastThem.amount, unit)}`,
    lastAgent && `our last ${money(lastAgent.amount, unit)}`,
    agreed != null && `agreed ${money(agreed, unit)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className={cn("relative select-none", className)} role="img" aria-label={`${deal.label}: ${summary}`}>
      {/* Values riding above the line: only the latest from each side, and the result. */}
      <div className="relative h-5 text-[12px] tabular">
        {lastThem && agreed == null && (
          <span className="absolute -translate-x-1/2 text-ember transition-[left] duration-700" style={{ left: `${x(lastThem.amount)}%` }}>
            {short(lastThem.amount, unit)}
          </span>
        )}
        {lastAgent && agreed == null && Math.abs(x(lastAgent.amount) - (lastThem ? x(lastThem.amount) : -99)) > 12 && (
          <span className="absolute -translate-x-1/2 text-aurora transition-[left] duration-700" style={{ left: `${x(lastAgent.amount)}%` }}>
            {short(lastAgent.amount, unit)}
          </span>
        )}
        {agreed != null && (
          <motion.span
            className="absolute -translate-x-1/2 font-medium text-success"
            style={{ left: `${x(agreed)}%` }}
            initial={anim ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (offers.length + 1) * step, duration: 0.4 }}
          >
            {short(agreed, unit)}
          </motion.span>
        )}
      </div>

      <div className="relative h-6">
        {/* the no-go side of the limit */}
        {limit && (
          <div
            className="absolute inset-y-1.5 rounded-sm opacity-60"
            style={{
              left: limit.direction === "max" ? `${x(limit.value)}%` : 0,
              right: limit.direction === "max" ? 0 : `${100 - x(limit.value)}%`,
              background: "repeating-linear-gradient(135deg, rgb(240 124 134 / 0.28) 0 2px, transparent 2px 7px)",
            }}
          />
        )}
        <motion.div
          className="absolute inset-x-0 top-1/2 h-px origin-left bg-line"
          initial={anim ? { scaleX: 0 } : false}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
        />
        {limit && <span className="absolute top-0.5 h-5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${x(limit.value)}%` }} />}
        {target && (
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-aurora bg-bg"
            style={{ left: `${x(target.value)}%` }}
          />
        )}
        {offers.map((o, i) => {
          const latest = o === lastAgent || o === lastThem;
          return (
            <motion.span
              key={i}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                o.side === "agent" ? "bg-aurora" : "bg-ember",
                latest ? "size-2.5" : "size-1.5 opacity-45",
              )}
              style={{ left: `${x(o.amount)}%` }}
              initial={anim ? { opacity: 0, scale: 0 } : { opacity: 0 }}
              animate={{ opacity: latest ? 1 : 0.45, scale: 1 }}
              transition={{ delay: anim ? 0.5 + i * step : 0, duration: 0.3 }}
            />
          );
        })}
        {agreed != null && (
          <motion.span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-success shadow-[0_0_16px_rgb(126_215_174/0.6)]"
            style={{ left: `${x(agreed)}%` }}
            initial={anim ? { opacity: 0, scale: 0.2 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + (offers.length + 1) * step, type: "spring", stiffness: 260, damping: 18 }}
          />
        )}
      </div>

      {/* Your two reference points. When they sit close, they lean away from each other. */}
      <div className="relative mt-1 h-5 text-[12px] tabular">
        {target && (
          <span
            className={cn("absolute whitespace-nowrap text-ink-2", lean(target, limit, x))}
            style={{ left: `${x(target.value)}%` }}
          >
            {short(target.value, unit)} <span className="text-ink-3">aim</span>
          </span>
        )}
        {limit && (
          <span className={cn("absolute whitespace-nowrap text-ink-2", lean(limit, target, x))} style={{ left: `${x(limit.value)}%` }}>
            {short(limit.value, unit)} <span className="text-ink-3">limit</span>
          </span>
        )}
      </div>
    </div>
  );
}
