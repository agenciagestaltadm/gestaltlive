"use client";
/** Ranking dos termos da Nuvem de Palavras (Palavra | Frequência | Percentual) com o denominador explícito. */
import { EyeOff, Ban } from "lucide-react";
import type { WordCloudResultsDTO } from "@shared/types";
import { cn, fmtInt } from "@/lib/utils";

export function denominatorLabel(wc: Pick<WordCloudResultsDTO, "denominator">) {
  const n = wc.denominator.value;
  return wc.denominator.kind === "TERMOS" ? `${fmtInt(n)} ${n === 1 ? "termo contabilizado" : "termos contabilizados"}` : `${fmtInt(n)} ${n === 1 ? "resposta aprovada" : "respostas aprovadas"}`;
}

export function WordCloudTable({
  data,
  limit = 15,
  theme = "light",
  onHide,
  onBlock,
  busyTerm,
  className,
}: {
  data: WordCloudResultsDTO;
  limit?: number;
  theme?: "light" | "dark";
  onHide?: (term: string) => void;
  onBlock?: (term: string) => void;
  busyTerm?: string | null;
  className?: string;
}) {
  const dark = theme === "dark";
  const rows = data.terms.slice(0, limit);
  const actions = !!(onHide || onBlock);
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <caption className={cn("mb-2 text-left text-xs font-bold", dark ? "text-white/60" : "text-muted-foreground")}>
          Percentual sobre {denominatorLabel(data)}
          {data.terms.length > limit && ` · mostrando ${limit} de ${fmtInt(data.totals.uniqueTerms)} termos`}
        </caption>
        <thead>
          <tr className={cn("text-left text-xs uppercase tracking-wider", dark ? "text-white/50" : "text-muted-foreground")}>
            <th className="w-8 py-1 pr-2 font-black">#</th>
            <th className="py-1 pr-2 font-black">Palavra</th>
            <th className="py-1 pr-2 text-right font-black">Frequência</th>
            <th className="py-1 pr-2 text-right font-black">Percentual</th>
            {actions && <th className="py-1 text-right font-black">Moderação</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={actions ? 5 : 4} className={cn("py-3 text-center font-bold", dark ? "text-white/50" : "text-muted-foreground")}>
                Nenhuma palavra ainda.
              </td>
            </tr>
          )}
          {rows.map((t, i) => (
            <tr key={t.key} className={cn("border-t", dark ? "border-white/10" : "border-border")}>
              <td className={cn("py-1.5 pr-2 tabular font-bold", dark ? "text-white/50" : "text-muted-foreground")}>{i + 1}</td>
              <td className="max-w-[18rem] truncate py-1.5 pr-2 font-bold" title={t.label}>
                {t.label}
              </td>
              <td className="py-1.5 pr-2 text-right tabular font-black">{fmtInt(t.count)}</td>
              <td className="py-1.5 pr-2 text-right tabular">{t.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
              {actions && (
                <td className="py-1 text-right">
                  <span className="inline-flex gap-1">
                    {onHide && (
                      <button
                        type="button"
                        onClick={() => onHide(t.label)}
                        disabled={busyTerm === t.label}
                        className={cn("rounded-md p-1.5 hover:bg-muted disabled:opacity-50", dark && "hover:bg-white/10")}
                        aria-label={`Ocultar "${t.label}" da nuvem`}
                        title="Ocultar da nuvem"
                      >
                        <EyeOff className="size-4" />
                      </button>
                    )}
                    {onBlock && (
                      <button
                        type="button"
                        onClick={() => onBlock(t.label)}
                        disabled={busyTerm === t.label}
                        className={cn("rounded-md p-1.5 text-negative hover:bg-negative/10 disabled:opacity-50")}
                        aria-label={`Bloquear "${t.label}" (oculta e recusa novos envios)`}
                        title="Bloquear (oculta e recusa novos envios)"
                      >
                        <Ban className="size-4" />
                      </button>
                    )}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
