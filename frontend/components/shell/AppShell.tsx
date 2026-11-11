"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import type { ConversationState } from "@/types/api";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "@/components/orb/StatusGlyph";
import { DemoBadge } from "./DemoBadge";
import { AmbientGlow } from "./AmbientGlow";

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-full pr-1 text-ink" aria-label="Envoy home">
      <StatusGlyph state="ready" size={20} label="Envoy" />
      <span className="font-serif text-[22px] leading-none tracking-[-0.01em]">Envoy</span>
    </Link>
  );
}

/** Page chrome: one quiet line on top, and the room light behind. */
export function AppShell({
  children,
  wide = false,
  glow = "ready",
}: {
  children: React.ReactNode;
  wide?: boolean;
  glow?: ConversationState | null;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      {glow && <AmbientGlow state={glow} />}
      <header className="relative z-10">
        <div className={cn("mx-auto flex h-16 items-center justify-between px-4 sm:px-6", wide ? "max-w-5xl" : "max-w-2xl")}>
          <span className="flex items-center gap-1">
            <Wordmark />
            <DemoBadge />
          </span>
          <Link
            href="/profile"
            aria-label="About you"
            className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
          >
            <UserRound className="size-5" />
          </Link>
        </div>
      </header>
      <main
        className={cn(
          "relative z-10 mx-auto w-full flex-1 px-4 pb-16 pt-4 sm:px-6",
          wide ? "max-w-5xl" : "max-w-2xl",
        )}
      >
        {children}
      </main>
    </div>
  );
}
