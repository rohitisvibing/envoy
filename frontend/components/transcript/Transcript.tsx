"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ShieldAlert } from "lucide-react";
import type { TranscriptEvent } from "@/types/api";
import type { Partial } from "@/hooks/useConversation";
import { clock } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPEAKER: Record<string, string> = { agent: "Agent", counterparty: "Them", user: "You", system: "" };

const Row = memo(function Row({ e, counterpartyLabel }: { e: TranscriptEvent; counterpartyLabel: string }) {
  const meta = (
    <span className="flex gap-2 text-[11px] text-ink-3 tabular">
      <time dateTime={e.ts}>{clock(e.ts)}</time>
      {e.language && <span>{e.language}</span>}
      {e.source === "voice" && <span>voice</span>}
      {Boolean(e.meta?.interrupted) && <span className="text-warning">cut off</span>}
    </span>
  );

  if (e.kind === "event")
    return (
      <li className="flex items-center gap-3 py-1.5 text-[12px] text-ink-3">
        <span className="h-px flex-1 bg-line/70" aria-hidden />
        <span className="max-w-[80%] text-center">{e.text}</span>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </li>
    );

  if (e.kind === "approval")
    return (
      <li className="py-1.5">
        <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-meta", e.speaker === "user" ? "border-line text-ink-2" : "border-warning/35 bg-warning/8 text-ink")}>
          <ShieldAlert className={cn("mt-0.5 size-3.5 shrink-0", e.speaker === "user" ? "text-ink-3" : "text-warning")} />
          <span className="min-w-0 break-words">{e.text}</span>
        </div>
      </li>
    );

  if (e.kind === "instruction")
    return (
      <li className="flex justify-end py-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-elevated px-3.5 py-2 ring-1 ring-line">
          <span className="block text-[11px] text-ink-2">You told the agent</span>
          <p className="mt-0.5 break-words text-body text-ink">{e.text}</p>
        </div>
      </li>
    );

  const isAgent = e.speaker === "agent";
  const isYou = e.speaker === "user";
  return (
    <li className="py-2">
      <div className={cn("border-l-2 pl-3", isAgent ? "border-violet" : isYou ? "border-ink-2" : "border-transparent")}>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-meta font-medium", isAgent ? "text-violet" : "text-ink-2")}>
            {e.speaker === "counterparty" ? counterpartyLabel : SPEAKER[e.speaker]}
          </span>
          {meta}
        </div>
        <p className="mt-0.5 break-words text-lead leading-relaxed text-ink">
          {e.text}
        </p>
      </div>
    </li>
  );
});

export function Transcript({
  events,
  partials,
  counterpartyLabel,
  className,
}: {
  events: TranscriptEvent[];
  partials: Partial[];
  counterpartyLabel: string;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const count = events.length + partials.length + partials.reduce((n, p) => n + p.text.length, 0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [count, pinned]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-1" aria-live="polite" aria-relevant="additions" role="log" aria-label="Live transcript">
        {events.length === 0 && partials.length === 0 ? (
          <p className="py-6 text-center text-meta text-ink-3">The transcript appears here as the conversation happens.</p>
        ) : (
          <ul className="pb-2">
            {events.map((e) => (
              <Row key={e.id} e={e} counterpartyLabel={counterpartyLabel} />
            ))}
            {partials.map((p) => (
              <li key={p.id} className="py-2">
                <div className="border-l-2 border-transparent pl-3">
                  <span className="text-meta font-medium text-ink-2">{counterpartyLabel}</span>
                  <p className="mt-0.5 break-words text-lead leading-relaxed text-ink-2 italic">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-elevated px-3 py-1.5 text-[12px] text-ink ring-1 ring-line"
        >
          <ArrowDown className="size-3.5" /> Latest
        </button>
      )}
    </div>
  );
}
