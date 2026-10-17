"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, MinusCircle, LogOut, Save } from "lucide-react";
import { useParticipant } from "@/components/participant/participant-context";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { clearCredential } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/utils";

interface Profile {
  displayName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  custom: { key: string; label: string; value: string }[];
  canEditDisplayName: boolean;
  marketingEnabled: boolean;
  marketingConsent: boolean;
  consentMarketingText: string;
  joinedAt: string;
}

interface HistoryItem {
  sessionQuestionId: string;
  position: number;
  title: string;
  answer: string;
  scored: boolean;
  isCorrect: boolean | null;
  points: number | null;
  correctAnswer: string | null;
  explanation: string | null;
}

export default function PerfilPage() {
  const { api, state, code, reload } = useParticipant();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.profile<Profile>().then((p) => {
      setProfile(p);
      setName(p.displayName);
    });
    void api.history<HistoryItem[]>().then(setHistory);
  }, [api]);

  const saveName = async () => {
    setSaving(true);
    try {
      const r = await api.updateProfile<{ displayName: string }>(name);
      setProfile((p) => (p ? { ...p, displayName: r.displayName } : p));
      toast.success("Nome no ranking atualizado.");
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const setMarketing = async (v: boolean) => {
    try {
      await api.marketing(v);
      setProfile((p) => (p ? { ...p, marketingConsent: v } : p));
      toast.success(v ? "Consentimento registrado." : "Consentimento de comunicações revogado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    }
  };

  const leave = () => {
    if (!confirm("Sair deste aparelho? Para voltar você precisará de um código de recuperação da equipe do evento.")) return;
    clearCredential(code);
    router.replace(`/entrar/${code}`);
  };

  return (
    <div className="space-y-4 animate-rise">
      <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-full bg-brand text-2xl font-black">{(profile?.displayName ?? state?.me.displayName ?? "?").slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate text-lg font-black">{profile?.fullName ?? "…"}</p>
            <p className="text-sm text-white/60">{fmtInt(state?.me.score ?? 0)} pontos · {fmtInt(state?.me.correctCount ?? 0)} acertos</p>
          </div>
        </div>
        {profile && (
          <div className="mt-4 space-y-3 text-sm">
            {profile.canEditDisplayName && (
              <div>
                <label htmlFor="dn" className="text-xs font-bold uppercase text-white/60">
                  Nome no ranking
                </label>
                <div className="mt-1 flex gap-2">
                  <Input id="dn" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
                  <Button onClick={saveName} loading={saving} disabled={name.trim().length < 2 || name === profile.displayName} aria-label="Salvar nome">
                    <Save />
                  </Button>
                </div>
              </div>
            )}
            <dl className="grid grid-cols-1 gap-2">
              {profile.email && (
                <div className="flex justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <dt className="text-white/60">E-mail</dt>
                  <dd className="truncate font-bold">{profile.email}</dd>
                </div>
              )}
              {profile.phone && (
                <div className="flex justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <dt className="text-white/60">WhatsApp</dt>
                  <dd className="font-bold">{profile.phone}</dd>
                </div>
              )}
              {profile.custom.map((c) => (
                <div key={c.key} className="flex justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <dt className="text-white/60">{c.label}</dt>
                  <dd className="truncate font-bold">{c.value}</dd>
                </div>
              ))}
            </dl>
            {profile.marketingEnabled && (
              <div className="rounded-xl bg-white/5 p-3">
                <Switch checked={profile.marketingConsent} onCheckedChange={setMarketing} label={<span className="text-sm">Receber conteúdos e comunicações</span>} />
                <p className="mt-2 text-xs text-white/50">{profile.consentMarketingText}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-black">Meu histórico</h2>
        {history === null ? (
          <p className="text-white/60">Carregando…</p>
        ) : history.length === 0 ? (
          <p className="rounded-2xl bg-white/5 p-6 text-center text-white/60">Você ainda não respondeu perguntas.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.sessionQuestionId} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start gap-3">
                  {h.isCorrect === true ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" aria-label="Correta" />
                  ) : h.isCorrect === false ? (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-negative" aria-label="Incorreta" />
                  ) : (
                    <MinusCircle className="mt-0.5 size-5 shrink-0 text-white/40" aria-label="Sem correção" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">
                      {h.position + 1}. {h.title}
                    </p>
                    <p className="text-sm text-white/70">Sua resposta: {h.answer}</p>
                    {h.correctAnswer && <p className="text-sm text-positive">Correta: {h.correctAnswer}</p>}
                  </div>
                  {h.points !== null && <span className="text-sm font-black tabular text-brand">+{h.points}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-center text-xs text-white/50">Inscrito em {fmtDateTime(profile?.joinedAt)}</p>
      <Button variant="ghost" className="w-full text-white/70 hover:bg-white/10" onClick={leave}>
        <LogOut /> Sair deste aparelho
      </Button>
    </div>
  );
}
