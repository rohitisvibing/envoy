"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutList, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "@/components/orb/StatusGlyph";
import { DemoBadge } from "./DemoBadge";

const NAV = [
  { href: "/", label: "Missions", icon: LayoutList },
  { href: "/missions/new", label: "New mission", icon: Plus },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function active(path: string | null, href: string) {
  if (path == null) return false;
  return href === "/" ? path === "/" : path.startsWith(href);
}

function DesktopLinks({ path }: { path: string | null }) {
  return NAV.map(({ href, label }) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "rounded-lg px-3 py-1.5 text-meta text-ink-2 transition-colors hover:text-ink",
        active(path, href) && "bg-elevated text-ink",
      )}
    >
      {label}
    </Link>
  ));
}

function MobileLinks({ path }: { path: string | null }) {
  return NAV.map(({ href, label, icon: Icon }) => (
    <li key={href}>
      <Link
        href={href}
        className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] text-ink-2", active(path, href) && "text-ink")}
      >
        {href === "/missions/new" ? (
          <span className="grid size-9 place-items-center rounded-full bg-ink text-bg">
            <Icon className="size-5" />
          </span>
        ) : (
          <Icon className="size-5" />
        )}
        <span className={href === "/missions/new" ? "sr-only" : undefined}>{label}</span>
      </Link>
    </li>
  ));
}

function WithPath({ render }: { render: (path: string | null) => React.ReactNode }) {
  return render(usePathname());
}

/** Pathname is request data; stream the active state in so routes can prerender. */
function Nav({ render }: { render: (path: string | null) => React.ReactNode }) {
  return (
    <Suspense fallback={render(null)}>
      <WithPath render={render} />
    </Suspense>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md text-ink" aria-label="Envoy home">
      <StatusGlyph state="ready" size={20} label="Envoy" />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Envoy</span>
    </Link>
  );
}

/** Standard page chrome: compact top bar, bottom nav on mobile. */
export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur-md">
        <div className={cn("mx-auto flex h-14 items-center justify-between px-4 sm:px-6", wide ? "max-w-6xl" : "max-w-3xl")}>
          <Wordmark />
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            <Nav render={(path) => <DesktopLinks path={path} />} />
          </nav>
          <DemoBadge className="sm:hidden" />
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-16", wide ? "max-w-6xl" : "max-w-3xl")}>
        <DemoBadge className="mb-4 hidden sm:inline-flex" />
        {children}
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <ul className="grid grid-cols-3">
          <Nav render={(path) => <MobileLinks path={path} />} />
        </ul>
      </nav>
    </div>
  );
}
