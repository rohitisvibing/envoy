"use client";

import { useState } from "react";
import { PenLine } from "lucide-react";
import type { Approval } from "@/types/api";
import { APPROVAL_LABEL } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

export function ApprovalSheet({
  approval,
  open,
  onOpenChange,
  onDecide,
}: {
  approval: Approval | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDecide: (decision: "approved" | "rejected" | "alternative", alt?: string) => void;
}) {
  const [alt, setAlt] = useState("");
  const [writing, setWriting] = useState(false);
  if (!approval) return null;
  const decide = (d: "approved" | "rejected" | "alternative", text?: string) => {
    onDecide(d, text);
    setAlt("");
    setWriting(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] w-full max-w-xl gap-5 overflow-y-auto rounded-t-[2rem] border-0 bg-surface px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 ring-1 ring-warning/30 sm:bottom-6 sm:rounded-[2rem]"
      >
        <div>
          <SheetTitle className="font-serif text-[2rem] font-normal leading-none text-ink">Your call</SheetTitle>
          <SheetDescription className="mt-2 text-meta text-warning">{APPROVAL_LABEL[approval.kind]}</SheetDescription>
        </div>

        <div className="space-y-3">
          {approval.request && (
            <p className="border-r-2 border-ember/70 pr-3.5 text-right text-lead text-ember">
              <span className="sr-only">They said: </span>
              {approval.request}
              {approval.request_en && <span lang="en" className="mt-1 block text-body text-ink-2">{approval.request_en}</span>}
            </p>
          )}
          <p className="border-l-2 border-aurora/70 pl-3.5 text-lead text-ink">
            <span className="sr-only">The agent wants to say: </span>
            {approval.proposed}
            {approval.proposed_en && <span lang="en" className="mt-1 block text-body text-ink-2">{approval.proposed_en}</span>}
          </p>
          <p className="text-meta text-ink-2">{approval.reason}</p>
        </div>

        {writing ? (
          <div className="space-y-3">
            <label htmlFor="alt" className="sr-only">
              What should the agent say instead?
            </label>
            <textarea
              id="alt"
              autoFocus
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              className="min-h-24 w-full resize-none rounded-2xl bg-bg/60 px-4 py-3 text-body text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-aurora/50"
              placeholder="Offer ₹31,000 if maintenance is included."
            />
            <div className="flex gap-2">
              <Button className="h-12 flex-1 rounded-full" disabled={!alt.trim()} onClick={() => decide("alternative", alt.trim())}>
                Say this instead
              </Button>
              <Button variant="ghost" className="h-12 rounded-full" onClick={() => setWriting(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button className="h-12 flex-1 rounded-full bg-success text-bg hover:bg-success/90" onClick={() => decide("approved")}>
              Approve
            </Button>
            <Button variant="secondary" className="h-12 flex-1 rounded-full" onClick={() => decide("rejected")}>
              Decline
            </Button>
            <IconButton label="Say something else" icon={PenLine} className="size-12" onClick={() => setWriting(true)} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
