"use client";
import { useEffect, useMemo, useState } from "react";
import { Gift, Save, Trophy, Undo2 } from "lucide-react";
import { prizeInputSchema, type PrizeInput } from "@shared/schemas";
import { admin } from "@/lib/api";
import { fieldErrors } from "@/lib/hooks";
import { cn, fmtMoney } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { useEventData } from "@/components/admin/event-context";
import { ImageUpload } from "@/components/admin/image-upload";
import type { PrizeRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

interface Draft {
  name: string;
  description: string;
  imageUrl: string;
  value: string;
  eligibility: string;
  pickupInfo: string;
}

const RANKS = [
  { rank: 1, label: "1º lugar", medal: "Ouro", ring: "border-gold/60", chip: "bg-gold text-navy-950", text: "text-gold" },
  { rank: 2, label: "2º lugar", medal: "Prata", ring: "border-silver/60", chip: "bg-silver text-navy-950", text: "text-silver" },
  { rank: 3, label: "3º lugar", medal: "Bronze", ring: "border-bronze/60", chip: "bg-bronze text-white", text: "text-bronze" },
] as const;

const centsToInput = (c: number | null) => (c === null || c === undefined ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** "1.234,56" | "1234.5" | "R$ 50" → centavos (ou null se vazio / NaN se inválido). */
function inputToCents(v: string): number | null {
  const s = v.replace(/[R$\s]/g, "");
  if (!s) return null;
  let norm = s;
  if (s.includes(",")) norm = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, "");
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

const toDraft = (p?: PrizeRow): Draft => ({
  name: p?.name ?? "",
  description: p?.description ?? "",
  imageUrl: p?.imageUrl ?? "",
  value: centsToInput(p?.estimatedValueCents ?? null),
  eligibility: p?.eligibility ?? "",
  pickupInfo: p?.pickupInfo ?? "",
});

const isEmpty = (d: Draft) => !d.name.trim() && !d.description.trim() && !d.imageUrl && !d.value.trim() && !d.eligibility.trim() && !d.pickupInfo.trim();

function Preview({ drafts }: { drafts: Record<number, Draft> }) {
  const list = RANKS.filter((r) => drafts[r.rank].name.trim());
  return (
    <div className="dark rounded-2xl bg-navy-950 p-5 text-white shadow-xl">
      <div className="mb-4 flex items-center gap-2">
        <Gift className="size-5 text-gold" aria-hidden />
        <p className="font-black">Prêmios de hoje</p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-white/60">Os prêmios cadastrados aparecerão aqui para os participantes.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const d = drafts[r.rank];
            const cents = inputToCents(d.value);
            return (
              <li key={r.rank} className={cn("flex items-center gap-3 rounded-xl border bg-white/5 p-3", r.ring)}>
                <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                  {d.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Trophy className={cn("size-6", r.text)} aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-black uppercase", r.chip)}>{r.label}</span>
                  <p className="mt-1 truncate font-black">{d.name}</p>
                  {d.description && <p className="line-clamp-2 text-xs text-white/70">{d.description}</p>}
                  {cents !== null && !Number.isNaN(cents) && cents > 0 && <p className="text-xs text-white/60">Valor estimado: {fmtMoney(cents)}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function EventPrizesPage() {
  const { event, reload } = useEventData();
  const { orgId, can } = useAdmin();
  const readOnly = !can("event.write");
  const initial = useMemo(() => {
    const out: Record<number, Draft> = {};
    for (const r of RANKS) out[r.rank] = toDraft(event.prizes.find((p) => p.rank === r.rank));
    return out;
  }, [event.prizes]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDrafts(initial);
  }, [initial]);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const set = (rank: number, k: keyof Draft, v: string) => setDrafts((d) => ({ ...d, [rank]: { ...d[rank], [k]: v } }));

  const save = async () => {
    const errs: Record<string, string> = {};
    const payload: PrizeInput[] = [];
    for (const r of RANKS) {
      const d = drafts[r.rank];
      if (isEmpty(d)) continue;
      const cents = inputToCents(d.value);
      if (Number.isNaN(cents)) {
        errs[`${r.rank}.value`] = "Valor inválido (ex.: 1.500,00)";
        continue;
      }
      const parsed = prizeInputSchema.safeParse({
        rank: r.rank,
        name: d.name,
        description: d.description,
        imageUrl: d.imageUrl,
        estimatedValueCents: cents,
        eligibility: d.eligibility,
        pickupInfo: d.pickupInfo,
      });
      if (!parsed.success) {
        for (const i of parsed.error.issues) {
          const k = String(i.path[0]);
          errs[`${r.rank}.${k === "estimatedValueCents" ? "value" : k}`] ??= i.message;
        }
      } else payload.push(parsed.data);
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Revise os campos destacados.");
      return;
    }
    setSaving(true);
    try {
      await admin.put(`/events/${event.id}/prizes`, payload);
      toast.success(payload.length ? "Prêmios salvos." : "Prêmios removidos.");
      await reload();
    } catch (e) {
      const fe = fieldErrors(e);
      const mapped: Record<string, string> = {};
      for (const [p, m] of Object.entries(fe)) {
        const [idx, k] = p.split(".");
        const rank = payload[Number(idx)]?.rank;
        if (rank) mapped[`${rank}.${k === "estimatedValueCents" ? "value" : k}`] = m;
      }
      setErrors(mapped);
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar os prêmios.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Defina os prêmios do pódio. Deixe um cartão em branco para não oferecer prêmio àquela colocação. Os vencedores são definidos pelo ranking oficial ao finalizar a sessão.
        </p>
        {RANKS.map((r) => {
          const d = drafts[r.rank];
          const err = (k: string) => errors[`${r.rank}.${k}`];
          const id = (k: string) => `prize-${r.rank}-${k}`;
          return (
            <Card key={r.rank} className={cn("border-2", r.ring)}>
              <CardHeader className="flex-row items-center gap-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-full font-black", r.chip)} aria-hidden>
                  {r.rank}º
                </span>
                <div>
                  <CardTitle>{r.label}</CardTitle>
                  <CardDescription>Medalha de {r.medal.toLowerCase()}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <fieldset disabled={readOnly || saving} className="grid gap-4 md:grid-cols-2">
                  <Field label="Nome do prêmio" htmlFor={id("name")} required={!isEmpty(d)} error={err("name")}>
                    <Input id={id("name")} value={d.name} maxLength={120} onChange={(e) => set(r.rank, "name", e.target.value)} aria-invalid={!!err("name")} placeholder="Ex.: Fone Bluetooth" />
                  </Field>
                  <Field label="Valor estimado (R$)" htmlFor={id("value")} error={err("value")} hint="Uso interno e relatórios.">
                    <Input id={id("value")} value={d.value} inputMode="decimal" onChange={(e) => set(r.rank, "value", e.target.value)} aria-invalid={!!err("value")} placeholder="0,00" />
                  </Field>
                  <Field label="Descrição" htmlFor={id("description")} error={err("description")} className="md:col-span-2">
                    <Textarea id={id("description")} rows={2} maxLength={1000} value={d.description} onChange={(e) => set(r.rank, "description", e.target.value)} aria-invalid={!!err("description")} />
                  </Field>
                  <Field label="Imagem" htmlFor={id("image")} error={err("imageUrl")} className="md:col-span-2">
                    <ImageUpload id={id("image")} orgId={orgId} value={d.imageUrl} onChange={(v) => set(r.rank, "imageUrl", v)} disabled={readOnly} label="imagem" invalid={!!err("imageUrl")} />
                  </Field>
                  <Field label="Regras de elegibilidade" htmlFor={id("eligibility")} error={err("eligibility")}>
                    <Textarea id={id("eligibility")} rows={3} maxLength={1000} value={d.eligibility} onChange={(e) => set(r.rank, "eligibility", e.target.value)} placeholder="Ex.: presença até o fim do treinamento" />
                  </Field>
                  <Field label="Informações de retirada" htmlFor={id("pickup")} error={err("pickupInfo")}>
                    <Textarea id={id("pickup")} rows={3} maxLength={1000} value={d.pickupInfo} onChange={(e) => set(r.rank, "pickupInfo", e.target.value)} placeholder="Ex.: retirar no balcão ao final" />
                  </Field>
                </fieldset>
                {!readOnly && !isEmpty(d) && (
                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setDrafts((x) => ({ ...x, [r.rank]: toDraft() }))}>
                      Limpar cartão
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="mr-auto text-sm text-muted-foreground">Alterações não salvas</span>}
            {dirty && (
              <Button variant="ghost" onClick={() => setDrafts(initial)} disabled={saving}>
                <Undo2 /> Descartar
              </Button>
            )}
            <Button size="lg" onClick={save} loading={saving} disabled={!dirty}>
              <Save /> Salvar prêmios
            </Button>
          </div>
        )}
      </div>
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Prévia no celular do participante</p>
        <Preview drafts={drafts} />
      </aside>
    </div>
  );
}
