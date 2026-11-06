"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleHelp, Plus, X } from "lucide-react";
import { api } from "@/services/api";
import type { ApprovalKind, Mission, MissionSpec, Quantity } from "@/types/api";
import { APPROVAL_LABEL, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line/70 py-6 first:border-t-0 first:pt-0" aria-label={title}>
      <h2 className="text-lead font-medium text-ink">{title}</h2>
      {hint && <p className="mt-1 text-meta text-ink-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EditableList({ items, onChange, placeholder, label }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <Textarea
            aria-label={`${label} ${i + 1}`}
            value={item}
            rows={1}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className="min-h-10 flex-1 resize-none bg-surface py-2 text-body"
          />
          <Button variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </Button>
        </li>
      ))}
      <li>
        <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => onChange([...items, ""])}>
          <Plus className="size-4" /> {placeholder}
        </Button>
      </li>
    </ul>
  );
}

function QuantityEditor({ items, onChange, kind }: { items: Quantity[]; onChange: (q: Quantity[]) => void; kind: "target" | "limit" }) {
  return (
    <ul className="space-y-2">
      {items.map((q, i) => (
        <li key={i} className="grid grid-cols-[1fr_8.5rem_auto] items-center gap-2 sm:grid-cols-[1fr_10rem_9rem_auto]">
          <Input
            aria-label="Name"
            value={q.label}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            className="h-10 bg-surface"
          />
          <Input
            aria-label={`${q.label} value`}
            inputMode="numeric"
            value={Number.isFinite(q.value) ? String(q.value) : ""}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/[^\d.]/g, "")) } : x)))}
            className="h-10 bg-surface tabular"
          />
          <select
            aria-label="Direction"
            value={q.direction}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, direction: e.target.value as "max" | "min" } : x)))}
            className="col-span-2 row-start-2 h-10 rounded-lg border border-line bg-surface px-2 text-meta text-ink sm:col-span-1 sm:row-start-auto"
          >
            <option value="max">{kind === "limit" ? "Never above" : "At most"}</option>
            <option value="min">{kind === "limit" ? "Never below" : "At least"}</option>
          </select>
          <Button variant="ghost" size="icon" aria-label={`Remove ${q.label}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </Button>
        </li>
      ))}
      <li>
        <Button
          variant="ghost"
          size="sm"
          className="text-ink-2"
          onClick={() =>
            onChange([
              ...items,
              { name: `${kind}_${items.length + 1}`, label: kind === "limit" ? "New limit" : "New target", value: 0, unit: "INR", direction: "max" },
            ])
          }
        >
          <Plus className="size-4" /> Add {kind}
        </Button>
      </li>
    </ul>
  );
}

function Flags({ mission }: { mission: Mission }) {
  const ex = mission.extraction;
  if (!ex) return null;
  const rows = [
    ...ex.conflicts.map((t) => ({ t, tone: "error" as const })),
    ...ex.ambiguities.map((t) => ({ t, tone: "warning" as const })),
    ...ex.missing_information.map((t) => ({ t, tone: "warning" as const })),
  ];
  if (!rows.length) return null;
  return (
    <ul className="mb-6 space-y-2" aria-label="Things to check">
      {rows.map((r, i) => (
        <li
          key={i}
          className={cn(
            "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-body",
            r.tone === "error" ? "border-error/35 bg-error/8" : "border-warning/30 bg-warning/8",
          )}
        >
          <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", r.tone === "error" ? "text-error" : "text-warning")} />
          {r.t}
        </li>
      ))}
    </ul>
  );
}

function Clarify({ mission, onRefined }: { mission: Mission; onRefined: (m: Mission) => void }) {
  const qs = mission.extraction?.clarifying_questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const refine = useMutation({ mutationFn: () => api.refine(mission.id, answers), onSuccess: onRefined });
  if (!qs.length) return null;
  return (
    <section className="mb-8 rounded-2xl border border-violet/30 bg-violet-soft/40 p-4" aria-label="Questions from the agent">
      <h2 className="flex items-center gap-2 text-body font-medium">
        <CircleHelp className="size-4 text-violet" /> A few things the agent needs to know
      </h2>
      <ul className="mt-3 space-y-3">
        {qs.map((q) => (
          <li key={q}>
            <label className="text-body text-ink">{q}</label>
            <Input
              className="mt-1.5 h-10 bg-bg"
              value={answers[q] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
              placeholder="Leave blank to skip"
            />
          </li>
        ))}
      </ul>
      <ErrorNote error={refine.error} className="mt-3" />
      <Button
        className="mt-4"
        variant="secondary"
        disabled={refine.isPending || !Object.values(answers).some((a) => a.trim())}
        onClick={() => refine.mutate()}
      >
        {refine.isPending ? "Updating…" : "Update mission"}
      </Button>
    </section>
  );
}

export function MissionReview({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: mission, error } = useQuery({ queryKey: ["mission", id], queryFn: () => api.mission(id) });
  const [spec, setSpec] = useState<MissionSpec | null>(null);
  const [synced, setSynced] = useState<Mission | undefined>(undefined);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["missions"] });
      router.push(`/missions/${id}/prepare`);
    },
  });

  if (error) return <ErrorNote error={error} />;
  if (!mission || !spec) return <p className="text-ink-3">Loading mission…</p>;
  const set = <K extends keyof MissionSpec>(k: K, v: MissionSpec[K]) => setSpec({ ...spec, [k]: v });
  const locked = !["draft", "approved", "prepared"].includes(mission.status);

  return (
    <div>
      <p className="text-meta text-ink-3">{mission.agent_type}</p>
      <Input
        aria-label="Mission title"
        value={spec.title}
        onChange={(e) => set("title", e.target.value)}
        className="mt-1 h-auto border-transparent bg-transparent px-0 py-1 text-display font-semibold tracking-[-0.025em] focus-visible:border-line md:text-display"
      />
      <p className="mt-1 text-body text-ink-2">Check what the agent understood. Edit anything that&apos;s off before you approve.</p>

      <div className="mt-6">
        <Flags mission={mission} />
        <Clarify
          mission={mission}
          onRefined={(m) => {
            qc.setQueryData(["mission", id], m);
          }}
        />
      </div>

      <fieldset disabled={locked} className="min-w-0">
        <Section title="Objective">
          <Textarea value={spec.objective} onChange={(e) => set("objective", e.target.value)} className="min-h-16 bg-surface text-body" />
        </Section>

        <Section title="Desired outcome" hint="What the agent aims for. It can settle for less within your limits, then asks you before agreeing.">
          <Textarea value={spec.desired_outcome} onChange={(e) => set("desired_outcome", e.target.value)} className="min-h-12 bg-surface text-body" />
          <div className="mt-4">
            <QuantityEditor items={spec.targets} onChange={(v) => set("targets", v)} kind="target" />
          </div>
        </Section>

        <Section title="Hard limits" hint="The agent will never offer or agree past these without your approval in the moment.">
          {spec.hard_limits.length > 0 && (
            <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-body">
              {spec.hard_limits.map((q) => (
                <span key={q.name}>
                  {q.label}: <span className="tabular text-ink">{q.direction === "max" ? "≤" : "≥"} {money(q.value, q.unit)}</span>
                </span>
              ))}
            </p>
          )}
          <QuantityEditor items={spec.hard_limits} onChange={(v) => set("hard_limits", v)} kind="limit" />
          <div className="mt-4">
            <EditableList items={spec.constraints} onChange={(v) => set("constraints", v)} placeholder="Add a rule" label="Rule" />
          </div>
        </Section>

        <Section title="Context">
          <EditableList items={spec.context} onChange={(v) => set("context", v)} placeholder="Add context" label="Context" />
        </Section>

        <Section title="Who they're talking to">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input aria-label="Counterparty role" value={spec.counterparty.type} onChange={(e) => set("counterparty", { ...spec.counterparty, type: e.target.value })} className="h-10 bg-surface" />
            <Input aria-label="Counterparty name" placeholder="Name (optional)" value={spec.counterparty.name ?? ""} onChange={(e) => set("counterparty", { ...spec.counterparty, name: e.target.value || null })} className="h-10 bg-surface" />
            <Input aria-label="Their language" placeholder="Their language, if known" value={spec.counterparty.preferred_language ?? ""} onChange={(e) => set("counterparty", { ...spec.counterparty, preferred_language: e.target.value || null })} className="h-10 bg-surface" />
          </div>
        </Section>

        <Section title="Personality and language">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-meta text-ink-2" htmlFor="tone">Tone</label>
              <Input id="tone" value={spec.communication.tone} onChange={(e) => set("communication", { ...spec.communication, tone: e.target.value })} className="mt-1.5 h-10 bg-surface" />
            </div>
            <div>
              <label className="text-meta text-ink-2" htmlFor="langs">Languages, preferred first</label>
              <Input
                id="langs"
                value={spec.communication.languages.join(", ")}
                onChange={(e) => set("communication", { ...spec.communication, languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                className="mt-1.5 h-10 bg-surface"
              />
            </div>
          </div>
        </Section>

        <Section title="Strategy">
          <EditableList items={spec.strategy} onChange={(v) => set("strategy", v)} placeholder="Add a step" label="Step" />
        </Section>

        <Section title="Ask me before" hint="The agent pauses and waits for your decision in these situations.">
          <ul className="space-y-2">
            {spec.approval_requirements.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <select
                  aria-label="Approval type"
                  value={a.kind}
                  onChange={(e) =>
                    set("approval_requirements", spec.approval_requirements.map((x, j) => (j === i ? { ...x, kind: e.target.value as ApprovalKind } : x)))
                  }
                  className="h-10 w-40 shrink-0 rounded-lg border border-line bg-surface px-2 text-meta sm:w-56"
                >
                  {(Object.keys(APPROVAL_LABEL) as ApprovalKind[]).map((k) => (
                    <option key={k} value={k}>
                      {APPROVAL_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Condition"
                  value={a.condition}
                  onChange={(e) =>
                    set("approval_requirements", spec.approval_requirements.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))
                  }
                  className="h-10 flex-1 bg-surface"
                />
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="text-ink-2"
                onClick={() => set("approval_requirements", [...spec.approval_requirements, { kind: "financial", condition: "" }])}
              >
                <Plus className="size-4" /> Add a checkpoint
              </Button>
            </li>
          </ul>
        </Section>

        <Section title="Success means" hint="The outcome report judges the conversation against these, not against how friendly it was.">
          <EditableList items={spec.success_criteria} onChange={(v) => set("success_criteria", v)} placeholder="Add a criterion" label="Criterion" />
        </Section>
      </fieldset>

      <ErrorNote error={approve.error} className="mt-4" />
      <div className="sticky bottom-20 z-10 mt-6 flex items-center justify-end gap-3 sm:bottom-6">
        {locked ? (
          <p className="text-meta text-ink-2">This mission has already run.</p>
        ) : (
          <Button size="lg" onClick={() => approve.mutate()} disabled={approve.isPending} className="shadow-lg shadow-black/40">
            {approve.isPending ? "Approving…" : "Approve mission"}
          </Button>
        )}
      </div>
    </div>
  );
}
