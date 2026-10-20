"use client";
/**
 * Estado do participante: snapshot da API + atualizações em tempo real (Socket.IO).
 * Reconexão e retorno à aba recarregam o snapshot oficial — nada depende de estado local.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  LeaderboardDTO,
  MyStandingDTO,
  MyWordCloudDTO,
  ParticipantStateDTO,
  PodiumDTO,
  PresentationDTO,
  PublicQuestionDTO,
  ResultsDTO,
} from "@shared/types";
import { RT } from "@shared/types";
import { ApiError, clearCredential, loadCredential, participantApi, type StoredCredential } from "@/lib/api";
import { useRealtime, type ConnectionStatus } from "@/lib/realtime";
import { uid } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { playSound } from "./sound";

type Answer = NonNullable<ParticipantStateDTO["myAnswer"]>;

interface Ctx {
  code: string;
  cred: StoredCredential;
  state: ParticipantStateDTO | null;
  status: ConnectionStatus;
  answeredCount: number | null;
  submitting: boolean;
  submitAnswer: (sq: PublicQuestionDTO, optionIds: string[], value: number | null) => Promise<boolean>;
  /** Envio para a Nuvem de Palavras (reenvio seguro: mesma resposta → mesma chave). */
  submitWord: (sq: PublicQuestionDTO, text: string) => Promise<boolean>;
  vote: (v: "POSITIVO" | "NEGATIVO") => Promise<void>;
  voting: boolean;
  reload: () => Promise<void>;
  api: ReturnType<typeof participantApi>;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
}

const PCtx = createContext<Ctx | null>(null);

export function useParticipant() {
  const c = useContext(PCtx);
  if (!c) throw new Error("useParticipant fora do provider");
  return c;
}

export function ParticipantProvider({ code, children }: { code: string; children: React.ReactNode }) {
  const router = useRouter();
  const [cred, setCred] = useState<StoredCredential | null>(null);
  const [state, setState] = useState<ParticipantStateDTO | null>(null);
  const [answeredCount, setAnsweredCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [soundOn, setSoundOnState] = useState(false);
  const keys = useRef(new Map<string, string>());
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeId = useRef<string | null>(null);
  activeId.current = state?.activeQuestion?.sessionQuestionId ?? null;

  useEffect(() => {
    const c = loadCredential(code);
    if (!c) router.replace(`/entrar/${code}`);
    else setCred(c);
    try {
      setSoundOnState(localStorage.getItem("gestalt-live:som") === "1");
    } catch {
      /* ignore */
    }
  }, [code, router]);

  const api = useMemo(() => participantApi(code, cred?.token ?? ""), [code, cred?.token]);

  const reload = useCallback(async () => {
    if (!cred) return;
    try {
      const s = await api.state<ParticipantStateDTO>();
      setState(s);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearCredential(code);
        toast.error("Sua credencial não é mais válida. Faça a entrada novamente.");
        router.replace(`/entrar/${code}`);
      }
    }
  }, [api, cred, code, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Recarga espaçada (evita que centenas de aparelhos consultem a API no mesmo milissegundo). */
  const jitteredReload = useCallback(
    (maxMs = 1500) => {
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      resyncTimer.current = setTimeout(() => void reload(), Math.random() * maxMs);
    },
    [reload],
  );

  const patch = useCallback((fn: (s: ParticipantStateDTO) => ParticipantStateDTO) => setState((s) => (s ? fn(s) : s)), []);

  const handlers = useMemo(
    () => ({
      [RT.questionOpened]: (q: PublicQuestionDTO) => {
        setAnsweredCount(0);
        patch((s) => ({
          ...s,
          activeQuestion: q,
          myAnswer: null,
          results: null,
          myWordCloud: q.type === "NUVEM_PALAVRAS" ? { entries: [], remaining: q.wordCloud?.maxEntries ?? 1 } : null,
        }));
        if (soundOn) playSound("open");
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(80);
      },
      [RT.questionClosed]: (d: { sessionQuestionId: string; state: PublicQuestionDTO["state"]; timer: PublicQuestionDTO["timer"] }) =>
        patch((s) => (s.activeQuestion?.sessionQuestionId === d.sessionQuestionId ? { ...s, activeQuestion: { ...s.activeQuestion, state: d.state, timer: d.timer } } : s)),
      [RT.questionTimerUpdated]: (d: { sessionQuestionId: string; state: PublicQuestionDTO["state"]; timer: PublicQuestionDTO["timer"] }) =>
        patch((s) => (s.activeQuestion?.sessionQuestionId === d.sessionQuestionId ? { ...s, activeQuestion: { ...s.activeQuestion, timer: d.timer } } : s)),
      [RT.questionResultRevealed]: (d: { sessionQuestionId: string; correctOptionIds: string[]; explanation: string | null }) => {
        let correct: boolean | null = null;
        patch((s) => {
          if (s.activeQuestion?.sessionQuestionId !== d.sessionQuestionId) return s;
          if (s.myAnswer) {
            const mine = [...s.myAnswer.optionIds].sort();
            const right = [...d.correctOptionIds].sort();
            correct = mine.length === right.length && mine.every((v, i) => v === right[i]);
          }
          return {
            ...s,
            activeQuestion: { ...s.activeQuestion, correctOptionIds: d.correctOptionIds, explanation: d.explanation, state: "RESULTADO_EXIBIDO" },
            myAnswer: s.myAnswer ? { ...s.myAnswer, isCorrect: correct } : null,
          };
        });
        setTimeout(() => {
          if (soundOn && correct !== null) playSound(correct ? "correct" : "wrong");
        }, 0);
        jitteredReload(2000);
      },
      [RT.resultsUpdated]: (r: ResultsDTO) =>
        patch((s) => (s.activeQuestion?.sessionQuestionId === r.sessionQuestionId ? { ...s, results: r } : s)),
      [RT.answersCount]: (d: { sessionQuestionId: string; answered: number }) => {
        if (activeId.current === d.sessionQuestionId) setAnsweredCount(d.answered);
      },
      [RT.leaderboardUpdated]: (lb: LeaderboardDTO) => patch((s) => ({ ...s, leaderboard: lb })),
      [RT.scoreUpdated]: (me: MyStandingDTO) =>
        patch((s) => {
          if (me.score > s.me.score && soundOn) playSound("points");
          return { ...s, me };
        }),
      [RT.presentationChanged]: (p: PresentationDTO) =>
        patch((s) => {
          // telão foi para um slide/tela sem pergunta: o celular deixa de mostrar a pergunta já encerrada,
          // mas uma pergunta ABERTA continua disponível (item no telão ≠ pergunta aberta)
          const keep = p.sessionQuestionId !== null || s.activeQuestion?.state === "ABERTA";
          return keep ? { ...s, presentation: p } : { ...s, presentation: p, activeQuestion: null, myAnswer: null, results: null };
        }),
      [RT.prizesRevealed]: (d: { podium: PodiumDTO }) => patch((s) => ({ ...s, podium: d.podium })),
      // nuvem de palavras: envio feito em outra aba ou moderado pelo palestrante
      [RT.wordCloudEntry]: (d: { sessionQuestionId?: string; entry: MyWordCloudDTO["entries"][number]; remaining?: number }) =>
        patch((s) => {
          if (!s.myWordCloud || (d.sessionQuestionId && s.activeQuestion?.sessionQuestionId !== d.sessionQuestionId)) return s;
          return { ...s, myWordCloud: mergeEntry(s.myWordCloud, d.entry, d.remaining) };
        }),
      [RT.answerAccepted]: (a: { sessionQuestionId: string; optionIds: string[]; value: number | null; revision: number }) =>
        patch((s) =>
          s.activeQuestion?.sessionQuestionId === a.sessionQuestionId
            ? { ...s, myAnswer: { optionIds: a.optionIds, value: a.value, revision: a.revision, isCorrect: null, points: null } }
            : s,
        ),
      [RT.sessionStarted]: () => jitteredReload(800),
      [RT.sessionPaused]: () => patch((s) => ({ ...s, session: { ...s.session, status: "PAUSADA" } })),
      [RT.sessionResumed]: () => patch((s) => ({ ...s, session: { ...s.session, status: "AO_VIVO" } })),
      [RT.sessionEnded]: () => jitteredReload(1500),
      [RT.resync]: () => jitteredReload(1500),
    }),
    [patch, jitteredReload, soundOn],
  );

  const status = useRealtime({
    auth: cred ? { role: "participant", code, token: cred.token } : null,
    handlers,
    onSync: () => jitteredReload(600),
    heartbeat: true,
  });

  const submitAnswer = useCallback(
    async (q: PublicQuestionDTO, optionIds: string[], value: number | null) => {
      const sig = `${q.sessionQuestionId}:${[...optionIds].sort().join(",")}:${value}`;
      // mesma escolha → mesma chave de idempotência (reenvio seguro após falha de rede)
      let key = keys.current.get(sig);
      if (!key) {
        key = uid().replace(/[^A-Za-z0-9_-]/g, "");
        keys.current.set(sig, key);
      }
      setSubmitting(true);
      try {
        const r = await api.answer<{ outcome: string; optionIds: string[]; value: number | null; revision: number }>({
          sessionQuestionId: q.sessionQuestionId,
          optionIds,
          value,
          idempotencyKey: key,
        });
        patch((s) => ({ ...s, myAnswer: { optionIds: r.optionIds, value: r.value, revision: r.revision, isCorrect: null, points: null } as Answer }));
        if (soundOn) playSound("sent");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Não foi possível enviar.";
        toast.error(msg);
        if (e instanceof ApiError && (e.code === "PERGUNTA_FECHADA" || e.code === "TEMPO_ESGOTADO" || e.code === "JA_RESPONDIDA")) void reload();
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [api, patch, reload, soundOn],
  );

  const submitWord = useCallback(
    async (q: PublicQuestionDTO, text: string) => {
      const sig = `${q.sessionQuestionId}:wc:${text.trim().toLocaleLowerCase("pt-BR")}`;
      let key = keys.current.get(sig);
      if (!key) {
        key = uid().replace(/[^A-Za-z0-9_-]/g, "");
        keys.current.set(sig, key);
      }
      setSubmitting(true);
      try {
        const r = await api.word<{ outcome: "ACEITA" | "PENDENTE" | "DUPLICADA"; entry: MyWordCloudDTO["entries"][number]; remaining: number }>({
          sessionQuestionId: q.sessionQuestionId,
          text,
          idempotencyKey: key,
        });
        patch((s) => (s.activeQuestion?.sessionQuestionId === q.sessionQuestionId ? { ...s, myWordCloud: mergeEntry(s.myWordCloud ?? { entries: [], remaining: 0 }, r.entry, r.remaining) } : s));
        if (soundOn) playSound("sent");
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível enviar.");
        if (e instanceof ApiError && e.code !== "TERMO_NAO_PERMITIDO" && e.code !== "PALAVRAS_DEMAIS" && e.code !== "MUITO_LONGA") keys.current.delete(sig);
        if (e instanceof ApiError && ["PERGUNTA_FECHADA", "TEMPO_ESGOTADO", "LIMITE_DE_ENVIOS"].includes(e.code ?? "")) void reload();
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [api, patch, reload, soundOn],
  );

  const vote = useCallback(
    async (v: "POSITIVO" | "NEGATIVO") => {
      const previous = state?.satisfaction ?? null;
      patch((s) => ({ ...s, satisfaction: v }));
      setVoting(true);
      try {
        await api.satisfaction(v);
        toast.success(v === "POSITIVO" ? "Obrigado! Registramos que está valendo a pena." : "Obrigado pelo retorno. Sua avaliação foi registrada.");
      } catch (e) {
        patch((s) => ({ ...s, satisfaction: previous }));
        toast.error(e instanceof Error ? e.message : "Não foi possível registrar.");
      } finally {
        setVoting(false);
      }
    },
    [api, patch, state?.satisfaction],
  );

  const setSoundOn = (v: boolean) => {
    setSoundOnState(v);
    try {
      localStorage.setItem("gestalt-live:som", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (v) playSound("sent");
  };

  if (!cred) return null;
  return (
    <PCtx.Provider value={{ code, cred, state, status, answeredCount, submitting, submitAnswer, submitWord, vote, voting, reload, api, soundOn, setSoundOn }}>
      {children}
    </PCtx.Provider>
  );
}

/** Inclui/atualiza um envio na lista do participante (sem duplicar em reenvios ou eventos repetidos). */
function mergeEntry(cur: MyWordCloudDTO, entry: MyWordCloudDTO["entries"][number], remaining?: number): MyWordCloudDTO {
  const exists = cur.entries.some((e) => e.id === entry.id);
  const entries = (exists ? cur.entries.map((e) => (e.id === entry.id ? entry : e)) : [...cur.entries, entry]).filter((e) => e.status !== "REJEITADA");
  // envio rejeitado pela moderação libera um envio
  const freed = remaining === undefined && exists && entry.status === "REJEITADA" ? 1 : 0;
  return { entries, remaining: remaining ?? cur.remaining + freed };
}
