import { Suspense } from "react";
import { Workspace } from "@/components/conversation/Workspace";

export default function ConversationPage({ params }: PageProps<"/conversations/[id]">) {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      {params.then(({ id }) => (
        <Workspace id={id} />
      ))}
    </Suspense>
  );
}
