/**
 * Autorização por organização e papel. Sempre aplicada no backend.
 *
 * Matriz de permissões:
 *  - SUPERADMIN: tudo, em todas as organizações.
 *  - ORG_ADMIN: tudo dentro da própria organização.
 *  - SPEAKER: leitura de eventos e controle ao vivo das sessões da organização.
 *
 * Acesso a entidades de outra organização responde 404 (não revela a existência do recurso).
 */
import type { Actor, Role } from "./auth";
import { forbidden, notFound } from "../lib/errors";

export type Permission =
  | "org.manage"
  | "members.manage"
  | "event.read"
  | "event.write"
  | "session.create"
  | "session.control"
  | "reports.read"
  | "participants.read"
  | "participants.manage"
  | "results.review"
  | "prizes.deliver"
  | "audit.read";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ORG_ADMIN: [
    "members.manage",
    "event.read",
    "event.write",
    "session.create",
    "session.control",
    "reports.read",
    "participants.read",
    "participants.manage",
    "results.review",
    "prizes.deliver",
    "audit.read",
  ],
  SPEAKER: ["event.read", "session.create", "session.control"],
};

export function roleIn(actor: Actor, orgId: string): Role | null {
  return actor.memberships.find((m) => m.orgId === orgId)?.role ?? null;
}

export function can(actor: Actor, orgId: string, perm: Permission): boolean {
  if (actor.user.isSuperadmin) return true;
  if (perm === "org.manage") return false;
  const role = roleIn(actor, orgId);
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** Lança 404 se o usuário não pertence à organização, 403 se o papel não permite a ação. */
export function authorize(actor: Actor, orgId: string, perm: Permission): void {
  if (actor.user.isSuperadmin) return;
  if (perm === "org.manage") throw forbidden("Apenas superadministradores podem realizar esta ação.");
  const role = roleIn(actor, orgId);
  if (!role) throw notFound();
  if (!ROLE_PERMISSIONS[role].includes(perm)) throw forbidden();
}

export function requireSuperadmin(actor: Actor) {
  if (!actor.user.isSuperadmin) throw forbidden("Apenas superadministradores podem realizar esta ação.");
}

export function permissionsFor(actor: Actor, orgId: string): Permission[] {
  if (actor.user.isSuperadmin) return [...ROLE_PERMISSIONS.ORG_ADMIN, "org.manage"];
  const role = roleIn(actor, orgId);
  return role ? ROLE_PERMISSIONS[role] : [];
}
