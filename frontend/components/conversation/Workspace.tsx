"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUp,
  Hand,
  Languages,
  ListChecks,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Square,
  UserRoundCheck,
  X,
  Zap,
} from "lucide-react";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useConversation } from "@/hooks/useConversation";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import type { ConversationState, TranscriptEvent } from "@/types/api";
import { makeProgress } from "@/hooks/useSpokenProgress";
import { STATE_LABEL } from "@/lib/format";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { AmbientGlow } from "@/components/shell/AmbientGlow";
import { Transcript, type Activity } from "@/components/transcript/Transcript";
import { DealLine, dealFrom } from "@/components/viz/DealLine";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ApprovalSheet } from "./ApprovalSheet";
import { MissionStatePanel } from "./MissionStatePanel";

const QUICK_NUDGES = ["Be firmer", "Slow down", "Wrap up politely"];

const LIVE: ConversationState[] = ["connecting", "listening", "thinking", "speaking", "interrupted"];

const DOT: Partial<Record<ConversationState, string>> = {
  awaiting_approval: "bg-warning",
  completed: "bg-success",
  failed: "bg-error",
  paused: "bg-ink-3",
  ready: "bg-ink-3",
  idle: "bg-ink-3",
};

export function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const audio = useAudioEngine();
  const { view, send, sendAudio, dismissError, timingRef } = useConversation(id, {
    onAudio: (turn, b64, rate) => audio.enqueue(turn, b64, rate),
    onAudioEnd: (turn) => audio.endTurn(turn, () => send({ type: "playback_done", turn_id: turn })),
    onAudioStop: () => audio.stopAll(),
  });
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [inputMode, setInputMode] = useState<"instruct" | "counterparty">("instruct");
  const [approvalOpen, setApprovalOpen] = useState(true);
  const [stateOpen, setStateOpen] = useState(false);
  const [backgroundPaused, setBackgroundPaused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [english, setEnglish] = useStoredFlag("envoy.english", true);

  const { state, takeover, paused, muted } = view;
  const mode = view.conversation?.mode;
  const live = LIVE.includes(state);
  const finished = state === "completed" || state === "failed";
  const started = view.events.some((e) => e.kind === "speech");
  const begun = started || !["ready", "idle"].includes(state);
  const cpLabel = view.mission?.spec.counterparty.type
    ? view.mission.spec.counterparty.type.replace(/^\w/, (c) => c.toUpperCase())
    : "Them";
  const pending = useMemo(() => view.approvals.find((a) => a.status === "pending") ?? null, [view.approvals]);

  useWakeLock(live);

  // A new approval request always surfaces the sheet.
  const [seenApproval, setSeenApproval] = useState<string | null>(null);
  if (pending && pending.id !== seenApproval) {
    setSeenApproval(pending.id);
    setApprovalOpen(true);
  }

  // Background tabs on mobile lose audio: pause the agent and say so on return.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && LIVE.includes(state)) {
        audio.stopAll();
        if (send({ type: "pause" })) setBackgroundPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state, send, audio]);

  // Live mode: keep the microphone running while the conversation is active.
  const ensureMic = useCallback(async () => {
    if (mode !== "live" || !view.voice) return;
    await audio.startMic((pcm) => sendAudio(pcm));
  }, [mode, view.voice, audio, sendAudio]);

  useEffect(() => {
    if (finished) audio.stopMic();
  }, [finished, audio]);

  const start = useCallback(async () => {
    await audio.unlock();
    await ensureMic();
    send({ type: started ? "resume" : "start" });
  }, [audio, ensureMic, send, started]);

  // Arriving from Start on the prepare screen: begin as soon as the line is open. If the
  // browser won't play audio without a fresh tap, the Start button stays up instead.
  const autostart = params.get("autostart") === "1";
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autostart || autoDone.current || !view.hydrated || view.socket !== "open" || begun || finished) return;
    autoDone.current = true;
    router.replace(`/conversations/${id}`, { scroll: false });
    (async () => {
      const ok = await audio.unlock();
      if (!ok && view.voice) return;
      await ensureMic();
      send({ type: "start" });
    })();
  }, [autostart, view.hydrated, view.socket, view.voice, begun, finished, audio, ensureMic, send, router, id]);

  const resume = async () => {
    setBackgroundPaused(false);
    await audio.unlock();
    await ensureMic();
    send({ type: "resume" });
  };
  const pause = () => {
    audio.stopAll();
    send({ type: "pause" });
  };
  const interrupt = () => {
    audio.stopAll();
    send({ type: "interrupt" });
  };
  const toggleMute = () => {
    audio.setMicMuted(!muted);
    send({ type: muted ? "unmute" : "mute" });
  };
  const toggleTakeover = async () => {
    await audio.unlock();
    if (takeover) send({ type: "release" });
    else {
      audio.stopAll();
      send({ type: "takeover" });
      inputRef.current?.focus();
    }
  };
  const end = () => {
    audio.stopAll();
    audio.stopMic();
    send({ type: "end" });
  };
  const nudge = async (t: string, urgent = false) => {
    await audio.unlock();
    if (urgent) audio.stopAll(); // cut in immediately; the server confirms with audio.stop
    send({ type: "intervene", text: t, urgent });
  };
  const submit = async (urgent = false) => {
    const t = text.trim();
    if (!t) return;
    if (takeover) {
      await audio.unlock();
      send({ type: "say", text: t });
    } else if (inputMode === "counterparty") send({ type: "counterparty_text", text: t });
    else await nudge(t, urgent);
    setText("");
    inputRef.current?.focus(); // keep typing: several nudges in a row is normal
  };

  // Live transcript: lines received during this session reveal as they are spoken.
  const progressFor = useCallback(
    (e: TranscriptEvent) => makeProgress(e, timingRef.current, audio.progress),
    [timingRef, audio.progress],
  );
  const lastSpeech = [...view.events].reverse().find((e) => e.kind === "speech");
  const activity: Activity | null =
    takeover || finished || !started
      ? null
      : state === "thinking"
        ? { label: "Thinking", state: "thinking" }
        : mode === "simulated" && state === "listening" && lastSpeech && lastSpeech.speaker !== "counterparty"
          ? { label: `${cpLabel} is replying`, state: "listening" }
          : null;
  const someoneSpeaking = state === "speaking" || (mode === "simulated" && state === "listening");
  const canNudge = !takeover && inputMode === "instruct";

  useEffect(() => {
    if (view.report) {
      const t = setTimeout(() => router.prefetch(`/conversations/${id}/report`), 0);
      return () => clearTimeout(t);
    }
  }, [view.report, router, id]);

  const placeholder = takeover ? "Say it in the agent's voice…" : inputMode === "counterparty" ? `What ${cpLabel.toLowerCase()} said…` : "Nudge the agent…";

  const hasEnglish = view.events.some((e) => typeof e.meta?.en === "string");
  const spec = view.mission?.spec;
  const deal = spec ? dealFrom(spec, view.negotiation) : null;

  // Words under the orb only when you need to act or know something the orb can't show.
  const notice = takeover
    ? "You're speaking"
    : audio.micStatus === "denied"
      ? "Microphone blocked. Type what they say."
      : state === "awaiting_approval"
        ? "Needs you"
        : paused && begun
          ? backgroundPaused
            ? "Paused in the background"
            : "Paused"
          : null;

  const detail = [takeover ? "You have control" : STATE_LABEL[state], mode === "simulated" ? "practice" : "live", !view.voice && view.hydrated && "text only", view.demo && "demo AI"]
    .filter(Boolean)
    .join(", ");

  const controls = (
    <div className="flex items-center justify-center gap-1.5 py-2 sm:gap-3" role="toolbar" aria-label="Conversation controls">
      {mode === "live" && view.voice && <IconButton label={muted ? "Unmute" : "Mute"} icon={muted ? MicOff : Mic} active={muted} onClick={toggleMute} />}
      {paused ? (
        <IconButton label="Resume" icon={Play} onClick={resume} disabled={takeover} />
      ) : (
        <IconButton label="Pause" icon={Pause} onClick={pause} disabled={takeover || state === "connecting"} />
      )}
      <IconButton label="Interrupt" icon={Square} onClick={interrupt} disabled={state !== "speaking"} />
      <IconButton label={takeover ? "Hand back" : "Take over"} icon={takeover ? UserRoundCheck : Hand} active={takeover} onClick={toggleTakeover} />
      <IconButton label="End" icon={PhoneOff} tone="danger" onClick={end} />
    </div>
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <AmbientGlow state={takeover ? "paused" : state} levelRef={audio.levelRef} />

      {/* Header */}
      <header className="relative z-10 flex h-14 shrink-0 items-center gap-1 px-2 sm:px-4">
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft className="size-5" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-body text-ink">{view.mission?.title ?? ""}</p>
        {view.socket !== "open" ? (
          <span className="px-2 text-meta text-warning" role="status">
            {view.socket === "reconnecting" ? "Reconnecting" : view.socket === "closed" ? "Offline" : "Connecting"}
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} role="status" aria-label={detail} className="grid size-8 place-items-center rounded-full" />}>
              <span className={cn("size-2 rounded-full", DOT[state] ?? "bg-aurora", live && "animate-pulse")} />
            </TooltipTrigger>
            <TooltipContent>{detail}</TooltipContent>
          </Tooltip>
        )}
        {hasEnglish && (
          <IconButton
            label={english ? "Hide English" : "Show English"}
            icon={Languages}
            size="sm"
            active={english}
            onClick={() => setEnglish(!english)}
          />
        )}
        <IconButton label="Mission" icon={ListChecks} size="sm" className="lg:hidden" onClick={() => setStateOpen(true)} />
      </header>

      {/* Body */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-1">
        <aside className="hidden overflow-y-auto px-6 py-4 lg:block" aria-label="Mission">
          {spec && <MissionStatePanel spec={spec} n={view.negotiation} />}
        </aside>

        {/* Orb stage */}
        <section className="flex flex-col items-center justify-center px-6 pt-1 lg:pt-0" aria-label="Agent">
          <div
            className={cn(
              "relative aspect-square transition-[width] duration-700 lg:w-[min(52vh,26rem)]",
              // Once talking starts, the transcript needs the room on small screens.
              started && !finished ? "w-[min(30vw,7.5rem)] sm:w-[min(26vh,13rem)]" : "w-[min(66vw,17rem)] sm:w-[min(42vh,19rem)]",
            )}
          >
            <AgentOrb state={takeover ? "paused" : state} levelRef={audio.levelRef} />
          </div>
          <p
            className={cn("min-h-5 text-center text-meta", state === "awaiting_approval" ? "text-warning" : "text-ink-2")}
            aria-live="polite"
          >
            {notice}
          </p>
          {deal && (deal.offers.length > 0 || !started) && <DealLine deal={deal} className="mt-2 w-full max-w-sm lg:mt-6" />}
          <div className="mt-6 hidden lg:block">{!finished && begun && controls}</div>
        </section>

        {/* Transcript + input */}
        <section className="flex min-h-0 min-w-0 flex-col" aria-label="Transcript">
          <Transcript
            events={view.events}
            partials={view.partials}
            counterpartyLabel={cpLabel}
            progressFor={progressFor}
            activity={activity}
            english={english}
            className={cn("flex-1 px-4 sm:px-6", finished && "pb-24")}
          />
          {!finished && begun && (
            <form
              className="shrink-0 px-3 pb-2 pt-1 sm:px-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <AnimatePresence initial={false}>
                {canNudge && focused && !text && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]"
                    aria-label="Quick nudges"
                  >
                    {QUICK_NUDGES.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => nudge(q)}
                        className="min-h-8 shrink-0 whitespace-nowrap rounded-full bg-surface/80 px-3 text-meta text-ink-2 ring-1 ring-line transition-colors hover:text-ink"
                      >
                        {q}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <div
                className={cn(
                  "flex items-end gap-1 rounded-3xl bg-surface/85 p-1.5 ring-1 ring-line backdrop-blur-md transition-shadow focus-within:ring-aurora/50",
                  takeover && "ring-ink-2/60",
                )}
              >
                {mode === "live" && !takeover && (
                  <button
                    type="button"
                    onClick={() => setInputMode((m) => (m === "instruct" ? "counterparty" : "instruct"))}
                    className={cn(
                      "mb-0.5 ml-0.5 min-h-9 shrink-0 rounded-full px-3 text-meta ring-1 ring-line",
                      inputMode === "counterparty" ? "text-ember" : "text-aurora",
                    )}
                    aria-label={inputMode === "instruct" ? "Typing a nudge. Switch to typing what they said." : "Typing what they said. Switch to nudging the agent."}
                  >
                    {inputMode === "instruct" ? "Nudge" : "They said"}
                  </button>
                )}
                <label htmlFor="intervene" className="sr-only">
                  {placeholder}
                </label>
                <textarea
                  id="intervene"
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={placeholder}
                  className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-body text-ink field-sizing-content placeholder:text-ink-3 focus:outline-none"
                />
                {canNudge && someoneSpeaking && text.trim() && (
                  <IconButton label="Send now: cut in" icon={Zap} className="size-10 text-warning hover:text-warning" onClick={() => submit(true)} />
                )}
                <IconButton label={canNudge ? "Send nudge" : "Send"} icon={ArrowUp} type="submit" tone="accent" className="size-10" disabled={!text.trim()} />
              </div>
            </form>
          )}
        </section>
      </div>

      {/* Mobile controls */}
      {!finished && begun && <div className="relative z-10 shrink-0 pb-[env(safe-area-inset-bottom)] lg:hidden">{controls}</div>}

      {/* Start / resume / outcome */}
      <AnimatePresence>
        {view.hydrated && !finished && (!begun || (paused && !takeover && !pending)) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-12"
          >
            <Button
              size="lg"
              className="pointer-events-auto h-14 rounded-full px-12 text-lead shadow-[0_10px_50px_-10px_rgb(157_176_255/0.7)]"
              onClick={begun ? resume : start}
              disabled={view.socket !== "open"}
            >
              <Play className="size-4" /> {begun ? "Resume" : "Start"}
            </Button>
          </motion.div>
        )}
        {finished && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            <Button
              size="lg"
              className="h-14 rounded-full px-10 text-lead shadow-[0_10px_50px_-10px_rgb(126_215_174/0.6)]"
              disabled={!view.report && view.reportPending}
              nativeButton={false}
              render={<Link href={`/conversations/${id}/report`} />}
            >
              {!view.report && view.reportPending ? "Writing the outcome…" : "See outcome"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Errors */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-4">
        {view.errors.map((e) => (
          <div key={e.id} role="alert" className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl bg-elevated px-3.5 py-2.5 text-meta text-ink shadow-xl ring-1 ring-error/40">
            <span className="min-w-0 flex-1 break-words">{e.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismissError(e.id)} className="text-ink-2 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>

      {pending && !approvalOpen && (
        <button
          type="button"
          onClick={() => setApprovalOpen(true)}
          className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-elevated px-5 py-3 text-body text-warning shadow-xl ring-1 ring-warning/50 lg:bottom-8"
        >
          <span className="size-2 animate-pulse rounded-full bg-warning" aria-hidden /> Needs you
        </button>
      )}

      <ApprovalSheet
        approval={pending}
        open={Boolean(pending) && approvalOpen}
        onOpenChange={setApprovalOpen}
        onDecide={async (decision, alt) => {
          await audio.unlock();
          send({ type: "approval", id: pending!.id, decision, alternative_text: alt });
        }}
      />

      <Sheet open={stateOpen} onOpenChange={setStateOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-3xl border-line bg-surface px-6 pb-10 pt-6">
          <SheetTitle className="sr-only">Mission</SheetTitle>
          {spec && <MissionStatePanel spec={spec} n={view.negotiation} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
