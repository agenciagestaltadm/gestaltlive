"use client";
import { useParams } from "next/navigation";
import { ParticipantProvider } from "@/components/participant/participant-context";
import { ParticipantShell } from "@/components/participant/participant-shell";

export default function ParticipantLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ codigo: string }>();
  const code = String(params.codigo ?? "").toUpperCase();
  return (
    <ParticipantProvider code={code}>
      <ParticipantShell>{children}</ParticipantShell>
    </ParticipantProvider>
  );
}
