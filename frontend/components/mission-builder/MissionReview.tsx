"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Pencil, Plus, X } from "lucide-react";
import { api } from "@/services/api";
import type { ApprovalKind, Mission, MissionSpec, Quantity } from "@/types/api";
import { APPROVAL_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { DealLine, dealFrom } from "@/components/viz/DealLine";
import { cn } from "@/lib/utils";

/** Text that reads as text until you touch it. */
const inline =
  "w-full resize-none rounded-lg bg-transparent px-2 py-1 -mx-2 text-ink transition-colors field-sizing-content hover:bg-surface/70 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-line placeholder:text-ink-3";

function Lines({ items, onChange, add, label }: { items: string[]; onChange: (v: string[]) => void; add: string; label: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="group flex items-start gap-1">
          <textarea
            aria-label={`${label} ${i + 1}`}
            value={item}
            rows={1}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className={cn(inline, "text-body")}
          />
          <IconButton
            label={`Remove ${label.toLowerCase()} ${i + 1}`}
            icon={X}
            size="sm"
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </li>
      ))}
      <li>
        <button type="button" className="flex min-h-9 items-center gap-1.5 text-meta text-ink-3 hover:text-ink" onClick={() => onChange([...items, ""])}>
          <Plus className="size-3.5" /> {add}
        </button>
      </li>
    </ul>
  );
}

function Numbers({ items, onChange, kind }: { items: Quantity[]; onChange: (q: Quantity[]) => void; kind: "aim" | "limit" }) {
  const set = (i: number, q: Partial<Quantity>) => onChange(items.map((x, j) => (j === i ? { ...x, ...q } : x)));
  return (
    <>
      {items.map((q, i) => (
        <li key={`${kind}-${i}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)_7rem_auto] items-center gap-2">
          <span className={cn("text-meta", kind === "aim" ? "text-aurora" : "text-ink")}>{kind}</span>
          <input aria-label={`${kind} name`} value={q.label} onChange={(e) => set(i, { label: e.target.value })} className={cn(inline, "text-body")} />
          <input
            aria-label={`${q.label} ${kind}`}
            inputMode="numeric"
            value={Number.isFinite(q.value) ? String(q.value) : ""}
            onChange={(e) => set(i, { value: Number(e.target.value.replace(/[^\d.]/g, "")) })}
            className={cn(inline, "text-body tabular")}
          />
          <button
            type="button"
            onClick={() => set(i, { direction: q.direction === "max" ? "min" : "max" })}
            className="min-h-9 rounded-full px-2.5 text-meta text-ink-2 ring-1 ring-line hover:text-ink"
            aria-label={`Direction: ${q.direction === "max" ? "at most" : "at least"}. Switch.`}
          >
            {q.direction === "max" ? "≤" : "≥"}
          </button>
        </li>
      ))}
    </>
  );
}

function Clarify({ mission, onRefined }: { mission: Mission; onRefined: (m: Mission) => void }) {
  const qs = mission.extraction?.clarifying_questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const refine = useMutation({ mutationFn: () => api.refine(mission.id, answers), onSuccess: onRefined });
  if (!qs.length) return null;
  return (
    <section className="mt-10 space-y-4" aria-label="Questions">
      {qs.map((q, i) => (
        <div key={q}>
          <label htmlFor={`q-${i}`} className="block text-body text-ink">
            {q}
          </label>
          <input
            id={`q-${i}`}
            className="mt-1.5 h-11 w-full rounded-xl bg-surface/80 px-3.5 text-body ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-aurora/50"
            value={answers[q] ?? ""}
            onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
          />
        </div>
      ))}
      <ErrorNote error={refine.error} />
      <Button variant="secondary" disabled={refine.isPending || !Object.values(answers).some((a) => a.trim())} onClick={() => refine.mutate()}>
        {refine.isPending ? "Updating…" : "Update"}
      </Button>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function MissionReview({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: mission, error } = useQuery({ queryKey: ["mission", id], queryFn: () => api.mission(id) });
  const [spec, setSpec] = useState<MissionSpec | null>(null);
  const [synced, setSynced] = useState<Mission | undefined>(undefined);
  const [editNumbers, setEditNumbers] = useState(false);
  const [more, setMore] = useState(false);
  if (mission && mission !== synced) {
    setSynced(mission);
    setSpec(structuredClone(mission.spec));
  }

  const approve = useMutation({
    mutationFn: async () => {
      if (!mission || !spec) return;
      if (JSON.stringify(spec) !== JSON.stringify(mission.spec)) await api.updateSpec(id, spec);
      return api.approve(id);
    },
    onSuccess: (m) => {
      if (m) qc.setQueryData(["mission", id], m);
      qc.invalidateQueries({ queryKey: ["missions"] });
      router.push(`/missions/${id}/prepare`);
    },
  });

  if (error) return <ErrorNote error={error} />;
  if (!mission || !spec) return null;
  const set = <K extends keyof MissionSpec>(k: K, v: MissionSpec[K]) => setSpec({ ...spec, [k]: v });
  const locked = !["draft", "approved", "prepared"].includes(mission.status);
  const deal = dealFrom(spec);
  const ex = mission.extraction;
  // Conflicts always show. Gaps only when no question already asks about them, and briefly.
  const flags = ex
    ? [
        ...ex.conflicts.map((t) => ({ t, bad: true })),
        ...(ex.clarifying_questions.length ? [] : [...ex.missing_information, ...ex.ambiguities].slice(0, 3).map((t) => ({ t, bad: false }))),
      ]
    : [];

  return (
    <div className="pt-4 sm:pt-10">
      <fieldset disabled={locked} className="min-w-0">
        <label htmlFor="title" className="sr-only">
          Title
        </label>
        <textarea
          id="title"
          rows={1}
          value={spec.title}
          onChange={(e) => set("title", e.target.value)}
          className={cn(inline, "font-serif text-[2.5rem] leading-[1.05] sm:text-[3rem]")}
        />
        <label htmlFor="objective" className="sr-only">
          Objective
        </label>
        <textarea id="objective" rows={1} value={spec.objective} onChange={(e) => set("objective", e.target.value)} className={cn(inline, "mt-2 text-lead text-ink-2")} />


        <section className="mt-10" aria-label="Numbers">
          <div className="flex items-start gap-3">
            {deal ? <DealLine deal={deal} className="flex-1" /> : <p className="flex-1 text-meta text-ink-3">No numbers to negotiate.</p>}
            <IconButton label="Edit numbers" icon={Pencil} size="sm" active={editNumbers} onClick={() => setEditNumbers((v) => !v)} />
          </div>
          <AnimatePresence initial={false}>
            {editNumbers && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 space-y-1 overflow-hidden"
              >
                <Numbers items={spec.targets} onChange={(v) => set("targets", v)} kind="aim" />
                <Numbers items={spec.hard_limits} onChange={(v) => set("hard_limits", v)} kind="limit" />
                <li className="flex gap-4 pt-1">
                  {(["aim", "limit"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="flex min-h-9 items-center gap-1.5 text-meta text-ink-3 hover:text-ink"
                      onClick={() => {
                        const list = k === "aim" ? spec.targets : spec.hard_limits;
                        const q: Quantity = { name: `${k}_${list.length + 1}`, label: deal?.label ?? "Amount", value: 0, unit: deal?.unit ?? "INR", direction: "max" };
                        set(k === "aim" ? "targets" : "hard_limits", [...list, q]);
                      }}
                    >
                      <Plus className="size-3.5" /> {k}
                    </button>
                  ))}
                </li>
              </motion.ul>
            )}
          </AnimatePresence>
        </section>

        {flags.length > 0 && (
          <ul className="mt-8 space-y-1.5" aria-label="Worth checking">
            {flags.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-body text-ink-2">
                <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", f.bad ? "bg-error" : "bg-warning")} aria-hidden />
                {f.t}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <Clarify mission={mission} onRefined={(m) => qc.setQueryData(["mission", id], m)} />

      <fieldset disabled={locked} className="min-w-0">
        <dl className="mt-10">
          <Fact label="With">
            <input
              aria-label="Who they're talking to"
              value={spec.counterparty.type}
              onChange={(e) => set("counterparty", { ...spec.counterparty, type: e.target.value })}
              className={cn(inline, "text-body")}
            />
          </Fact>
          <Fact label="Speaks">
            <input
              aria-label="Languages, preferred first"
              value={spec.communication.languages.join(", ")}
              onChange={(e) => set("communication", { ...spec.communication, languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className={cn(inline, "text-body")}
            />
          </Fact>
          <Fact label="Tone">
            <input
              aria-label="Tone"
              value={spec.communication.tone}
              onChange={(e) => set("communication", { ...spec.communication, tone: e.target.value })}
              className={cn(inline, "text-body")}
            />
          </Fact>
          {spec.approval_requirements.length > 0 && (
            <Fact label="Asks you">
              <ul className="space-y-0.5 py-1 text-body text-ink">
                {spec.approval_requirements.map((a, i) => (
                  <li key={i}>{a.condition || APPROVAL_LABEL[a.kind]}</li>
                ))}
              </ul>
            </Fact>
          )}
        </dl>

        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className="mt-8 flex min-h-10 items-center gap-1.5 text-meta text-ink-2 hover:text-ink"
        >
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
          More
        </button>
        <AnimatePresence initial={false}>
          {more && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="space-y-8 pb-2 pt-4">
                <Block title="Outcome you want">
                  <textarea aria-label="Desired outcome" rows={1} value={spec.desired_outcome} onChange={(e) => set("desired_outcome", e.target.value)} className={cn(inline, "text-body")} />
                </Block>
                <Block title="Plan">
                  <Lines items={spec.strategy} onChange={(v) => set("strategy", v)} add="Step" label="Step" />
                </Block>
                <Block title="Rules">
                  <Lines items={spec.constraints} onChange={(v) => set("constraints", v)} add="Rule" label="Rule" />
                </Block>
                <Block title="Background">
                  <Lines items={spec.context} onChange={(v) => set("context", v)} add="Fact" label="Fact" />
                </Block>
                <Block title="Ask me before">
                  <ul className="space-y-1">
                    {spec.approval_requirements.map((a, i) => (
                      <li key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-2">
                        <select
                          aria-label="Kind"
                          value={a.kind}
                          onChange={(e) => set("approval_requirements", spec.approval_requirements.map((x, j) => (j === i ? { ...x, kind: e.target.value as ApprovalKind } : x)))}
                          className="h-9 rounded-lg bg-surface px-2 text-meta text-ink-2 ring-1 ring-line"
                        >
                          {(Object.keys(APPROVAL_LABEL) as ApprovalKind[]).map((k) => (
                            <option key={k} value={k}>
                              {APPROVAL_LABEL[k]}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="When"
                          value={a.condition}
                          onChange={(e) => set("approval_requirements", spec.approval_requirements.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))}
                          className={cn(inline, "text-body")}
                        />
                      </li>
                    ))}
                    <li>
                      <button
                        type="button"
                        className="flex min-h-9 items-center gap-1.5 text-meta text-ink-3 hover:text-ink"
                        onClick={() => set("approval_requirements", [...spec.approval_requirements, { kind: "financial", condition: "" }])}
                      >
                        <Plus className="size-3.5" /> Checkpoint
                      </button>
                    </li>
                  </ul>
                </Block>
                <Block title="Success means">
                  <Lines items={spec.success_criteria} onChange={(v) => set("success_criteria", v)} add="Criterion" label="Criterion" />
                </Block>
                <Block title="Their name and language">
                  <div className="grid gap-1 sm:grid-cols-2">
                    <input
                      aria-label="Their name"
                      placeholder="Name"
                      value={spec.counterparty.name ?? ""}
                      onChange={(e) => set("counterparty", { ...spec.counterparty, name: e.target.value || null })}
                      className={cn(inline, "text-body")}
                    />
                    <input
                      aria-label="Their language"
                      placeholder="Language"
                      value={spec.counterparty.preferred_language ?? ""}
                      onChange={(e) => set("counterparty", { ...spec.counterparty, preferred_language: e.target.value || null })}
                      className={cn(inline, "text-body")}
                    />
                  </div>
                </Block>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </fieldset>

      <ErrorNote error={approve.error} className="mt-6" />
      <div className="sticky bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 mt-10 flex justify-end">
        {!locked && (
          <Button size="lg" onClick={() => approve.mutate()} disabled={approve.isPending} className="h-12 rounded-full px-7 shadow-[0_10px_40px_-10px_rgb(157_176_255/0.6)]">
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 text-meta text-ink-3">{title}</h2>
      {children}
    </section>
  );
}
