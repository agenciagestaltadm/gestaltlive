"use client";
/**
 * Estado do modo apresentador: snapshot do servidor (controle + apresentador), prévia do telão,
 * fila de comandos (um por vez, com atualização otimista) e tempo real.
 *
 * Ordem das respostas: cada requisição recebe um número de sequência; uma resposta só é aplicada se
 * nenhuma requisição iniciada depois dela já tiver sido aplicada. Enquanto a fila de comandos está
 * em andamento, recargas completas são adiadas (evita que um GET antigo sobrescreva a posição).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlStateDTO, LeaderboardDTO, PresentationDTO, ResultsDTO, SatisfactionDTO, ScreenStateDTO } from "@shared/types";
import { RT } from "@shared/types";
import { firstVisible, type PresentationSettings, type PresenterStateDTO } from "@shared/presentations";
import { admin, ApiError, publicFetch } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useAction } from "@/lib/hooks";
import { toast } from "@/components/ui/toast";
import { DEFAULT_PRESENTATION_SETTINGS, nextVisibleIndex, parseScreenUrl, type PresenterCommand, type PresenterResponse, type SessionDetailLite } from "./types";

const MAX_QUEUE = 30;

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback;
}

export function usePresenter(sessionId: string) {
  const [control, setControl] = useState<ControlStateDTO | null>(null);
  const [presenter, setPresenter] = useState<PresenterStateDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<ScreenStateDTO | null>(null);
  const [screenAnswered, setScreenAnswered] = useState<number | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResultsDTO>>({});
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<PresentationSettings>(DEFAULT_PRESENTATION_SETTINGS);
  const [detail, setDetail] = useState<SessionDetailLite | null>(null);
  /** Diferença entre o relógio do servidor e o do aparelho (cronômetros da apresentação). */
  const [clockOffset, setClockOffset] = useState(0);
  const { pending, run } = useAction();

  const seq = useRef(0);
  const lastControlSeq = useRef(0);
  const lastPresenterSeq = useRef(0);
  const screenSeq = useRef(0);
  const lastScreenSeq = useRef(0);
  const controlRef = useRef<ControlStateDTO | null>(null);
  const presenterRef = useRef<PresenterStateDTO | null>(null);
  const screenRef = useRef<ScreenStateDTO | null>(null);
  const queue = useRef<PresenterCommand[]>([]);
  const processing = useRef(false);
  const optimisticRef = useRef<string | null>(null);
  const deferredReload = useRef(false);
  const panelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------------------------------------------------------- aplicação de estado */
  const applyControl = useCallback((reqSeq: number, c: ControlStateDTO) => {
    if (reqSeq <= lastControlSeq.current) return;
    lastControlSeq.current = reqSeq;
    controlRef.current = c;
    setControl(c);
    setClockOffset(c.serverNow - Date.now());
    if (c.results) setResults((m) => ({ ...m, [c.results!.sessionQuestionId]: c.results! }));
  }, []);

  const applyPresenter = useCallback((reqSeq: number, p: PresenterStateDTO | null) => {
    if (reqSeq <= lastPresenterSeq.current) return;
    lastPresenterSeq.current = reqSeq;
    presenterRef.current = p;
    setPresenter(p);
  }, []);

  const applyResponse = useCallback(
    (reqSeq: number, r: PresenterResponse) => {
      applyControl(reqSeq, r.control);
      applyPresenter(reqSeq, r.presenter);
    },
    [applyControl, applyPresenter],
  );

  /* ---------------------------------------------------------------- carregamento */
  const loadPanel = useCallback(async () => {
    if (processing.current) {
      deferredReload.current = true;
      return;
    }
    const my = ++seq.current;
    try {
      const r = await admin.get<PresenterResponse>(`/sessions/${sessionId}/presenter`);
      applyResponse(my, r);
      setError(null);
    } catch (e) {
      if (!controlRef.current) setError(errMsg(e, "Não foi possível carregar a sessão."));
    } finally {
      setLoaded(true);
    }
  }, [sessionId, applyResponse]);

  const screenUrl = control?.session.screenUrl ?? null;
  const loadScreen = useCallback(async () => {
    const parsed = parseScreenUrl(controlRef.current?.session.screenUrl);
    if (!parsed) return;
    const my = ++screenSeq.current;
    try {
      const s = await publicFetch<ScreenStateDTO>(`/screen/${encodeURIComponent(parsed.code)}/state?t=${encodeURIComponent(parsed.token)}`);
      if (my <= lastScreenSeq.current) return;
      lastScreenSeq.current = my;
      screenRef.current = s;
      setScreen(s);
      setScreenAnswered(s.counts.answered);
      setScreenError(null);
    } catch (e) {
      setScreenError(errMsg(e, "Não foi possível carregar a prévia do telão."));
    }
  }, []);

  const reloadPanel = useCallback(
    (delay = 250) => {
      if (panelTimer.current) clearTimeout(panelTimer.current);
      panelTimer.current = setTimeout(() => void loadPanel(), delay);
    },
    [loadPanel],
  );
  const reloadScreen = useCallback(
    (delay = 120) => {
      if (screenTimer.current) clearTimeout(screenTimer.current);
      screenTimer.current = setTimeout(() => void loadScreen(), delay);
    },
    [loadScreen],
  );
  /** Atualizações frequentes (respostas chegando): no máximo uma recarga da prévia a cada 1,5 s. */
  const throttleScreen = useCallback(() => {
    if (screenThrottle.current) return;
    screenThrottle.current = setTimeout(() => {
      screenThrottle.current = null;
      void loadScreen();
    }, 1500);
  }, [loadScreen]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    if (screenUrl) void loadScreen();
  }, [screenUrl, loadScreen]);

  // detalhe da sessão: nome/agendamento (para o PUT) e apresentação vinculada (detecta troca)
  useEffect(() => {
    let alive = true;
    admin
      .get<SessionDetailLite>(`/sessions/${sessionId}`)
      .then((d) => alive && setDetail(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const presentationId = presenter?.presentationId ?? null;
  useEffect(() => {
    if (!presentationId) return;
    let alive = true;
    admin
      .get<{ settings: PresentationSettings }>(`/presentations/${presentationId}`)
      .then((p) => alive && setSettings({ ...DEFAULT_PRESENTATION_SETTINGS, ...p.settings }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [presentationId]);

  useEffect(
    () => () => {
      for (const t of [panelTimer, screenTimer, screenThrottle]) if (t.current) clearTimeout(t.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- fila de comandos */
  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    try {
      while (queue.current.length) {
        const cmd = queue.current.shift()!;
        const body = cmd.action === "next" || cmd.action === "prev" ? { action: cmd.action, fromItemId: presenterRef.current?.currentItemId ?? null } : cmd;
        const my = ++seq.current;
        try {
          const r = await admin.post<PresenterResponse>(`/sessions/${sessionId}/presenter`, body);
          applyResponse(my, r);
          reloadScreen(40);
          if (r.result?.stale || r.result?.edge) {
            // posição mudou em outra janela/automação ou chegou ao limite: descarta a navegação pendente
            queue.current = queue.current.filter((c) => c.action !== "next" && c.action !== "prev" && c.action !== "goto" && c.action !== "start");
            optimisticRef.current = null;
            setOptimisticId(null);
            if (r.result.stale) toast.info("A apresentação foi movida em outro lugar. Posição atualizada.");
            else toast.info(cmd.action === "prev" ? "Você já está no primeiro item." : "Você chegou ao último item.");
          }
        } catch (e) {
          toast.error(errMsg(e, "Não foi possível executar o comando."));
          queue.current = [];
          deferredReload.current = true;
        }
        if (queue.current.length === 0) {
          optimisticRef.current = null;
          setOptimisticId(null);
        }
      }
    } finally {
      processing.current = false;
      setBusy(false);
      optimisticRef.current = null;
      setOptimisticId(null);
      if (deferredReload.current) {
        deferredReload.current = false;
        reloadPanel(0);
      }
    }
  }, [sessionId, applyResponse, reloadScreen, reloadPanel]);

  const send = useCallback(
    (cmd: PresenterCommand) => {
      const p = presenterRef.current;
      if (!p) return;
      if (queue.current.length >= MAX_QUEUE) return;
      let c = cmd;
      if (cmd.action === "next" || cmd.action === "prev") {
        const hidden = p.items.map((i) => i.hidden);
        if ((p.status === "PRONTA" || !p.currentItemId) && !optimisticRef.current) {
          // ainda não iniciada: "próximo" inicia a apresentação no primeiro item visível
          if (cmd.action === "prev") return;
          c = { action: "start" };
          const first = firstVisible(hidden);
          optimisticRef.current = first === null ? null : p.items[first].id;
        } else {
          const curId = optimisticRef.current ?? p.currentItemId;
          const curIdx = p.items.findIndex((i) => i.id === curId);
          const to = nextVisibleIndex(p.items, curIdx, cmd.action === "next" ? 1 : -1);
          if (to === null) {
            if (!processing.current) toast.info(cmd.action === "prev" ? "Você já está no primeiro item." : "Você chegou ao último item.");
            return;
          }
          optimisticRef.current = p.items[to].id;
        }
        setOptimisticId(optimisticRef.current);
      } else if (cmd.action === "goto") {
        optimisticRef.current = cmd.toItemId;
        setOptimisticId(cmd.toItemId);
      }
      queue.current.push(c);
      void pump();
    },
    [pump],
  );

  /* ---------------------------------------------------------------- ações da engine ao vivo */
  const act = useCallback(
    async (key: string, path: string, body: unknown = {}, success?: string) => {
      const s = await run(key, () => admin.post<ControlStateDTO>(`/sessions/${sessionId}${path}`, body), success);
      if (s) {
        // a resposta reflete o estado após o commit: vale mais que recargas iniciadas antes dela
        applyControl(++seq.current, s);
        reloadScreen(40);
      }
      return s;
    },
    [sessionId, run, applyControl, reloadScreen],
  );

  const fetchResults = useCallback(
    async (sqId: string) => {
      try {
        const r = await admin.get<ResultsDTO>(`/sessions/${sessionId}/results/${sqId}`);
        setResults((m) => ({ ...m, [sqId]: r }));
      } catch {
        /* exibido como "sem dados" */
      }
    },
    [sessionId],
  );

  /** Vincula a apresentação à sessão (PUT da sessão preserva nome e agendamento). */
  const linkPresentation = useCallback(
    async (newPresentationId: string | null) => {
      const d = detail ?? (await admin.get<SessionDetailLite>(`/sessions/${sessionId}`));
      const ok = await run(
        "link",
        () => admin.put<SessionDetailLite>(`/sessions/${sessionId}`, { name: d.name, scheduledAt: d.scheduledAt, presentationId: newPresentationId }),
        newPresentationId ? "Apresentação vinculada à sessão." : "Apresentação desvinculada.",
      );
      if (ok) {
        setDetail((cur) => ({ ...(cur ?? d), ...ok, presentationId: newPresentationId }));
        reloadPanel(0);
      }
      return !!ok;
    },
    [detail, sessionId, run, reloadPanel],
  );

  /* ---------------------------------------------------------------- tempo real */
  const status = useRealtime({
    auth: control ? { role: "control", sessionId } : null,
    onSync: () => {
      reloadPanel(0);
      reloadScreen(0);
    },
    handlers: {
      [RT.presenterChanged]: (d: { currentItemId: string | null; currentIndex: number; override: PresenterStateDTO["override"]; status: PresenterStateDTO["status"]; version: number }) => {
        if (!processing.current) {
          const p = presenterRef.current;
          if (p && d.version > p.version) {
            const np = { ...p, currentItemId: d.currentItemId, currentIndex: d.currentIndex, override: d.override, status: d.status, version: d.version };
            presenterRef.current = np;
            setPresenter(np);
          }
        }
        reloadPanel(300);
        reloadScreen(60);
      },
      [RT.presentationChanged]: (p: PresentationDTO) => {
        setControl((c) => {
          if (!c) return c;
          const n = { ...c, presentation: p };
          controlRef.current = n;
          return n;
        });
        reloadScreen(60);
        reloadPanel(300);
      },
      [RT.questionOpened]: () => {
        reloadPanel(150);
        reloadScreen(80);
      },
      [RT.questionClosed]: () => {
        reloadPanel(150);
        reloadScreen(80);
      },
      [RT.questionTimerUpdated]: () => {
        reloadPanel(150);
        reloadScreen(80);
      },
      [RT.questionResultRevealed]: () => {
        reloadPanel(150);
        reloadScreen(80);
      },
      [RT.resultsUpdated]: (r: ResultsDTO) => {
        setResults((m) => ({ ...m, [r.sessionQuestionId]: r }));
        const sc = screenRef.current;
        if (sc?.question?.sessionQuestionId === r.sessionQuestionId) {
          setScreenAnswered(r.totals.respondents);
          if (sc.results) throttleScreen();
        }
      },
      [RT.leaderboardUpdated]: (lb: LeaderboardDTO) => {
        setControl((c) => (c ? { ...c, leaderboard: lb } : c));
        if (screenRef.current?.presentation.screen === "RANKING") throttleScreen();
      },
      [RT.satisfactionUpdated]: (sat: SatisfactionDTO) => {
        setControl((c) => (c ? { ...c, satisfaction: sat } : c));
        setScreen((s) => (s && s.satisfaction ? { ...s, satisfaction: sat } : s));
      },
      [RT.presenceChanged]: (p: { registered: number; connected: number }) => {
        setControl((c) => (c ? { ...c, counts: { ...c.counts, ...p } } : c));
        setScreen((s) => (s ? { ...s, counts: { ...s.counts, ...p } } : s));
      },
      [RT.participantJoined]: () => undefined,
      [RT.prizesRevealed]: () => reloadScreen(80),
      [RT.sessionStarted]: () => {
        reloadPanel(100);
        reloadScreen(100);
      },
      [RT.sessionPaused]: () => {
        reloadPanel(100);
        reloadScreen(100);
      },
      [RT.sessionResumed]: () => {
        reloadPanel(100);
        reloadScreen(100);
      },
      [RT.sessionEnded]: () => {
        reloadPanel(100);
        reloadScreen(100);
      },
      [RT.resync]: () => {
        reloadPanel(300);
        reloadScreen(200);
      },
    },
  });

  return {
    control,
    presenter,
    loaded,
    error,
    screen,
    screenAnswered,
    screenError,
    results,
    optimisticId,
    busy,
    settings,
    detail,
    clockOffset,
    pending,
    status,
    send,
    act,
    fetchResults,
    linkPresentation,
    reload: () => {
      reloadPanel(0);
      reloadScreen(0);
    },
  };
}

export type PresenterHook = ReturnType<typeof usePresenter>;
