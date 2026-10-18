"use client";
import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // o painel de controle ao vivo e o modo apresentador ocupam a tela inteira (sem menu lateral)
  const bare = /\/admin\/sessoes\/[^/]+\/(controle|apresentador)/.test(path);
  return <AdminShell bare={bare}>{children}</AdminShell>;
}
