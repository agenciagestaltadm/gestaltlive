import { SESSION_STATUS_LABELS, type SessionStatus } from "@shared/schemas";
import { Badge } from "@/components/ui/primitives";

const TONES: Record<SessionStatus, "brand" | "warning" | "muted" | "outline" | "default"> = {
  RASCUNHO: "muted",
  AGENDADA: "outline",
  AGUARDANDO: "warning",
  AO_VIVO: "brand",
  PAUSADA: "warning",
  ENCERRADA: "default",
  CANCELADA: "muted",
};

/** Selo com o status da sessão (texto + cor, nunca só cor). */
export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge tone={TONES[status]} className={status === "CANCELADA" ? "line-through" : undefined}>
      {status === "AO_VIVO" && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden />}
      {SESSION_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
