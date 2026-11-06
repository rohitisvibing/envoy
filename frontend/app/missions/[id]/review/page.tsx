import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { MissionReview } from "@/components/mission-builder/MissionReview";

export default function ReviewPage({ params }: PageProps<"/missions/[id]/review">) {
  return (
    <AppShell>
      <Suspense fallback={<p className="text-ink-3">Loading mission…</p>}>
        {params.then(({ id }) => (
          <MissionReview id={id} />
        ))}
      </Suspense>
    </AppShell>
  );
}
