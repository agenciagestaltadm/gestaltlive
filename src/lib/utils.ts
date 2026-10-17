import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
export const fmtPct = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const fmtDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
export const fmtMoney = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ordinal(n: number | null | undefined) {
  return n ? `${n}º` : "—";
}

export function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
