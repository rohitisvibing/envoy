"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Zap } from "lucide-react";
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
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline opacity-70" aria-hidden />
      )}
    </>
  );
}

const Row = memo(function Row({
  e,
  counterpartyLabel,
  progressFor,
  highlighted,
  onJump,
  english,
}: {
  e: TranscriptEvent;
  counterpartyLabel: string;
  progressFor: (e: TranscriptEvent) => ProgressFn | null;
  highlighted: boolean;
  onJump: (id: string) => void;
  english: boolean;
}) {
  const interrupted = Boolean(e.meta?.interrupted);
  // Created once per line, so the reveal doesn't restart when the row re-renders.
  const eventId = e.id;
  const isSpeech = e.kind === "speech";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progress = useMemo(() => (isSpeech ? progressFor(e) : null), [eventId, isSpeech, progressFor]);

  if (e.kind === "event")
    return <li className="py-2 text-center text-[12px] text-ink-3">{e.text}</li>;

  if (e.kind === "approval")
    return (
      <li className={cn("flex items-start gap-2 py-2 text-meta", e.speaker === "user" ? "justify-end text-ink-2" : "text-warning")}>
        {e.speaker !== "user" && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />}
        <span className="line-clamp-2 min-w-0 max-w-[85%] break-words" title={e.text}>{e.text}</span>
      </li>
    );

  if (e.kind === "instruction") {
    const status = (e.meta?.status as string | undefined) ?? "applied";
    const appliedIn = e.meta?.applied_in as string | undefined;
    return (
      <li className="flex justify-end py-1.5">
        <span className="inline-flex max-w-[85%] items-baseline gap-2 rounded-2xl bg-elevated/80 px-3 py-1.5 text-meta ring-1 ring-line">
          <span className="sr-only">{e.meta?.urgent ? "You cut in:" : "Your nudge:"}</span>
          {Boolean(e.meta?.urgent) && <Zap className="size-3 shrink-0 translate-y-0.5 text-warning" aria-hidden />}
          <span className="min-w-0 break-words text-ink">{e.text}</span>
          {status === "queued" && (
            <span className="flex shrink-0 items-center gap-1 text-ink-3">
              <span className="size-1.5 animate-pulse rounded-full bg-ink-3" aria-hidden />
              <span className="sr-only">queued</span>
            </span>
          )}
          {status === "noted" && <span className="shrink-0 text-ink-3">noted</span>}
          {status === "applied" &&
            (appliedIn ? (
              <button type="button" className="shrink-0 text-aurora hover:underline" onClick={() => onJump(appliedIn)} aria-label="Applied. Show the line.">
                used ↗
              </button>
            ) : (
              <span className="shrink-0 text-aurora">used</span>
            ))}
        </span>
      </li>
    );
  }

  const isAgent = e.speaker === "agent";
  const isThem = e.speaker === "counterparty";
  const name = isThem ? counterpartyLabel : SPEAKER[e.speaker];
  const nudged = Array.isArray(e.meta?.nudges) && (e.meta.nudges as string[]).length > 0;
  return (
    <li className={cn("group flex py-2.5", isAgent ? "justify-start" : "justify-end")} data-event-id={e.id}>
      <div
        className={cn(
          "max-w-[88%] py-0.5 transition-colors duration-700",
          isAgent ? "border-l-2 border-aurora/70 pl-3.5 pr-2" : "border-r-2 pl-2 pr-3.5",
          isThem && "border-ember/70",
          !isAgent && !isThem && "border-ink-2/60",
          highlighted && "bg-aurora-soft",
        )}
      >
        <p
          lang={e.language && !/^en/i.test(e.language) ? e.language.slice(0, 2).toLowerCase() : undefined}
          className={cn("break-words text-lead leading-relaxed", isThem ? "text-ember/95" : "text-ink")}
        >
          <span className="sr-only">{name}: </span>
          {progress ? <LiveText text={e.text} progress={progress} interrupted={interrupted} /> : e.text}
        </p>
        {english && typeof e.meta?.en === "string" && (
          <p lang="en" className="mt-1 break-words text-body text-ink-2">
            <span className="sr-only">In English: </span>
            {e.meta.en}
          </p>
        )}
        <span
          className={cn(
            "mt-0.5 flex gap-2 text-[11px] text-ink-3 tabular",
            !isAgent && "justify-end",
            !nudged && "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {nudged && <span className="text-aurora">nudged</span>}
          <time dateTime={e.ts}>{clock(e.ts)}</time>
          {e.language && <span>{e.language}</span>}
        </span>
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
  english = true,
  className,
}: {
  events: TranscriptEvent[];
  partials: Partial[];
  counterpartyLabel: string;
  progressFor: (e: TranscriptEvent) => ProgressFn | null;
  activity: Activity | null;
  english?: boolean;
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
            <p className="sr-only">Nothing said yet.</p>
          ) : (
            <ul className="pb-2">
              {events.map((e) => (
                <Row key={e.id} e={e} counterpartyLabel={counterpartyLabel} progressFor={progressFor} highlighted={highlight === e.id} onJump={jump} english={english} />
              ))}
              {partials.map((p) => (
                <li key={p.id} className="flex justify-end py-2.5">
                  <p className="max-w-[88%] break-words border-r-2 border-ember/40 pl-2 pr-3.5 text-lead leading-relaxed text-ember/60">
                    <span className="sr-only">{counterpartyLabel}, speaking: </span>
                    {p.text}
                  </p>
                </li>
              ))}
              {activity && partials.length === 0 && (
                <li
                  className={cn("flex items-center gap-2 py-2.5 text-meta text-ink-3", activity.state === "thinking" ? "pl-3.5" : "justify-end pr-3.5")}
                  aria-live="off"
                >
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
          className="absolute bottom-2 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full bg-elevated text-ink shadow-lg ring-1 ring-line" aria-label="Jump to latest"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
