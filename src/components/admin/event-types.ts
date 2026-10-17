/** Tipos das respostas da API usados nas telas de eventos, sessões e templates (admin). */
import {
  eventSettingsSchema,
  registrationConfigSchema,
  type CustomFieldInput,
  type EventInput,
  type EventSettings,
  type RegistrationConfig,
  type SessionStatus,
} from "@shared/schemas";

export interface CustomFieldRow extends CustomFieldInput {
  id: string;
  position: number;
}

export interface PrizeRow {
  id: string;
  rank: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  estimatedValueCents: number | null;
  eligibility: string | null;
  pickupInfo: string | null;
}

/** GET /events/:id */
export interface EventDetail {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  location: string | null;
  speakerUserId: string | null;
  speakerName: string | null;
  logoUrl: string | null;
  welcomeMessage: string | null;
  closingMessage: string | null;
  theme: { primary?: string; secondary?: string };
  registration: unknown;
  settings: unknown;
  templateId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customFields: CustomFieldRow[];
  prizes: PrizeRow[];
  questionCount: number;
  speaker: { id: string; name: string } | null;
}

/** GET /events?orgId= */
export interface EventListRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  location: string | null;
  speakerName: string | null;
  speakerUserId: string | null;
  logoUrl: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  sessionCount: number;
  liveCount: number;
}

/** GET /events/:id/sessions */
export interface EventSessionRow {
  id: string;
  name: string;
  code: string;
  status: SessionStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  participants: number;
}

/** GET /sessions?orgId= */
export interface OrgSessionRow {
  id: string;
  name: string;
  code: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  eventId: string;
  eventTitle: string;
  speakerName: string | null;
  speakerUserId: string | null;
  participants: number;
}

/** GET /sessions/:id */
export interface SessionAdminDetail {
  id: string;
  name: string;
  code: string;
  status: SessionStatus;
  scheduledAt: string | null;
  event: { id: string; title: string; speakerName: string | null };
  participants: number;
  questionCount: number;
  joinUrl: string;
  screenUrl: string;
}

/** GET /templates?orgId= */
export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  questionCount: number;
  createdAt: string;
}

/** GET /sessions/:id/awards */
export interface AwardRow {
  id: string;
  rank: number;
  status: "PENDENTE" | "ENTREGUE" | "REVOGADO";
  awardedAt: string;
  deliveredAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  prize: { name: string; description?: string | null; imageUrl?: string | null } | null;
  displayName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  sessionParticipantId: string;
  deliveredBy: string | null;
}

/** GET /orgs/:orgId/members */
export interface MemberRow {
  id: string;
  role: "ORG_ADMIN" | "SPEAKER";
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export const ROLE_LABELS: Record<MemberRow["role"], string> = {
  ORG_ADMIN: "Administrador da organização",
  SPEAKER: "Palestrante",
};

export const ACTIVE_SESSION_STATUSES: SessionStatus[] = ["AO_VIVO", "PAUSADA", "AGUARDANDO"];

export function parseRegistration(raw: unknown): RegistrationConfig {
  const r = registrationConfigSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const defaults = registrationConfigSchema.parse({});
  return { ...defaults, ...((raw as Partial<RegistrationConfig>) ?? {}) };
}

export function parseSettings(raw: unknown): EventSettings {
  const r = eventSettingsSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  return { ...eventSettingsSchema.parse({}), ...((raw as Partial<EventSettings>) ?? {}) };
}

/** Monta o objeto completo esperado por PUT /events/:id a partir do evento carregado. */
export function eventToInput(ev: EventDetail, patch: Partial<EventInput> = {}): EventInput {
  return {
    title: ev.title,
    description: ev.description,
    startsAt: ev.startsAt ? new Date(ev.startsAt).toISOString() : null,
    location: ev.location,
    speakerUserId: ev.speakerUserId,
    speakerName: ev.speakerName,
    logoUrl: ev.logoUrl,
    welcomeMessage: ev.welcomeMessage,
    closingMessage: ev.closingMessage,
    theme: ev.theme ?? {},
    registration: parseRegistration(ev.registration),
    settings: parseSettings(ev.settings),
    ...patch,
  };
}

/** ISO → valor de <input type="datetime-local"> no fuso local. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> → ISO com fuso (ou null). */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Copia texto para a área de transferência (com alternativa para navegadores antigos). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
