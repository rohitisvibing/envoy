"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Hand,
  Keyboard,
  ListChecks,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Send,
  ShieldAlert,
  Square,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useConversation } from "@/hooks/useConversation";
import { useWakeLock } from "@/hooks/useWakeLock";
import type { ConversationState } from "@/types/api";
import { STATE_LABEL } from "@/lib/format";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { Transcript } from "@/components/transcript/Transcript";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ApprovalSheet } from "./ApprovalSheet";
import { MissionStatePanel } from "./MissionStatePanel";

const LIVE: ConversationState[] = ["connecting", "listening", "thinking", "speaking", "interrupted"];

function statusLine(state: ConversationState, mode: string | undefined, takeover: boolean, cpLabel: string): string {
  if (takeover) return "You're speaking through the agent. It won't reply on its own.";
  switch (state) {
    case "ready":
      return "Press Start when you're ready. The agent speaks first.";
    case "connecting":
      return "Getting ready to speak…";
    case "listening":
      return mode === "live" ? `Listening to the ${cpLabel.toLowerCase()}…` : `The ${cpLabel.toLowerCase()} is responding…`;
    case "thinking":
      return "Working out what to say next…";
    case "speaking":
      return "Speaking. Tap interrupt to cut in.";
    case "interrupted":
      return "Interrupted. Listening.";
    case "paused":
      return "Paused. Nothing is said until you resume.";
    case "awaiting_approval":
      return "Waiting for your decision.";
    case "completed":
      return "Conversation finished.";
    case "failed":
      return "The conversation stopped because of an error.";
    default:
      return "";
  }
}

function Control({
  label,
  onClick,
  icon: Icon,
  active,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Mic;
  active?: boolean;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] text-ink-2 transition-colors disabled:opacity-35 sm:min-h-16 sm:flex-none sm:px-4",
              "hover:bg-elevated hover:text-ink",
              active && "bg-elevated text-ink ring-1 ring-line",
              tone === "danger" && "text-error hover:bg-error/10 hover:text-error",
            )}
          />
        }
      >
        <Icon className="size-5" />
        <span className="leading-none">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const audio = useAudioEngine();
  const { view, send, sendAudio, dismissError } = useConversation(id, {
    onAudio: (turn, b64, rate) => audio.enqueue(turn, b64, rate),
    onAudioEnd: (turn) => audio.endTurn(turn, () => send({ type: "playback_done", turn_id: turn })),
    onAudioStop: () => audio.stopAll(),
  });
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"instruct" | "counterparty">("instruct");
  const [approvalOpen, setApprovalOpen] = useState(true);
  const [stateOpen, setStateOpen] = useState(false);
  const [backgroundPaused, setBackgroundPaused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { state, takeover, paused, muted } = view;
  const mode = view.conversation?.mode;
  const live = LIVE.includes(state);
  const finished = state === "completed" || state === "failed";
  const started = view.events.some((e) => e.kind === "speech");
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

  const start = async () => {
    await audio.unlock();
    await ensureMic();
    send({ type: started ? "resume" : "start" });
  };
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
  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    await audio.unlock();
    if (takeover) send({ type: "say", text: t });
    else if (inputMode === "counterparty") send({ type: "counterparty_text", text: t });
    else send({ type: "intervene", text: t });
    setText("");
  };

  useEffect(() => {
    if (view.report) {
      const t = setTimeout(() => router.prefetch(`/conversations/${id}/report`), 0);
      return () => clearTimeout(t);
    }
  }, [view.report, router, id]);

  const placeholder = takeover
    ? "Type what you want to say. The agent's voice speaks it."
    : inputMode === "counterparty"
      ? `Type what the ${cpLabel.toLowerCase()} said`
      : "Tell the agent what to do";

  const spec = view.mission?.spec;

  const controls = (
      <div className="flex items-stretch justify-between gap-1 py-1.5 sm:justify-center sm:gap-2" role="toolbar" aria-label="Conversation controls">
        {mode === "live" && view.voice && (
          <Control label={muted ? "Unmute" : "Mute"} icon={muted ? MicOff : Mic} active={muted} onClick={toggleMute} />
        )}
        {paused ? (
          <Control label="Resume" icon={Play} onClick={resume} disabled={takeover} />
        ) : (
          <Control label="Pause" icon={Pause} onClick={pause} disabled={takeover || state === "connecting"} />
        )}
        <Control label="Interrupt" icon={Square} onClick={interrupt} disabled={state !== "speaking"} />
        <Control label="Type" icon={Keyboard} onClick={() => inputRef.current?.focus()} />
        <Control label={takeover ? "Hand back" : "Take over"} icon={takeover ? UserRoundCheck : Hand} active={takeover} onClick={toggleTakeover} />
        <Control label="End" icon={PhoneOff} tone="danger" onClick={end} />
      </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line/70 px-2 sm:px-4">
        <Button variant="ghost" size="icon" aria-label="Back to missions" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">{view.mission?.title ?? "Conversation"}</p>
          <p className="flex items-center gap-2 text-[12px] text-ink-2">
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-violet" : state === "awaiting_approval" ? "bg-warning" : state === "completed" ? "bg-success" : state === "failed" ? "bg-error" : "bg-ink-3",
              )}
              aria-hidden
            />
            <span>{takeover ? "You have control" : STATE_LABEL[state]}</span>
            <span className="text-ink-3">{mode === "simulated" ? "Practice" : mode === "live" ? "Live voice" : ""}</span>
            {view.demo && <span className="text-warning">Demo AI</span>}
            {!view.voice && view.hydrated && <span className="text-ink-3">Text only</span>}
          </p>
        </div>
        {view.socket !== "open" && (
          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning" role="status">
            {view.socket === "reconnecting" ? "Reconnecting…" : view.socket === "closed" ? "Disconnected" : "Connecting…"}
          </span>
        )}
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Mission state" onClick={() => setStateOpen(true)}>
          <ListChecks className="size-5" />
        </Button>
      </header>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-1">
        <aside className="hidden overflow-y-auto border-r border-line/70 p-5 lg:block" aria-label="Mission state">
          {spec && <MissionStatePanel spec={spec} n={view.negotiation} />}
        </aside>

        {/* Orb stage */}
        <section className="flex flex-col items-center justify-center px-4 pt-3 lg:pt-0" aria-label="Agent">
          <div className="relative aspect-square w-[min(58vw,15rem)] sm:w-[min(40vh,18rem)] lg:w-[min(52vh,26rem)]">
            <AgentOrb state={takeover ? "paused" : state} levelRef={audio.levelRef} />
          </div>
          <p className="mt-1 min-h-10 max-w-[34ch] text-center text-body text-ink-2" aria-live="polite">
            {statusLine(state, mode, takeover, cpLabel)}
          </p>
          {audio.micStatus === "denied" && (
            <p className="mt-1 text-center text-meta text-error">Microphone blocked. Allow it in your browser settings, or type what they say.</p>
          )}
          {/* Desktop controls sit under the orb */}
          <div className="mt-4 hidden lg:block">{!finished && started && controls}</div>
        </section>

        {/* Transcript + input */}
        <section className="flex min-h-0 flex-col border-line/70 lg:border-l" aria-label="Transcript">
          <Transcript events={view.events} partials={view.partials} counterpartyLabel={cpLabel} className="flex-1 px-3 sm:px-5" />
          {!finished && started && (
            <form
              className="shrink-0 border-t border-line/70 px-3 py-2 sm:px-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {mode === "live" && !takeover && (
                <div className="mb-1.5 flex gap-1" role="radiogroup" aria-label="Who is typing">
                  {(["instruct", "counterparty"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={inputMode === m}
                      onClick={() => setInputMode(m)}
                      className={cn("min-h-8 rounded-full px-3 text-[12px] text-ink-2", inputMode === m && "bg-elevated text-ink ring-1 ring-line")}
                    >
                      {m === "instruct" ? "Instruct agent" : `${cpLabel} said`}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <label htmlFor="intervene" className="sr-only">
                  {placeholder}
                </label>
                <textarea
                  id="intervene"
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={placeholder}
                  className={cn(
                    "max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-3 focus:border-violet/60 focus:outline-none",
                    takeover && "border-ink-2/60",
                  )}
                />
                <Button type="submit" size="icon" className="size-11 shrink-0 rounded-xl" disabled={!text.trim()} aria-label="Send">
                  <Send className="size-4" />
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>

      {/* Mobile controls: fixed to the bottom */}
      {!finished && started && (
        <div className="shrink-0 border-t border-line/70 bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {controls}
        </div>
      )}

      {/* Start / resume / finished overlays */}
      <AnimatePresence>
        {view.hydrated && !finished && (!started || (paused && !takeover && !pending)) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-10"
          >
            <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-line bg-elevated p-4 shadow-2xl shadow-black/50">
              {!started ? (
                <>
                  <p className="text-body text-ink">
                    {mode === "live"
                      ? "The agent will introduce itself as an AI and use your microphone to listen."
                      : `The agent will open the conversation with a simulated ${cpLabel.toLowerCase()}.`}
                  </p>
                  <Button size="lg" className="mt-3 w-full" onClick={start} disabled={view.socket !== "open"}>
                    <Play className="size-4" /> Start conversation
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-body text-ink">
                    {backgroundPaused ? "Paused while the app was in the background." : "The agent is paused."}
                  </p>
                  <Button size="lg" className="mt-3 w-full" onClick={resume} disabled={view.socket !== "open"}>
                    <Play className="size-4" /> Resume
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        )}
        {finished && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="w-full max-w-sm rounded-2xl border border-line bg-elevated p-4 shadow-2xl shadow-black/50">
              <p className="text-body text-ink">{view.report ? "The outcome report is ready." : "Writing the outcome report…"}</p>
              <Button size="lg" className="mt-3 w-full" disabled={!view.report && view.reportPending} nativeButton={false} render={<Link href={`/conversations/${id}/report`} />}>
                View outcome report
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Errors */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-4">
        {view.errors.map((e) => (
          <div key={e.id} role="alert" className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl border border-error/40 bg-elevated px-3.5 py-2.5 text-meta text-ink shadow-xl">
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
          className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-sm items-center justify-center gap-2 rounded-2xl border border-warning/50 bg-elevated px-4 py-3 text-body text-warning shadow-xl lg:bottom-8"
        >
          <ShieldAlert className="size-4" /> Your decision is needed
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
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-3xl border-line bg-elevated px-5 pb-8 pt-6">
          <SheetTitle className="text-lead font-medium">Mission state</SheetTitle>
          {spec && <MissionStatePanel spec={spec} n={view.negotiation} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
