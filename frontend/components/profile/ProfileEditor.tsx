"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Disclosure, PrincipalProfile, ProfileField } from "@/types/api";
import { DISCLOSURE_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { cn } from "@/lib/utils";

const POLICIES: Disclosure[] = ["always", "relevant", "approval", "never"];
const POLICY_TONE: Record<Disclosure, string> = {
  always: "data-[on=true]:bg-ink data-[on=true]:text-bg",
  relevant: "data-[on=true]:bg-elevated data-[on=true]:text-ink data-[on=true]:ring-1 data-[on=true]:ring-line",
  approval: "data-[on=true]:bg-warning/15 data-[on=true]:text-warning",
  never: "data-[on=true]:bg-error/15 data-[on=true]:text-error",
};
const LANGUAGES = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia"];

function PolicyControl({ value, onChange, label }: { value: Disclosure; onChange: (d: Disclosure) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={`Sharing policy for ${label}`} className="grid grid-cols-4 gap-1 rounded-xl bg-bg p-1 ring-1 ring-line">
      {POLICIES.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          data-on={value === p}
          onClick={() => onChange(p)}
          className={cn("min-h-9 rounded-lg px-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink", POLICY_TONE[p])}
        >
          {DISCLOSURE_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function FieldRow({ field, onChange, onRemove }: { field: ProfileField; onChange: (f: ProfileField) => void; onRemove?: () => void }) {
  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-2">
        {field.is_custom ? (
          <Input
            aria-label="Attribute name"
            value={field.label}
            placeholder="Attribute name"
            onChange={(e) => onChange({ ...field, label: e.target.value, key: e.target.value.toLowerCase().trim().replace(/\s+/g, "_") })}
            className="h-8 max-w-56 border-transparent bg-transparent px-0 text-meta font-medium text-ink-2 focus-visible:border-line"
          />
        ) : (
          <label htmlFor={`f-${field.id}`} className="text-meta font-medium text-ink-2">
            {field.label}
          </label>
        )}
        {onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${field.label || "attribute"}`}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_minmax(0,22rem)] sm:items-center">
        <Input
          id={`f-${field.id}`}
          value={field.value ?? ""}
          placeholder="Not set: agents will say they don't know"
          onChange={(e) => onChange({ ...field, value: e.target.value })}
          className="h-10 bg-surface"
        />
        <PolicyControl value={field.disclosure} onChange={(d) => onChange({ ...field, disclosure: d })} label={field.label} />
      </div>
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
      toast.success("Profile saved");
    },
  });

  if (isLoading || !draft) return error ? <ErrorNote error={error} /> : <p className="text-ink-3">Loading profile…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const standard = draft.fields.filter((f) => !f.is_custom);
  const custom = draft.fields.filter((f) => f.is_custom);
  const update = (f: ProfileField) => setDraft({ ...draft, fields: draft.fields.map((x) => (x.id === f.id ? f : x)) });

  return (
    <div>
      <h1 className="text-display font-semibold tracking-[-0.025em]">Your profile</h1>
      <p className="mt-2 max-w-[60ch] text-body text-ink-2">
        Agents act on your behalf using these details. Each field has its own rule: an agent never shares a field set to Never, and asks you first for anything set to Ask me.
      </p>

      <section className="mt-8" aria-label="Personal details">
        <ul className="divide-y divide-line/70 border-y border-line/70">
          {standard.map((f) => (
            <FieldRow key={f.id} field={f} onChange={update} />
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-label="Custom attributes">
        <div className="flex items-center justify-between">
          <h2 className="text-lead font-medium">Other details</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({
                ...draft,
                fields: [...draft.fields, { id: crypto.randomUUID(), key: "", label: "", value: "", disclosure: "approval", is_custom: true }],
              })
            }
          >
            <Plus className="size-4" /> Add detail
          </Button>
        </div>
        {custom.length === 0 ? (
          <p className="mt-2 text-meta text-ink-3">Add anything an agent might be asked: lease start date, vehicle number, account ID.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/70 border-y border-line/70">
            {custom.map((f) => (
              <FieldRow key={f.id} field={f} onChange={update} onRemove={() => setDraft({ ...draft, fields: draft.fields.filter((x) => x.id !== f.id) })} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label="Languages and preferences">
        <h2 className="text-lead font-medium">Languages</h2>
        <div className="mt-3 flex flex-wrap gap-2">
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
                  "min-h-9 rounded-full border border-line px-3.5 text-meta text-ink-2 transition-colors",
                  on && "border-violet/60 bg-violet-soft text-ink",
                )}
              >
                {lang}
              </button>
            );
          })}
        </div>
        <label className="mt-6 block text-meta font-medium text-ink-2" htmlFor="prefs">
          How you like conversations handled
        </label>
        <Textarea
          id="prefs"
          className="mt-2 min-h-20 bg-surface"
          placeholder="Keep it short and polite. Never raise your voice."
          value={draft.communication_preferences ?? ""}
          onChange={(e) => setDraft({ ...draft, communication_preferences: e.target.value })}
        />
        <label className="mt-6 block text-meta font-medium text-ink-2" htmlFor="bg">
          Background agents may use
        </label>
        <Textarea
          id="bg"
          className="mt-2 min-h-24 bg-surface"
          placeholder="Two years in this apartment, always paid on time."
          value={draft.background ?? ""}
          onChange={(e) => setDraft({ ...draft, background: e.target.value })}
        />
      </section>

      <ErrorNote error={save.error} className="mt-6" />
      <div className="sticky bottom-20 z-10 mt-8 flex justify-end sm:bottom-6">
        <Button size="lg" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} className="h-11 px-5 shadow-lg shadow-black/40">
          {save.isPending ? "Saving…" : dirty ? "Save profile" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
