"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Radio,
  Users,
  BarChart3,
  Library,
  LayoutTemplate,
  Settings,
  Building2,
  LogOut,
  Menu as MenuIcon,
  X,
  Moon,
  Sun,
  ChevronsUpDown,
} from "lucide-react";
import { AdminProvider, useAdmin, type Permission } from "./admin-context";
import { GestaltLogo, ProductMark } from "@/components/brand";
import { Menu, MenuContent, MenuItem, MenuTrigger, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: Permission; superadmin?: boolean }[] = [
  { href: "/admin", label: "Painel", icon: LayoutDashboard },
  { href: "/admin/eventos", label: "Eventos", icon: CalendarDays, perm: "event.read" },
  { href: "/admin/sessoes", label: "Sessões", icon: Radio, perm: "session.control" },
  { href: "/admin/participantes", label: "Participantes", icon: Users, perm: "participants.read" },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3, perm: "reports.read" },
  { href: "/admin/banco", label: "Banco de questões", icon: Library, perm: "event.read" },
  { href: "/admin/templates", label: "Templates", icon: LayoutTemplate, perm: "event.read" },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
  { href: "/admin/organizacoes", label: "Organizações", icon: Building2, superadmin: true },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("gestalt-live:tema");
    } catch {
      /* ignore */
    }
    const d = saved ? saved === "escuro" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(d);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return {
    dark,
    toggle: () => {
      setDark((d) => {
        try {
          localStorage.setItem("gestalt-live:tema", d ? "claro" : "escuro");
        } catch {
          /* ignore */
        }
        return !d;
      });
    },
  };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, can, orgs, org, setOrgId } = useAdmin();
  const path = usePathname();
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-5 py-5">
        <ProductMark />
      </div>
      <div className="px-3">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-left hover:bg-white/10" aria-label="Trocar organização">
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-white/50">Organização</span>
                <span className="block truncate text-sm font-bold">{org.name}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-64">
            {orgs.map((o) => (
              <MenuItem key={o.id} onSelect={() => setOrgId(o.id)} className={cn(o.id === org.id && "font-black text-brand")}>
                {o.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Navegação principal">
        {NAV.filter((n) => (n.superadmin ? me.user.isSuperadmin : !n.perm || can(n.perm))).map((n) => {
          const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition",
                active ? "bg-brand text-white shadow-lg shadow-brand/25" : "text-white/75 hover:bg-white/5 hover:text-white",
              )}
            >
              <n.icon className="size-[18px]" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-brand/20 font-black text-brand">{me.user.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{me.user.name}</div>
            <div className="truncate text-xs text-white/50">{me.user.email}</div>
          </div>
          <button onClick={logout} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sair">
            <LogOut className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex justify-center opacity-60">
          <GestaltLogo className="h-7" />
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
          <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <MenuIcon className="size-5" />
          </button>
          <div className="flex-1" />
          <button onClick={theme.toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={theme.dark ? "Usar tema claro" : "Usar tema escuro"}>
            {theme.dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function AdminShell({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  return (
    <AdminProvider
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <Spinner className="size-8" />
        </div>
      }
    >
      {bare ? children : <Shell>{children}</Shell>}
    </AdminProvider>
  );
}

export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-bold text-muted-foreground hover:text-brand">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-black tracking-tight lg:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
