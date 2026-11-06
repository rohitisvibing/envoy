"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Approval } from "@/types/api";
import { APPROVAL_LABEL } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
        className="mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border-line bg-elevated px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 sm:bottom-6 sm:rounded-3xl sm:border"
      >
        <div className="flex items-center gap-2 text-warning">
          <ShieldAlert className="size-4" />
          <span className="text-meta font-medium">{APPROVAL_LABEL[approval.kind]}</span>
        </div>
        <SheetTitle className="text-title font-semibold tracking-[-0.015em] text-ink">The agent is waiting for you</SheetTitle>
        <SheetDescription className="text-body text-ink-2">{approval.reason}</SheetDescription>

        <dl className="space-y-4">
          <div>
            <dt className="text-meta text-ink-2">They said</dt>
            <dd className="mt-1 text-lead text-ink">{approval.request}</dd>
          </div>
          <div>
            <dt className="text-meta text-ink-2">The agent wants to say</dt>
            <dd className="mt-1 rounded-xl border-l-2 border-violet bg-bg/60 px-3.5 py-2.5 text-lead text-ink">{approval.proposed}</dd>
          </div>
        </dl>

        {writing ? (
          <div className="space-y-3">
            <label htmlFor="alt" className="text-meta text-ink-2">
              What should the agent say or do instead?
            </label>
            <Textarea id="alt" autoFocus value={alt} onChange={(e) => setAlt(e.target.value)} className="min-h-24 bg-bg" placeholder="Offer ₹31,000 if they include maintenance." />
            <div className="flex gap-2">
              <Button className="h-11 flex-1" disabled={!alt.trim()} onClick={() => decide("alternative", alt.trim())}>
                Send instead
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setWriting(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12 bg-success text-bg hover:bg-success/90" onClick={() => decide("approved")}>
              Approve
            </Button>
            <Button variant="secondary" className="h-12" onClick={() => decide("rejected")}>
              Reject
            </Button>
            <Button variant="ghost" className="col-span-2 h-11 text-ink-2" onClick={() => setWriting(true)}>
              Tell it what to say instead
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
