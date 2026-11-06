"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { api } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { cn } from "@/lib/utils";

const LANGS = ["English", "Kannada", "Hindi", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali"];

export function MissionComposer() {
  const router = useRouter();
  const params = useSearchParams();
  const templateId = params.get("template");
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const [text, setText] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [counterparty, setCounterparty] = useState("");
  const [tone, setTone] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);

  const template = templates.data?.find((x) => x.id === templateId);
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  if (template && appliedTemplate !== template.id) {
    setAppliedTemplate(template.id);
    if (!text) setText(template.prompt_example);
  }

  const extract = useMutation({
    mutationFn: () =>
      api.extract({
        text: text.trim(),
        counterparty_type: counterparty.trim() || undefined,
        tone: tone.trim() || undefined,
        languages: languages.length ? languages : undefined,
        template_id: templateId ?? undefined,
      }),
    onSuccess: (m) => router.push(`/missions/${m.id}/review`),
  });

  const ready = text.trim().length >= 8 && !extract.isPending;

  return (
    <div>
      <h1 className="text-display font-semibold tracking-[-0.025em]">Describe the mission</h1>
      <p className="mt-2 max-w-[60ch] text-body text-ink-2">
        Say who the agent should talk to, what you want, and where your limits are. Write it the way you&apos;d brief a friend making the call for you.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) extract.mutate();
        }}
      >
        <label htmlFor="mission" className="sr-only">
          Mission description
        </label>
        <div className="relative rounded-2xl border border-line bg-surface focus-within:border-violet/60">
          <Textarea
            id="mission"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) extract.mutate();
            }}
            placeholder="Call my landlord and negotiate the rent from ₹35,000 down to ₹30,000. Be polite but firm. Speak Kannada if he prefers. Don't agree to anything above ₹32,000 without asking me."
            className="min-h-56 resize-none border-0 bg-transparent px-4 py-4 text-lead leading-relaxed text-ink shadow-none placeholder:text-ink-3 focus-visible:ring-0 sm:min-h-64"
            disabled={extract.isPending}
          />
          <div className="flex items-center justify-between gap-3 border-t border-line/70 px-3 py-2.5">
            <span className="text-[12px] text-ink-3">{text.length > 0 ? `${text.length} characters` : "Ctrl + Enter to continue"}</span>
            <Button type="submit" disabled={!ready} className="h-10 px-4">
              {extract.isPending ? "Reading your request…" : "Build mission"}
            </Button>
          </div>
        </div>

        {templates.data && !text && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Examples">
            {templates.data.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setText(t.prompt_example);
                  area.current?.focus();
                }}
                className="min-h-9 rounded-full border border-line px-3.5 text-meta text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
          className="mt-6 flex min-h-10 items-center gap-1.5 text-meta text-ink-2 hover:text-ink"
        >
          <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
          Optional settings
        </button>
        <AnimatePresence initial={false}>
          {advanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="grid gap-4 pt-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="cp" className="text-meta text-ink-2">
                    Who they&apos;ll talk to
                  </label>
                  <Input id="cp" className="mt-1.5 h-10 bg-surface" placeholder="Landlord" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="tone" className="text-meta text-ink-2">
                    Tone
                  </label>
                  <Input id="tone" className="mt-1.5 h-10 bg-surface" placeholder="Polite but firm" value={tone} onChange={(e) => setTone(e.target.value)} />
                </div>
                <fieldset className="sm:col-span-2">
                  <legend className="text-meta text-ink-2">Languages, in order of preference</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {LANGS.map((l) => {
                      const i = languages.indexOf(l);
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={i >= 0}
                          onClick={() => setLanguages((cur) => (i >= 0 ? cur.filter((x) => x !== l) : [...cur, l]))}
                          className={cn(
                            "min-h-9 rounded-full border border-line px-3.5 text-meta text-ink-2",
                            i >= 0 && "border-violet/60 bg-violet-soft text-ink",
                          )}
                        >
                          {i >= 0 && <span className="mr-1 text-violet tabular">{i + 1}</span>}
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      <ErrorNote error={extract.error} className="mt-6" />

      <AnimatePresence>
        {extract.isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 grid place-items-center bg-bg/80 backdrop-blur-sm"
            aria-live="polite"
          >
            <div className="flex flex-col items-center">
              <div className="size-48">
                <AgentOrb state="preparing" label="Building the mission" />
              </div>
              <p className="mt-2 text-body text-ink-2">Separating targets from limits…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
