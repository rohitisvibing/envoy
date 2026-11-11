# Envoy: objective-driven multilingual voice agents

Describe a conversation you want handled ("negotiate my rent from ₹35,000 to ₹30,000, don't go above ₹32,000 without asking me, speak Kannada if he prefers"). Envoy turns the request into a structured mission. You review and edit it, then an agent prepares a strategy and holds the conversation by voice. You can watch, type instructions mid-call, approve or reject commitments, take over, and get an outcome report at the end.

```
Describe → Review mission → Prepare agent → Start → Voice conversation → Intervene / approve → Outcome report
```

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui (Base UI), lucide, Motion, TanStack Query, `thinking-orbs` |
| Backend | Python 3.13, FastAPI, WebSockets, Pydantic v2, httpx |
| LLM | OpenRouter (OpenAI-compatible chat completions, JSON-schema output) |
| Speech | Sarvam Saaras (realtime STT over WebSocket, REST fallback), Sarvam Bulbul (streaming TTS over WebSocket, REST fallback) |
| Data | Supabase / PostgreSQL (migrations in `supabase/`), with an in-memory fallback |

## Quick start

Prerequisites: Node 20+ with pnpm, [uv](https://docs.astral.sh/uv/), Docker (for local Supabase).

```bash
# 1. Configuration
cp .env.example .env                  # fill in OPENROUTER_API_KEY and SARVAM_API_KEY
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > frontend/.env.local

# 2. Database (optional: without it, data lives in memory until restart)
brew install supabase/tap/supabase
supabase start                        # prints the API URL and service_role key
supabase db reset                     # applies migrations + seed (sample profile, templates)
# copy "API URL" -> SUPABASE_URL and "service_role key" -> SUPABASE_SERVICE_ROLE_KEY in .env

# 3. Backend
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 4. Frontend (new terminal)
cd frontend
pnpm install
pnpm dev                              # http://localhost:3000 (use --port N if 3000 is taken,
                                      # and add that origin to CORS_ORIGINS in .env)
```

`GET http://localhost:8000/api/health` shows which providers are live.

### Demo mode

If `OPENROUTER_API_KEY` is empty, or `DEMO_MODE=true`, the backend uses a deterministic **demo LLM**. If `SARVAM_API_KEY` is empty, conversations run in text only. The UI shows a "Demo mode" badge whenever either applies. The demo LLM exists so the flow can be exercised offline: extraction, preparation, a scripted landlord, approvals, and a report. It is not a stand-in for the real model.

## How it works

### Objective engine, not one giant prompt

```
backend/app/
  services/
    objective_engine.py   request -> MissionSpec (targets vs hard limits, approvals, success criteria,
                          missing info, ambiguities, conflicts, clarifying questions) + deterministic checks
    strategy_engine.py    MissionSpec -> PreparationBrief (opening with AI disclosure, tactics, objections)
    context_manager.py    compact, disclosure-filtered context per turn
    conversation_manager  one structured LLM call per agent turn -> TurnPlan (state delta + utterance + flags)
    policy_guard.py       deterministic safety check on every turn before anything is spoken
    approval_manager.py   approval requests and resolutions
    outcome_analyzer.py   report; success judged against criteria and agreed values, not tone
    simulator.py          LLM-played counterparty for practice (never sees your limits)
  realtime/
    session.py            LiveSession: the single shared context for text + voice
    counterparty.py       CounterpartyChannel seam (Simulated, BrowserMic; Telephony later)
    websocket_manager.py  WS protocol
  providers/              llm/, stt/, tts/ behind interfaces (OpenRouter, Sarvam, demo)
  repositories/           Supabase + in-memory implementations of one interface
```

**Per-turn flow:** the counterparty speaks (STT final, typed text, or simulator). The context manager builds the context: mission, filtered profile, negotiation state, principal instructions and recent transcript. The LLM returns a `TurnPlan`, and its `state_delta` is merged into `NegotiationState` without another call. The policy guard then makes one of three calls:

- **allow:** speak the turn.
- **regenerate once with feedback:** if the second draft is also unsafe, a safe deferral is spoken instead.
- **convert to approval:** pause, show the request, and wait for your decision.

### Safety guarantees (enforced in code, not only in prompts)

- **Hard limits:** offers in the structured plan and amounts in the spoken text (₹32,000, 32k, "thirty two thousand", 1.5 lakh, Kannada and Devanagari digits) are checked against limits. Restating the other side's number is allowed.
- **Disclosure:** *Never* fields are never put in any prompt. *Ask me* fields appear by name only until you approve, and approval lasts for one turn. The guard also scans output for restricted values.
- **Commitments:** accepting a deal always needs your final approval.
- **Honesty:** the agent introduces itself as calling on your behalf (by the name you give it, if any). It doesn't announce that it's an AI unless you switch that on, but it never claims to be human, and if asked directly it answers truthfully. The guard blocks any line (or its English translation) that claims to be a person.
- **No invented facts:** missing profile values are presented as unknown, and the agent defers to you.

Approvals distinguish information sharing, negotiation authority, financial commitments, and final commitment.

### One session for text and voice

Text and voice go through one `LiveSession`: microphone PCM, typed counterparty lines, your instructions, approvals and controls. It owns a single conversation ID, transcript, negotiation state, approval queue and state machine (`idle → … → completed`). Text and voice never get separate contexts.

### WebSocket protocol (`/ws/conversations/{id}`)

- **Client → server:**
  - Binary PCM16 at 16 kHz mono (live mic).
  - JSON control messages: `start`, `pause`, `resume`, `interrupt`, `end`, `mute`, `unmute`, `takeover`, `release`.
  - `intervene{text, urgent?}`: a nudge to the agent (see below).
  - `say{text}`: in takeover, your words spoken in the agent's voice.
  - `counterparty_text{text}`, `approval{id,decision,alternative_text}`, `playback_done{turn_id}`.
- **Server → client:**
  - `snapshot` on every connect, so reconnects resume the same session.
  - `state`, `transcript.partial`, `transcript.final`, `transcript.update{id, meta}` (for example a line that was cut off), `negotiation_state`.
  - `instruction.status{id, status: queued|applied|noted, applied_in}`.
  - `audio{turn_id, sample_rate, data}` (base64 PCM16), `audio.end`, `audio.stop`.
  - `approval.request`, `approval.resolved`, `report.pending`, `report.ready`, `error`.

### Nudging a live conversation

Type into the composer, or tap a quick nudge, at any point during the call. Nudges never pause the agent.

- **Normal nudge:** nobody gets cut off. It is shown as *Queued* and applied to the agent's next line.
  - If the agent is mid-line, it finishes first.
  - If the other side is mid-reply, the agent's answer applies the nudge.
  - If the agent is idle, it acts on it right away.
  - Pure guidance ("be firmer", "don't reveal my budget") may be *Noted* without the agent saying anything. It stays in force for every later line.
- **Send now (urgent):** stops whatever is being said or composed, and the agent acts on the nudge immediately.
- **Applied nudges** link to the line they shaped, and that line is tagged "follows your nudge".

The engine keeps *new* nudges, which are acted on now, separate from *standing* ones, which keep applying. Every nudged line still goes through the policy guard.

### Live transcript

- Agent and simulated-counterparty lines reveal word by word in step with audio playback. In text-only mode they follow the server's reading pace.
- Lines cut off by an interruption, barge-in or urgent nudge show what was heard, with the unspoken remainder struck through.
- Live-mode speech streams as partial transcripts.
- Activity rows show when the agent is thinking or the other side is responding.

### Speed

- **The line first, the notes after.** Each agent turn is one small call (what to say, plus the flags the safety check needs) on a fast model with reasoning off and the stable part of the prompt cached. How the negotiation moved is worked out by a second call while the line is being spoken.
- **Practice mode thinks ahead.** As soon as the agent's line is decided, the simulated counterparty's reply is generated and its audio rendered while the agent is still talking; the agent's answer to that reply is planned while the counterparty speaks. A nudge, pause, interrupt, takeover or approval discards anything prepared in advance.
- **Warm voice connection.** A Sarvam TTS socket is opened ahead of each line, so speech starts in about 200 ms.
- The backend logs `latency …` lines per turn (model time, time to first audio, silence since the previous line).

### English alongside every line

Agent and simulated lines carry an English translation from the same model call. Live counterparty speech is translated with Sarvam Translate (with an LLM fallback) in the background and arrives as `transcript.update {meta: {en}}`. The workspace shows the English under each line; the header toggle hides it.

### Voice pipeline

- **TTS:** Bulbul over WebSocket with `linear16` output. PCM chunks are streamed to the browser and scheduled gaplessly in Web Audio. The agent and the simulated counterparty use different speakers. On stream failure it falls back to REST.
- **STT (live mode):** an AudioWorklet resamples the mic to 16 kHz PCM16 in 100 ms frames and sends them to the Sarvam realtime WebSocket (`saaras:v3-realtime`, VAD endpointing, `language_code=auto` unless the counterparty's language is known). Partial transcripts update a single row; a final transcript triggers the agent's turn.
- **Barge-in:** the first non-empty partial transcript while the agent is speaking cancels TTS and stops playback.
- **Orb:** a canvas dot-sphere whose parameters come only from the conversation state, plus the real RMS level of the playback analyser (speaking, simulated listening) or the mic analyser (live listening). Small status glyphs use [`thinking-orbs`](https://libraries.dev/orbs). Reduced motion renders static frames.
- **Mobile:** audio unlocks on the Start tap. A wake lock is held while live. If the tab is backgrounded mid-conversation, the agent pauses and offers to resume.

## Tests

```bash
cd backend && uv run pytest          # 110 tests
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

Backend tests cover:

- Extraction: limits, missing information, conflicts, settings overrides, no restricted data in prompts.
- Disclosure filtering and guard blocking.
- Amount parsing, including Indic digits, words and lakh.
- Limit breaches, commitments and AI disclosure.
- Every allowed and forbidden state transition.
- Intervention priority and context persistence across voice and text.
- Approval, reject and alternative flows, one-turn disclosure, takeover.
- Provider failures: missing key, 429, 5xx, invalid JSON, TTS fallback, quota.
- A full HTTP + WebSocket end-to-end run in demo mode.

## Configuration

See `.env.example`. Every secret stays server-side. The frontend only knows `NEXT_PUBLIC_API_URL`.

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | LLM gateway and default model |
| `LLM_MODEL_EXTRACTION/CONVERSATION/SIMULATOR` | Optional per-stage model overrides |
| `LLM_MODEL_LIVE` | The agent's live lines and notes (default Claude Haiku 5.5) |
| `SARVAM_TRANSLATE_MODEL`, `SPECULATE` | English renderings; thinking ahead in practice mode |
| `SARVAM_API_KEY` | STT + TTS |
| `SARVAM_TTS_MODEL`, `SARVAM_TTS_AGENT_SPEAKER`, `SARVAM_TTS_COUNTERPARTY_SPEAKER` | Voices (speaker names must match the model) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistence (RLS enabled; backend uses service role) |
| `DEMO_MODE` | Force the demo LLM |

## Out of scope (by design, for now)

PSTN / outbound / inbound calling, WhatsApp, native apps, multi-user auth, billing. Telephony plugs in as a new `CounterpartyChannel` that feeds the same STT/TTS pipeline. The objective engine doesn't change.
