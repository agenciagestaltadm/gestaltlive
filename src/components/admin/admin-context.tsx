"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { admin } from "@/lib/api";

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

export interface Me {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  memberships: { orgId: string; orgName: string; orgSlug: string; role: "ORG_ADMIN" | "SPEAKER"; permissions: Permission[] }[];
}

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brand: { primary?: string; secondary?: string };
}

interface Ctx {
  me: Me;
  orgs: OrgRow[];
  org: OrgRow;
  orgId: string;
  setOrgId: (id: string) => void;
  can: (p: Permission) => boolean;
  role: "SUPERADMIN" | "ORG_ADMIN" | "SPEAKER";
  reloadOrgs: () => Promise<void>;
}

const AdminCtx = createContext<Ctx | null>(null);
const ORG_KEY = "gestalt-live:org";

export function AdminProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(null);

  const reloadOrgs = useCallback(async () => {
    const list = await admin.get<OrgRow[]>("/orgs");
    setOrgs(list);
  }, []);

  useEffect(() => {
    (async () => {
      const m = await admin.get<Me>("/me");
      setMe(m);
      const list = await admin.get<OrgRow[]>("/orgs");
      setOrgs(list);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(ORG_KEY);
      } catch {
        /* ignore */
      }
      const pick = list.find((o) => o.id === saved)?.id ?? list[0]?.id ?? null;
      setOrgIdState(pick);
    })().catch(() => undefined);
  }, []);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    try {
      localStorage.setItem(ORG_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!me || !orgId) return null;
    const org = orgs.find((o) => o.id === orgId);
    if (!org) return null;
    const membership = me.memberships.find((m) => m.orgId === orgId);
    const perms = new Set<Permission>(
      me.user.isSuperadmin
        ? ["org.manage", "members.manage", "event.read", "event.write", "session.create", "session.control", "reports.read", "participants.read", "participants.manage", "results.review", "prizes.deliver", "audit.read"]
        : membership?.permissions ?? [],
    );
    return {
      me,
      orgs,
      org,
      orgId,
      setOrgId,
      can: (p) => perms.has(p),
      role: me.user.isSuperadmin ? "SUPERADMIN" : membership?.role ?? "SPEAKER",
      reloadOrgs,
    };
  }, [me, orgs, orgId, setOrgId, reloadOrgs]);

  if (me && orgs.length === 0) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-black">Seu usuário ainda não está vinculado a nenhuma organização.</p>
          <p className="text-muted-foreground">Peça a um administrador para adicioná-lo.</p>
        </div>
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

export function useAdmin() {
  const c = useContext(AdminCtx);
  if (!c) throw new Error("useAdmin fora do AdminProvider");
  return c;
}
