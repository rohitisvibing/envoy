import { AppShell } from "@/components/shell/AppShell";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default function Home() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
