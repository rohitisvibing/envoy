"use client";

/**
 * One AudioContext for the workspace: gapless PCM playback (agent and simulated
 * counterparty voices), microphone capture as 16 kHz PCM16, and a single
 * `levelRef` the orb reads every frame.
 *
 * Mobile browsers only allow audio after a user gesture, so `unlock()` must be
 * called from a tap (the Start button).
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Turn = { sources: Set<AudioBufferSourceNode>; ended: boolean; onDone?: () => void };
/** Playback timeline per turn, in AudioContext seconds. Kept after playback for the transcript. */
type Timeline = { start: number; end: number; ended: boolean; stoppedAt?: number };

function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export type MicStatus = "off" | "requesting" | "on" | "denied" | "error";

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const outRef = useRef<AnalyserNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextTimeRef = useRef(0);
  const turnsRef = useRef<Map<string, Turn>>(new Map());
  const timelineRef = useRef<Map<string, Timeline>>(new Map());
  const levelRef = useRef(0);
  const playingRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micMutedRef = useRef(false);
  const [unlocked, setUnlocked] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const [speakingTurn, setSpeakingTurn] = useState<string | null>(null);

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      outRef.current = analyser;
    }
    return ctxRef.current;
  }, []);

  /** Call from a user gesture. Resumes (or creates) the AudioContext. */
  const unlock = useCallback(async () => {
    const ctx = ensure();
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    // Play one silent sample: iOS Safari needs actual output to fully unlock.
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start();
    setUnlocked(ctx.state === "running");
    return ctx.state === "running";
  }, [ensure]);

  // Level loop: playback level while audio plays, otherwise microphone level.
  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(1024);
    const loop = () => {
      const ctx = ctxRef.current;
      let level = 0;
      if (ctx && outRef.current && playingRef.current) level = rms(outRef.current, buf) * 4.2;
      else if (micAnalyserRef.current && !micMutedRef.current) level = rms(micAnalyserRef.current, buf) * 6;
      levelRef.current = Math.min(1, level);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const finishIfDrained = useCallback((turnId: string) => {
    const turn = turnsRef.current.get(turnId);
    if (!turn || !turn.ended || turn.sources.size > 0) return;
    turnsRef.current.delete(turnId);
    turn.onDone?.();
    if (turnsRef.current.size === 0) {
      playingRef.current = false;
      setSpeakingTurn(null);
    }
  }, []);

  /** Queue a base64 PCM16 chunk for a turn. */
  const enqueue = useCallback(
    (turnId: string, b64: string, sampleRate: number) => {
      const ctx = ensure();
      const bin = atob(b64);
      const len = bin.length >> 1;
      if (!len) return;
      const buffer = ctx.createBuffer(1, len, sampleRate);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        ch[i] = v / 0x8000;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(outRef.current!);
      const startAt = Math.max(ctx.currentTime + 0.03, nextTimeRef.current);
      src.start(startAt);
      nextTimeRef.current = startAt + buffer.duration;
      const tl = timelineRef.current.get(turnId);
      if (!tl) timelineRef.current.set(turnId, { start: startAt, end: startAt + buffer.duration, ended: false });
      else tl.end = startAt + buffer.duration;
      let turn = turnsRef.current.get(turnId);
      if (!turn) {
        turn = { sources: new Set(), ended: false };
        turnsRef.current.set(turnId, turn);
      }
      turn.sources.add(src);
      playingRef.current = true;
      setSpeakingTurn(turnId);
      src.onended = () => {
        turn!.sources.delete(src);
        finishIfDrained(turnId);
      };
    },
    [ensure, finishIfDrained],
  );

  /** Mark a turn complete; `onDone` fires once its audio has finished playing. */
  const endTurn = useCallback(
    (turnId: string, onDone: () => void) => {
      const tl = timelineRef.current.get(turnId);
      if (tl) tl.ended = true;
      const turn = turnsRef.current.get(turnId);
      if (!turn) {
        onDone();
        return;
      }
      turn.ended = true;
      turn.onDone = onDone;
      finishIfDrained(turnId);
    },
    [finishIfDrained],
  );

  /** Stop playback immediately (barge-in, interrupt, pause). */
  const stopAll = useCallback(() => {
    const now = ctxRef.current?.currentTime ?? 0;
    for (const tl of timelineRef.current.values()) if (tl.stoppedAt == null && now < tl.end) tl.stoppedAt = now;
    for (const turn of turnsRef.current.values()) {
      for (const s of turn.sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    turnsRef.current.clear();
    nextTimeRef.current = 0;
    playingRef.current = false;
    setSpeakingTurn(null);
  }, []);

  /**
   * How much of a turn's audio has been heard, 0..1, or null if no audio arrived for it.
   * Before the turn's audio is complete, total length is estimated from the text.
   */
  const progress = useCallback((turnId: string, textLength: number): number | null => {
    const tl = timelineRef.current.get(turnId);
    const ctx = ctxRef.current;
    if (!tl || !ctx) return null;
    const now = tl.stoppedAt ?? ctx.currentTime;
    const known = tl.end - tl.start;
    const total = tl.ended ? known : Math.max(known, textLength * 0.065);
    if (total <= 0) return 1;
    return Math.min(1, Math.max(0, (now - tl.start) / total));
  }, []);

  const startMic = useCallback(
    async (onFrame: (pcm: ArrayBuffer) => void) => {
      if (micStreamRef.current) return true;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicStatus("error");
        return false;
      }
      setMicStatus("requesting");
      try {
        const ctx = ensure();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (!micMutedRef.current) onFrame(e.data);
        };
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(node);
        source.connect(analyser);
        micStreamRef.current = stream;
        workletRef.current = node;
        micAnalyserRef.current = analyser;
        setMicStatus("on");
        return true;
      } catch (err) {
        setMicStatus((err as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
        return false;
      }
    },
    [ensure],
  );

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    workletRef.current?.disconnect();
    micStreamRef.current = null;
    workletRef.current = null;
    micAnalyserRef.current = null;
    setMicStatus("off");
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    micMutedRef.current = muted;
    micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, []);

  useEffect(
    () => () => {
      stopAll();
      stopMic();
      ctxRef.current?.close().catch(() => undefined);
    },
    [stopAll, stopMic],
  );

  return { unlock, unlocked, enqueue, endTurn, stopAll, progress, levelRef, speakingTurn, startMic, stopMic, setMicMuted, micStatus };
}
