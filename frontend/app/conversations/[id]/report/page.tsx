import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { OutcomeReportView } from "@/components/conversation/OutcomeReport";

export default function ReportPage({ params }: PageProps<"/conversations/[id]/report">) {
  return (
    <AppShell glow={null}>
      <Suspense fallback={null}>
        {params.then(({ id }) => (
          <OutcomeReportView id={id} />
        ))}
      </Suspense>
    </AppShell>
  );
}
