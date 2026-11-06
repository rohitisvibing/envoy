import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { AgentPreparation } from "@/components/mission-builder/AgentPreparation";

export default function PreparePage({ params }: PageProps<"/missions/[id]/prepare">) {
  return (
    <AppShell wide>
      <Suspense fallback={null}>
        {params.then(({ id }) => (
          <AgentPreparation id={id} />
        ))}
      </Suspense>
    </AppShell>
  );
}
