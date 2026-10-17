"use client";
/** Entrada do participante: identificação da sessão, cadastro, consentimentos e recuperação de acesso. */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, MapPin, Mic2, LogIn, KeyRound, ShieldCheck, Loader2 } from "lucide-react";
import type { PublicSessionDTO } from "@shared/types";
import { ApiError, loadCredential, participantApi, publicFetch, saveCredential } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { EventLogo, ProductMark } from "@/components/brand";
import { fmtDateTime } from "@/lib/utils";

interface RegistrationForm {
  phone: { enabled: boolean; required: boolean };
  email: { enabled: boolean; required: boolean };
  uniqueness: string;
  rankingDisplay: "APELIDO" | "PRIMEIRO_NOME" | "NOME_INICIAL";
  consentVersion: string;
  consentParticipationText: string;
  marketingEnabled: boolean;
  consentMarketingText: string;
  privacyPolicyUrl: string | null;
  customFields: { id: string; key: string; label: string; type: string; options: string[]; required: boolean }[];
}

interface JoinResult {
  token: string;
  sessionParticipantId: string;
  displayName: string;
}

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

export default function EntrarPage() {
  const params = useParams<{ codigo: string }>();
  const code = String(params.codigo ?? "").toUpperCase();
  const router = useRouter();
  const [session, setSession] = useState<PublicSessionDTO | null>(null);
  const [form, setForm] = useState<RegistrationForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [values, setValues] = useState({ fullName: "", displayName: "", email: "", phone: "" });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  useEffect(() => {
    (async () => {
      // credencial já salva neste aparelho → volta direto para a sessão
      const cred = loadCredential(code);
      if (cred) {
        try {
          await participantApi(code, cred.token).me();
          router.replace(`/s/${code}/ao-vivo`);
          return;
        } catch {
          /* credencial inválida: segue para o cadastro */
        }
      }
      try {
        const [s, f] = await Promise.all([publicFetch<PublicSessionDTO>(`/public/sessions/${code}`), publicFetch<RegistrationForm>(`/public/sessions/${code}/registration`)]);
        setSession(s);
        setForm(f);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Sessão não encontrada.");
      } finally {
        setChecking(false);
      }
    })();
  }, [code, router]);

  const done = (r: JoinResult) => {
    saveCredential(code, { token: r.token, sessionParticipantId: r.sessionParticipantId, displayName: r.displayName });
    router.replace(`/s/${code}/ao-vivo`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const errs: Record<string, string> = {};
    if (values.fullName.trim().split(/\s+/).length < 2) errs.fullName = "Informe nome e sobrenome";
    if (form.email.required && !values.email.trim()) errs.email = "Informe seu e-mail";
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) errs.email = "E-mail inválido";
    if (form.phone.required && !values.phone.trim()) errs.phone = "Informe seu WhatsApp";
    if (values.phone && values.phone.replace(/\D/g, "").length < 10) errs.phone = "Inclua o DDD";
    for (const f of form.customFields) if (f.required && !custom[f.key]?.trim()) errs[`custom.${f.key}`] = `Informe ${f.label.toLowerCase()}`;
    if (!consent) errs.consent = "É necessário aceitar para participar";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await publicFetch<JoinResult>(`/public/sessions/${code}/join`, {
        method: "POST",
        json: {
          fullName: values.fullName,
          displayName: values.displayName || null,
          email: form.email.enabled ? values.email || null : null,
          phone: form.phone.enabled ? values.phone || null : null,
          custom,
          consentParticipation: true,
          consentMarketing: form.marketingEnabled ? marketing : false,
        },
      });
      done(r);
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        const m: Record<string, string> = {};
        for (const d of e.details) m[d.path] = d.message;
        setErrors(m);
      }
      setSubmitError(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  };

  const recover = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      done(await publicFetch<JoinResult>(`/public/sessions/${code}/recover`, { method: "POST", json: { recoveryCode } }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Código inválido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="dark bg-brand-hero grid min-h-dvh place-items-center text-white">
        <Loader2 className="size-8 animate-spin text-brand" aria-label="Carregando" />
      </div>
    );
  }

  if (loadError || !session || !form) {
    return (
      <div className="dark bg-brand-hero grid min-h-dvh place-items-center p-6 text-center text-white">
        <div className="max-w-sm">
          <ProductMark className="mb-6 justify-center" />
          <p className="text-xl font-black">Não encontramos esta sessão</p>
          <p className="mt-2 text-white/70">{loadError ?? "Confira o código exibido no telão."}</p>
          <Button className="mt-6" onClick={() => router.push("/")}>
            Digitar outro código
          </Button>
        </div>
      </div>
    );
  }

  const closed = session.status === "ENCERRADA" || session.status === "CANCELADA";
  const notOpen = session.status === "AGENDADA";

  return (
    <div className="dark bg-brand-hero min-h-dvh text-white">
      <div className="safe-top mx-auto flex max-w-md flex-col px-5 pb-10 pt-6">
        <div className="flex items-center justify-between">
          <EventLogo src={session.event.logoUrl} className="h-9" />
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black tracking-widest">{session.code}</span>
        </div>

        <section className="mt-8 animate-rise">
          <p className="text-sm font-bold uppercase tracking-widest text-brand">{session.organization.name}</p>
          <h1 className="mt-2 text-3xl font-black leading-tight">{session.event.title}</h1>
          <div className="mt-3 space-y-1 text-sm text-white/75">
            {session.event.speakerName && (
              <p className="flex items-center gap-2">
                <Mic2 className="size-4 text-brand" /> {session.event.speakerName}
              </p>
            )}
            {session.event.startsAt && (
              <p className="flex items-center gap-2">
                <CalendarDays className="size-4 text-brand" /> {fmtDateTime(session.event.startsAt)}
              </p>
            )}
            {session.event.location && (
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-brand" /> {session.event.location}
              </p>
            )}
          </div>
          {session.event.welcomeMessage && <p className="mt-4 rounded-2xl bg-white/5 p-4 text-[15px] leading-relaxed text-white/85">{session.event.welcomeMessage}</p>}
        </section>

        {closed ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-navy-900/70 p-6 text-center">
            <p className="text-lg font-black">Esta sessão já foi {session.status === "CANCELADA" ? "cancelada" : "encerrada"}.</p>
            <p className="mt-1 text-white/70">Obrigado pelo interesse!</p>
          </div>
        ) : notOpen ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-navy-900/70 p-6 text-center">
            <p className="text-lg font-black">As inscrições abrem em breve.</p>
            <p className="mt-1 text-white/70">Aguarde o palestrante liberar a entrada e recarregue esta página.</p>
          </div>
        ) : recovery ? (
          <form onSubmit={recover} className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-navy-900/70 p-5">
            <div className="flex items-center gap-2 font-black">
              <KeyRound className="size-5 text-brand" /> Recuperar meu acesso
            </div>
            <p className="text-sm text-white/70">Peça à equipe do evento um código de recuperação de 6 dígitos e digite abaixo. O acesso anterior será encerrado.</p>
            <Input
              inputMode="numeric"
              maxLength={6}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              aria-label="Código de recuperação"
              className="h-14 text-center text-2xl font-black tracking-[0.4em]"
            />
            {submitError && <p className="text-sm font-bold text-negative" role="alert">{submitError}</p>}
            <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={recoveryCode.length !== 6}>
              Recuperar acesso
            </Button>
            <button type="button" className="w-full text-sm font-bold text-white/70 underline" onClick={() => setRecovery(false)}>
              Voltar ao cadastro
            </button>
          </form>
        ) : (
          <form onSubmit={submit} noValidate className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-navy-900/70 p-5 shadow-2xl backdrop-blur">
            <h2 className="text-lg font-black">Identifique-se para participar</h2>
            <Field label="Nome completo" required error={errors.fullName} htmlFor="fullName">
              <Input id="fullName" autoComplete="name" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} aria-invalid={!!errors.fullName} />
            </Field>
            {form.rankingDisplay === "APELIDO" && (
              <Field label="Como quer aparecer no ranking?" hint="Apelido ou primeiro nome. Seu e-mail e WhatsApp nunca aparecem no ranking." error={errors.displayName} htmlFor="displayName">
                <Input id="displayName" maxLength={30} value={values.displayName} onChange={(e) => setValues({ ...values, displayName: e.target.value })} placeholder="Ex.: Ana da Loja" />
              </Field>
            )}
            {form.phone.enabled && (
              <Field label="WhatsApp" required={form.phone.required} error={errors.phone} htmlFor="phone">
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98888-7777" value={values.phone} onChange={(e) => setValues({ ...values, phone: maskPhone(e.target.value) })} aria-invalid={!!errors.phone} />
              </Field>
            )}
            {form.email.enabled && (
              <Field label="E-mail" required={form.email.required} error={errors.email} htmlFor="email">
                <Input id="email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value.trim() })} aria-invalid={!!errors.email} />
              </Field>
            )}
            {form.customFields.map((f) => {
              const err = errors[`custom.${f.key}`];
              const set = (v: string) => setCustom({ ...custom, [f.key]: v });
              return (
                <Field key={f.id} label={f.label} required={f.required} error={err} htmlFor={`cf-${f.key}`}>
                  {f.type === "SELECAO" ? (
                    <NativeSelect id={`cf-${f.key}`} value={custom[f.key] ?? ""} onChange={(e) => set(e.target.value)} aria-invalid={!!err}>
                      <option value="">Selecione…</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : f.type === "TEXTO_LONGO" ? (
                    <Textarea id={`cf-${f.key}`} value={custom[f.key] ?? ""} onChange={(e) => set(e.target.value)} aria-invalid={!!err} />
                  ) : (
                    <Input
                      id={`cf-${f.key}`}
                      type={f.type === "EMAIL" ? "email" : f.type === "TELEFONE" ? "tel" : "text"}
                      inputMode={f.type === "NUMERO" ? "decimal" : undefined}
                      value={custom[f.key] ?? ""}
                      onChange={(e) => set(e.target.value)}
                      aria-invalid={!!err}
                    />
                  )}
                </Field>
              );
            })}

            <div className="space-y-3 rounded-xl bg-white/5 p-3 text-sm">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[#FF0068]" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={!!errors.consent} />
                <span>
                  {form.consentParticipationText} <span className="text-brand">*</span>
                  {form.privacyPolicyUrl && (
                    <>
                      {" "}
                      <a href={form.privacyPolicyUrl} target="_blank" rel="noreferrer" className="font-bold text-brand underline">
                        Política de Privacidade
                      </a>
                    </>
                  )}
                </span>
              </label>
              {errors.consent && <p className="text-xs font-bold text-negative">{errors.consent}</p>}
              {form.marketingEnabled && (
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[#FF0068]" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                  <span className="text-white/80">
                    {form.consentMarketingText} <span className="text-white/50">(opcional)</span>
                  </span>
                </label>
              )}
              <p className="flex items-center gap-1.5 text-xs text-white/50">
                <ShieldCheck className="size-3.5" /> Termos versão {form.consentVersion}. Não pedimos senha.
              </p>
            </div>

            {submitError && (
              <p className="rounded-xl bg-negative/15 px-3 py-2 text-sm font-bold text-negative" role="alert">
                {submitError}
              </p>
            )}
            <Button type="submit" size="xl" className="w-full" loading={submitting}>
              <LogIn /> Entrar no treinamento
            </Button>
            <button type="button" className="w-full text-sm font-bold text-white/60 underline" onClick={() => setRecovery(true)}>
              Já me inscrevi em outro aparelho
            </button>
          </form>
        )}
        <div className="mt-8 flex justify-center opacity-70">
          <ProductMark className="text-base" />
        </div>
      </div>
    </div>
  );
}
