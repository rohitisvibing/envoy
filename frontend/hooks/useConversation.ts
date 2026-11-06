"use client";

/**
 * WebSocket client for one conversation. Text and voice share this single
 * connection and the server-side session behind it.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { wsUrl } from "@/services/api";
import type {
  AppErrorPayload,
  Approval,
  Conversation,
  ConversationState,
  MissionSpec,
  NegotiationState,
  OutcomeReport,
  Speaker,
  TranscriptEvent,
} from "@/types/api";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface Partial {
  id: string;
  speaker: Speaker;
  text: string;
  ts: string;
}

export interface ConversationView {
  socket: SocketStatus;
  hydrated: boolean;
  state: ConversationState;
  paused: boolean;
  takeover: boolean;
  muted: boolean;
  voice: boolean;
  demo: boolean;
  conversation: Conversation | null;
  mission: { id: string; title: string; spec: MissionSpec } | null;
  events: TranscriptEvent[];
  partials: Partial[];
  negotiation: NegotiationState | null;
  approvals: Approval[];
  errors: (AppErrorPayload & { id: number })[];
  reportPending: boolean;
  report: OutcomeReport | null;
}

const initial: ConversationView = {
  socket: "connecting",
  hydrated: false,
  state: "ready",
  paused: false,
  takeover: false,
  muted: false,
  voice: false,
  demo: false,
  conversation: null,
  mission: null,
  events: [],
  partials: [],
  negotiation: null,
  approvals: [],
  errors: [],
  reportPending: false,
  report: null,
};

type ServerMsg = { type: string; [k: string]: unknown };
type Action = { type: "socket"; status: SocketStatus } | { type: "msg"; msg: ServerMsg } | { type: "dismiss"; id: number };

let errorSeq = 0;

function upsertApproval(list: Approval[], a: Approval): Approval[] {
  const i = list.findIndex((x) => x.id === a.id);
  if (i === -1) return [...list, a];
  const next = list.slice();
  next[i] = a;
  return next;
}

function reducer(s: ConversationView, action: Action): ConversationView {
  if (action.type === "socket") return { ...s, socket: action.status };
  if (action.type === "dismiss") return { ...s, errors: s.errors.filter((e) => e.id !== action.id) };
  const m = action.msg;
  switch (m.type) {
    case "snapshot":
      return {
        ...s,
        hydrated: true,
        state: m.state as ConversationState,
        paused: Boolean(m.paused),
        takeover: Boolean(m.takeover),
        muted: Boolean(m.muted),
        voice: Boolean(m.voice),
        demo: Boolean(m.demo),
        conversation: m.conversation as Conversation,
        negotiation: (m.conversation as Conversation).negotiation,
        mission: m.mission as ConversationView["mission"],
        events: m.events as TranscriptEvent[],
        approvals: m.approvals as Approval[],
        partials: [],
      };
    case "state":
      return {
        ...s,
        state: m.state as ConversationState,
        paused: Boolean(m.paused),
        takeover: Boolean(m.takeover),
        muted: Boolean(m.muted),
        voice: Boolean(m.voice),
        demo: Boolean(m.demo),
      };
    case "transcript.partial": {
      const id = m.utterance_id as string;
      const others = s.partials.filter((p) => p.id !== id);
      return {
        ...s,
        partials: [...others, { id, speaker: m.speaker as Speaker, text: m.text as string, ts: new Date().toISOString() }],
      };
    }
    case "transcript.final": {
      const ev = m.event as TranscriptEvent;
      if (s.events.some((e) => e.id === ev.id)) return s;
      const uid = ev.meta?.utterance_id as string | undefined;
      return {
        ...s,
        events: [...s.events, ev],
        partials: uid ? s.partials.filter((p) => p.id !== uid) : s.partials,
      };
    }
    case "negotiation_state":
      return { ...s, negotiation: m.negotiation as NegotiationState };
    case "approval.request":
    case "approval.resolved":
      return { ...s, approvals: upsertApproval(s.approvals, m.approval as Approval) };
    case "report.pending":
      return { ...s, reportPending: true };
    case "report.ready":
      return { ...s, reportPending: false, report: m.report as OutcomeReport };
    case "error": {
      const err = m.error as AppErrorPayload;
      const dup = s.errors.find((e) => e.message === err.message);
      if (dup) return s;
      return { ...s, errors: [...s.errors.slice(-2), { ...err, id: ++errorSeq }] };
    }
    default:
      return s;
  }
}

export interface AudioHandlers {
  onAudio?: (turnId: string, b64: string, sampleRate: number, speaker: Speaker) => void;
  onAudioEnd?: (turnId: string) => void;
  onAudioStop?: (turnId: string) => void;
}

export function useConversation(conversationId: string, handlers: AudioHandlers) {
  const [view, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const retryRef = useRef(0);
  const closedByUs = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    closedByUs.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl(`/ws/conversations/${conversationId}`));
      wsRef.current = ws;
      ws.onopen = () => {
        retryRef.current = 0;
        dispatch({ type: "socket", status: "open" });
        ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 20000);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        const msg = JSON.parse(e.data) as ServerMsg;
        const h = handlersRef.current;
        if (msg.type === "audio") {
          h.onAudio?.(msg.turn_id as string, msg.data as string, msg.sample_rate as number, msg.speaker as Speaker);
          return;
        }
        if (msg.type === "audio.end") return h.onAudioEnd?.(msg.turn_id as string);
        if (msg.type === "audio.stop") return h.onAudioStop?.(msg.turn_id as string);
        if (msg.type === "pong") return;
        dispatch({ type: "msg", msg });
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        if (closedByUs.current || e.code === 4404) {
          dispatch({ type: "socket", status: "closed" });
          return;
        }
        dispatch({ type: "socket", status: "reconnecting" });
        const delay = Math.min(8000, 500 * 2 ** retryRef.current++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closedByUs.current = true;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [conversationId]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
  }, []);

  const dismissError = useCallback((id: number) => dispatch({ type: "dismiss", id }), []);

  return { view, send, sendAudio, dismissError };
}
