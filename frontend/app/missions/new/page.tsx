import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default function NewMissionPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </AppShell>
  );
}
