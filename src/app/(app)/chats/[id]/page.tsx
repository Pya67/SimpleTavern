import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ChatView key={id} chatId={id} />
    </Suspense>
  );
}
