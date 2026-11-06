import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/services/api";

/** Inline error: says what happened and what to do, without apologising. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.payload.message : error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-xl border border-error/35 bg-error/8 px-3.5 py-3 text-body text-ink ${className ?? ""}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" />
      <p className="min-w-0 break-words">{message}</p>
    </div>
  );
}
