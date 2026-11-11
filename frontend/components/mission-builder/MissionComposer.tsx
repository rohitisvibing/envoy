"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, SlidersHorizontal } from "lucide-react";
import { api } from "@/services/api";
import { ErrorNote } from "@/components/shell/ErrorNote";
import { AgentOrb } from "@/components/orb/AgentOrb";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

const LANGS = ["English", "Kannada", "Hindi", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali"];

const field =
  "h-11 w-full rounded-xl bg-bg/60 px-3.5 text-body text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-aurora/60";

/** The home question. What you type here becomes a mission to review. */
export function MissionComposer({ greeting }: { greeting?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const templateId = params.get("template");
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
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
    <section aria-label="New mission" className="pt-6 sm:pt-14">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
        className="font-serif text-[2.75rem] leading-[1.02] tracking-[-0.01em] text-ink sm:text-hero"
      >
        {greeting ? (
          <>
            {greeting},<br />
            what should I handle?
          </>
        ) : (
          "What should I handle?"
        )}
      </motion.h1>

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) extract.mutate();
        }}
      >
        <div className="rounded-3xl bg-surface/80 ring-1 ring-line backdrop-blur-sm transition-shadow focus-within:ring-aurora/50 focus-within:shadow-[0_0_60px_-20px_rgb(157_176_255/0.5)]">
          <label htmlFor="mission" className="sr-only">
            Describe the conversation
          </label>
          <textarea
            id="mission"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) extract.mutate();
            }}
            placeholder="Get my rent down from ₹35,000 to ₹30,000. Never above ₹32,000 without asking me. Kannada if he prefers."
            className="block min-h-36 w-full resize-none bg-transparent px-5 pt-5 text-lead leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none sm:min-h-40"
            disabled={extract.isPending}
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <IconButton label="Who, tone and language" icon={SlidersHorizontal} size="sm" active={more} onClick={() => setMore((v) => !v)} />
            <IconButton label="Build mission" icon={ArrowUp} type="submit" tone="accent" disabled={!ready} />
          </div>
          <AnimatePresence initial={false}>
            {more && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
                  <label className="sr-only" htmlFor="cp">
                    Who they&apos;ll talk to
                  </label>
                  <input id="cp" className={field} placeholder="Talking to…" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
                  <label className="sr-only" htmlFor="tone">
                    Tone
                  </label>
                  <input id="tone" className={field} placeholder="Tone…" value={tone} onChange={(e) => setTone(e.target.value)} />
                  <div className="flex flex-wrap gap-1.5 pt-1 sm:col-span-2" role="group" aria-label="Languages, in order">
                    {LANGS.map((l) => {
                      const i = languages.indexOf(l);
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={i >= 0}
                          onClick={() => setLanguages((cur) => (i >= 0 ? cur.filter((x) => x !== l) : [...cur, l]))}
                          className={cn(
                            "min-h-8 rounded-full px-3 text-meta text-ink-2 ring-1 ring-line transition-colors hover:text-ink",
                            i >= 0 && "bg-aurora-soft text-ink ring-aurora/50",
                          )}
                        >
                          {i >= 0 && <span className="mr-1 text-aurora tabular">{i + 1}</span>}
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {templates.data && !text && (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Examples">
            {templates.data.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.description}
                onClick={() => {
                  setText(t.prompt_example);
                  area.current?.focus();
                }}
                className="min-h-8 rounded-full px-3 text-meta text-ink-2 ring-1 ring-line/70 transition-colors hover:bg-elevated hover:text-ink"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </form>

      <ErrorNote error={extract.error} className="mt-6" />

      <AnimatePresence>
        {extract.isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 grid place-items-center bg-bg/85 backdrop-blur-md"
            aria-live="polite"
          >
            <div className="size-56">
              <AgentOrb state="preparing" label="Building the mission" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
