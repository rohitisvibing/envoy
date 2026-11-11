"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Hand, Plus, ScanEye, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Disclosure, PrincipalProfile, ProfileField } from "@/types/api";
import { DISCLOSURE_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

const POLICIES: { p: Disclosure; icon: LucideIcon; on: string }[] = [
  { p: "always", icon: Eye, on: "bg-ink/12 text-ink" },
  { p: "relevant", icon: ScanEye, on: "bg-aurora-soft text-aurora" },
  { p: "approval", icon: Hand, on: "bg-warning/15 text-warning" },
  { p: "never", icon: EyeOff, on: "bg-error/15 text-error" },
];
const LANGUAGES = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia"];

const inline =
  "w-full rounded-lg bg-transparent px-2 py-1.5 -mx-2 text-body text-ink transition-colors field-sizing-content hover:bg-surface/70 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-line placeholder:text-ink-3";

/** Who may hear this: four icons, and the chosen one says its name. */
function PolicyControl({ value, onChange, label }: { value: Disclosure; onChange: (d: Disclosure) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={`Sharing ${label}`} className="flex shrink-0 items-center gap-0.5 rounded-full p-0.5 ring-1 ring-line">
      {POLICIES.map(({ p, icon: Icon, on }) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={DISCLOSURE_LABEL[p]}
            title={DISCLOSURE_LABEL[p]}
            onClick={() => onChange(p)}
            className={cn(
              "flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2 text-[12px] text-ink-3 transition-colors hover:text-ink",
              active && on,
            )}
          >
            <Icon className="size-3.5" />
            {active && <span className="hidden pr-0.5 sm:inline">{DISCLOSURE_LABEL[p]}</span>}
          </button>
        );
      })}
    </div>
  );
}

function FieldRow({ field, onChange, onRemove }: { field: ProfileField; onChange: (f: ProfileField) => void; onRemove?: () => void }) {
  return (
    <li className="py-2.5">
      <div className="flex min-h-9 items-center gap-2">
        <div className="min-w-0 flex-1">
          {field.is_custom ? (
            <input
              aria-label="Detail name"
              value={field.label}
              placeholder="Name"
              onChange={(e) => onChange({ ...field, label: e.target.value, key: e.target.value.toLowerCase().trim().replace(/\s+/g, "_") })}
              className={cn(inline, "py-0.5 text-meta text-ink-3")}
            />
          ) : (
            <label htmlFor={`f-${field.id}`} className="block truncate text-meta text-ink-3">
              {field.label}
            </label>
          )}
        </div>
        <PolicyControl value={field.disclosure} onChange={(d) => onChange({ ...field, disclosure: d })} label={field.label} />
        {onRemove && <IconButton label={`Remove ${field.label || "detail"}`} icon={X} size="sm" onClick={onRemove} />}
      </div>
      <input id={`f-${field.id}`} value={field.value ?? ""} placeholder="Not set" onChange={(e) => onChange({ ...field, value: e.target.value })} className={inline} />
    </li>
  );
}

export function ProfileEditor() {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const [draft, setDraft] = useState<PrincipalProfile | null>(null);
  const [synced, setSynced] = useState<PrincipalProfile | undefined>(undefined);
  if (data && data !== synced) {
    // Server data changed (first load or after save): reset the local draft.
    setSynced(data);
    setDraft(structuredClone(data));
  }
  const save = useMutation({
    mutationFn: (p: PrincipalProfile) => api.saveProfile(p),
    onSuccess: (p) => {
      qc.setQueryData(["profile"], p);
      toast.success("Saved");
    },
  });

  if (isLoading || !draft) return error ? <ErrorNote error={error} /> : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const standard = draft.fields.filter((f) => !f.is_custom);
  const custom = draft.fields.filter((f) => f.is_custom);
  const update = (f: ProfileField) => setDraft({ ...draft, fields: draft.fields.map((x) => (x.id === f.id ? f : x)) });

  return (
    <div className="pt-4 sm:pt-10">
      <h1 className="font-serif text-[2.75rem] leading-none sm:text-hero">About you</h1>

      <ul className="mt-8" aria-label="Your details">
        {standard.map((f) => (
          <FieldRow key={f.id} field={f} onChange={update} />
        ))}
        {custom.map((f) => (
          <FieldRow key={f.id} field={f} onChange={update} onRemove={() => setDraft({ ...draft, fields: draft.fields.filter((x) => x.id !== f.id) })} />
        ))}
      </ul>
      <button
        type="button"
        className="mt-1 flex min-h-10 items-center gap-1.5 text-meta text-ink-3 hover:text-ink"
        onClick={() =>
          setDraft({
            ...draft,
            fields: [...draft.fields, { id: crypto.randomUUID(), key: "", label: "", value: "", disclosure: "approval", is_custom: true }],
          })
        }
      >
        <Plus className="size-3.5" /> Detail
      </button>

      <section className="mt-12" aria-label="Languages">
        <h2 className="text-meta text-ink-3">Languages</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LANGUAGES.map((lang) => {
            const on = draft.preferred_languages.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    ...draft,
                    preferred_languages: on ? draft.preferred_languages.filter((l) => l !== lang) : [...draft.preferred_languages, lang],
                  })
                }
                className={cn(
                  "min-h-8 rounded-full px-3 text-meta text-ink-2 ring-1 ring-line transition-colors hover:text-ink",
                  on && "bg-aurora-soft text-ink ring-aurora/50",
                )}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-10 space-y-6" aria-label="How to speak for you">
        <div>
          <label className="text-meta text-ink-3" htmlFor="prefs">
            How to speak for you
          </label>
          <textarea
            id="prefs"
            rows={1}
            className={cn(inline, "mt-1 resize-none")}
            placeholder="Short and polite. Never raise your voice."
            value={draft.communication_preferences ?? ""}
            onChange={(e) => setDraft({ ...draft, communication_preferences: e.target.value })}
          />
        </div>
        <div>
          <label className="text-meta text-ink-3" htmlFor="bg">
            Background
          </label>
          <textarea
            id="bg"
            rows={1}
            className={cn(inline, "mt-1 resize-none")}
            placeholder="Two years in this flat, always paid on time."
            value={draft.background ?? ""}
            onChange={(e) => setDraft({ ...draft, background: e.target.value })}
          />
        </div>
      </section>

      <ErrorNote error={save.error} className="mt-6" />
      <div className="sticky bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 mt-10 flex justify-end">
        {dirty && (
          <Button size="lg" disabled={save.isPending} onClick={() => save.mutate(draft)} className="h-12 rounded-full px-7 shadow-[0_10px_40px_-10px_rgb(157_176_255/0.6)]">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}
