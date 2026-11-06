import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { MissionComposer } from "@/components/mission-builder/MissionComposer";

export default function NewMissionPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <MissionComposer />
      </Suspense>
    </AppShell>
  );
}
