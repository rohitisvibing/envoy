"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ShieldAlert } from "lucide-react";
import type { ConversationState, TranscriptEvent } from "@/types/api";
import type { Partial } from "@/hooks/useConversation";
import type { ProgressFn } from "@/hooks/useSpokenProgress";
import { StatusGlyph } from "@/components/orb/StatusGlyph";
import { clock } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPEAKER: Record<string, string> = { agent: "Agent", counterparty: "Them", user: "You", system: "" };

export interface Activity {
  label: string;
  state: ConversationState;
}

/**
 * A line that is being said right now: words appear as they are spoken. If it was cut
 * off, the unspoken remainder stays visible but dimmed, so you can see what was heard.
 */
function LiveText({ text, progress, interrupted }: { text: string; progress: ProgressFn; interrupted: boolean }) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const wordCount = useMemo(() => tokens.filter((t) => t.trim()).length, [tokens]);
  const [shown, setShown] = useState(() => Math.ceil(progress() * wordCount));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = progress();
      const k = p >= 1 ? wordCount : Math.ceil(p * wordCount);
      setShown((prev) => (prev === k ? prev : k));
      if (p < 1 && !interrupted) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A cut-off line freezes; take one last reading once the stop has propagated.
    const t = interrupted ? setTimeout(tick, 120) : undefined;
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [progress, wordCount, interrupted]);

  if (shown >= wordCount && !interrupted) return <>{text}</>;
  let seen = 0;
  let cut = tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].trim()) seen++;
    if (seen > shown) {
      cut = i;
      break;
    }
  }
  const said = tokens.slice(0, cut).join("");
  const rest = tokens.slice(cut).join("");
  return (
    <>
      {said}
      {interrupted ? (
        rest && <span className="text-ink-3/70 line-through decoration-ink-3/40">{rest}</span>
      ) : (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-violet align-baseline" aria-hidden />
      )}
    </>
  );
}

const NUDGE_STATUS: Record<string, string> = {
  queued: "Queued for the agent's next line",
  applied: "Applied",
  noted: "Noted as guidance",
};

const Row = memo(function Row({
  e,
  counterpartyLabel,
  progressFor,
  highlighted,
  onJump,
}: {
  e: TranscriptEvent;
  counterpartyLabel: string;
  progressFor: (e: TranscriptEvent) => ProgressFn | null;
  highlighted: boolean;
  onJump: (id: string) => void;
}) {
  const interrupted = Boolean(e.meta?.interrupted);
  // Created once per line, so the reveal doesn't restart when the row re-renders.
  const eventId = e.id;
  const isSpeech = e.kind === "speech";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progress = useMemo(() => (isSpeech ? progressFor(e) : null), [eventId, isSpeech, progressFor]);
  const meta = (
    <span className="flex gap-2 text-[11px] text-ink-3 tabular">
      <time dateTime={e.ts}>{clock(e.ts)}</time>
      {e.language && <span>{e.language}</span>}
      {e.source === "voice" && <span>voice</span>}
      {interrupted && <span className="text-warning">cut off</span>}
      {Array.isArray(e.meta?.nudges) && (e.meta.nudges as string[]).length > 0 && <span className="text-violet">follows your nudge</span>}
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

  if (e.kind === "instruction") {
    const status = (e.meta?.status as string | undefined) ?? "applied";
    const appliedIn = e.meta?.applied_in as string | undefined;
    return (
      <li className="flex justify-end py-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-elevated px-3.5 py-2 ring-1 ring-line">
          <span className="block text-[11px] text-ink-2">
            {e.meta?.urgent ? "You cut in" : "You nudged the agent"}
          </span>
          <p className="mt-0.5 break-words text-body text-ink">{e.text}</p>
          <span className={cn("mt-1 flex items-center gap-1.5 text-[11px]", status === "queued" ? "text-ink-3" : status === "applied" ? "text-violet" : "text-ink-2")}>
            {status === "queued" && <span className="size-1.5 animate-pulse rounded-full bg-ink-3" aria-hidden />}
            {NUDGE_STATUS[status] ?? status}
            {status === "applied" && appliedIn && (
              <button type="button" className="underline decoration-violet/40 underline-offset-2 hover:decoration-violet" onClick={() => onJump(appliedIn)}>
                see the line
              </button>
            )}
          </span>
        </div>
      </li>
    );
  }

  const isAgent = e.speaker === "agent";
  const isYou = e.speaker === "user";
  return (
    <li className="py-2" data-event-id={e.id}>
      <div
        className={cn(
          "rounded-r-lg border-l-2 pl-3 transition-colors duration-700",
          isAgent ? "border-violet" : isYou ? "border-ink-2" : "border-transparent",
          highlighted && "bg-violet-soft",
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className={cn("text-meta font-medium", isAgent ? "text-violet" : "text-ink-2")}>
            {e.speaker === "counterparty" ? counterpartyLabel : SPEAKER[e.speaker]}
          </span>
          {meta}
        </div>
        <p className="mt-0.5 break-words text-lead leading-relaxed text-ink">
          {progress ? <LiveText text={e.text} progress={progress} interrupted={interrupted} /> : e.text}
        </p>
      </div>
    </li>
  );
});

export function Transcript({
  events,
  partials,
  counterpartyLabel,
  progressFor,
  activity,
  className,
}: {
  events: TranscriptEvent[];
  partials: Partial[];
  counterpartyLabel: string;
  progressFor: (e: TranscriptEvent) => ProgressFn | null;
  activity: Activity | null;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Stay pinned to the newest line while content grows (new rows, words appearing, partials).
  useEffect(() => {
    const el = scroller.current;
    const content = list.current;
    if (!el || !content) return;
    // Only a scroll *up* by the user unpins. Our own scrolls (and the content growing word by
    // word between a scroll and its event) must not.
    let lastTop = el.scrollTop;
    const stick = () => {
      if (!pinnedRef.current) return;
      el.scrollTop = el.scrollHeight;
      lastTop = el.scrollTop;
    };
    const ro = new ResizeObserver(stick);
    ro.observe(content);
    ro.observe(el);
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      const movedUp = el.scrollTop < lastTop - 4;
      lastTop = el.scrollTop;
      const next = atBottom || (pinnedRef.current && !movedUp);
      if (next !== pinnedRef.current) {
        pinnedRef.current = next;
        setPinned(next);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    stick();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const jump = useCallback((id: string) => {
    const row = scroller.current?.querySelector(`[data-event-id="${id}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
  }, []);

  const empty = events.length === 0 && partials.length === 0 && !activity;

  return (
    <div className={cn("relative min-h-0", className)}>
      <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-1" aria-live="polite" aria-relevant="additions" role="log" aria-label="Live transcript">
        <div ref={list}>
          {empty ? (
            <p className="py-6 text-center text-meta text-ink-3">The transcript appears here as the conversation happens.</p>
          ) : (
            <ul className="pb-2">
              {events.map((e) => (
                <Row key={e.id} e={e} counterpartyLabel={counterpartyLabel} progressFor={progressFor} highlighted={highlight === e.id} onJump={jump} />
              ))}
              {partials.map((p) => (
                <li key={p.id} className="py-2">
                  <div className="border-l-2 border-transparent pl-3">
                    <span className="flex items-baseline gap-2">
                      <span className="text-meta font-medium text-ink-2">{counterpartyLabel}</span>
                      <span className="text-[11px] text-ink-3">speaking…</span>
                    </span>
                    <p className="mt-0.5 break-words text-lead leading-relaxed text-ink-2">{p.text}</p>
                  </div>
                </li>
              ))}
              {activity && partials.length === 0 && (
                <li className="flex items-center gap-2 py-2 pl-3 text-meta text-ink-3" aria-live="off">
                  <StatusGlyph state={activity.state} />
                  {activity.label}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            setPinned(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-elevated px-3 py-1.5 text-[12px] text-ink ring-1 ring-line"
        >
          <ArrowDown className="size-3.5" /> Latest
        </button>
      )}
    </div>
  );
}
