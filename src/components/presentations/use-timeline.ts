"use client";
/**
 * Estado da linha do tempo do editor: histórico de snapshots (desfazer/refazer) e salvamento
 * automático com debounce, enviando a lista COMPLETA para `PUT /presentations/:id/items`.
 *
 * - Cada alteração cria um snapshot imutável; edições de texto no mesmo campo são agrupadas
 *   (chave de agrupamento) para que Ctrl+Z não desfaça letra por letra.
 * - O salvamento usa um contador de revisões: se houve nova alteração durante o envio, salva de novo.
 * - Itens inválidos (ex.: tela personalizada sem título) bloqueiam o envio e são sinalizados.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { admin } from "@/lib/api";
import type { PresentationDTO } from "@shared/presentations";
import { toItemInput, validateItem, type EditorItem } from "./types";

const HISTORY_LIMIT = 100;
const DEBOUNCE_MS = 800;
const COALESCE_MS = 1500;

export type SaveState = "salvo" | "pendente" | "salvando" | "erro" | "invalido";

interface History {
  past: EditorItem[][];
  present: EditorItem[];
  future: EditorItem[][];
}

export function useTimeline(presentationId: string, initial: EditorItem[], readOnly: boolean) {
  const [snap, setSnap] = useState<History>(() => ({ past: [], present: initial, future: [] }));
  const hist = useRef<History>(snap);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);

  const rev = useRef(0);
  const savedRev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("salvo");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ id: string; message: string }[]>([]);

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    for (;;) {
      while (inflight.current) await inflight.current;
      if (rev.current === savedRev.current) {
        setSaveState("salvo");
        return true;
      }
      const target = rev.current;
      const items = hist.current.present;
      const bad = items.map((it) => ({ id: it.id, message: validateItem(it) })).filter((x): x is { id: string; message: string } => !!x.message);
      setInvalid(bad);
      if (bad.length) {
        setSaveState("invalido");
        setSaveError(null);
        return false;
      }
      setSaveState("salvando");
      const p = (async () => {
        try {
          await admin.put<PresentationDTO>(`/presentations/${presentationId}/items`, items.map(toItemInput));
          savedRev.current = Math.max(savedRev.current, target);
          setSaveError(null);
          return true;
        } catch (e) {
          setSaveError(e instanceof Error ? e.message : "Erro ao salvar.");
          setSaveState("erro");
          return false;
        }
      })();
      inflight.current = p;
      const ok = await p;
      inflight.current = null;
      if (!ok) return false;
      if (rev.current === savedRev.current) {
        setSaveState("salvo");
        return true;
      }
      // houve alterações durante o envio: se já há um envio agendado, ele cuida; senão, envia agora
      if (timer.current) {
        setSaveState("pendente");
        return true;
      }
    }
  }, [presentationId, readOnly]);

  const schedule = useCallback(() => {
    if (readOnly) return;
    rev.current++;
    setSaveState("pendente");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, DEBOUNCE_MS);
  }, [readOnly, save]);

  const commitHistory = useCallback((h: History) => {
    hist.current = h;
    setSnap(h);
  }, []);

  /** Aplica uma alteração (função pura sobre a lista atual). */
  const apply = useCallback(
    (fn: (prev: EditorItem[]) => EditorItem[], coalesce?: string) => {
      if (readOnly) return;
      const h = hist.current;
      const next = fn(h.present);
      if (next === h.present) return;
      const now = Date.now();
      const lc = lastCoalesce.current;
      const merge = !!coalesce && !!lc && lc.key === coalesce && now - lc.at < COALESCE_MS;
      lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
      commitHistory({ past: merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] });
      schedule();
    },
    [commitHistory, readOnly, schedule],
  );

  const undo = useCallback(() => {
    const h = hist.current;
    if (!h.past.length || readOnly) return;
    lastCoalesce.current = null;
    commitHistory({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) });
    schedule();
  }, [commitHistory, readOnly, schedule]);

  const redo = useCallback(() => {
    const h = hist.current;
    if (!h.future.length || readOnly) return;
    lastCoalesce.current = null;
    commitHistory({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: h.future[0], future: h.future.slice(1) });
    schedule();
  }, [commitHistory, readOnly, schedule]);

  /** Envia imediatamente o que estiver pendente (antes de ensaiar, inserir pelo servidor etc.). */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    if (rev.current === savedRev.current) return true;
    return save();
  }, [save]);

  /** Substitui a lista pelo retorno do servidor (já gravado), registrando no histórico. */
  const replaceFromServer = useCallback(
    (items: EditorItem[]) => {
      const h = hist.current;
      lastCoalesce.current = null;
      commitHistory({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: items, future: [] });
      rev.current++;
      savedRev.current = rev.current;
      setSaveState("salvo");
      setSaveError(null);
      setInvalid([]);
    },
    [commitHistory],
  );

  // aviso ao sair com alterações não salvas
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (rev.current !== savedRev.current || inflight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ao desmontar (navegação interna), tenta enviar o pendente
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    },
    [save],
  );

  return {
    items: snap.present,
    canUndo: snap.past.length > 0,
    canRedo: snap.future.length > 0,
    apply,
    undo,
    redo,
    flush,
    saveNow: save,
    replaceFromServer,
    saveState,
    saveError,
    invalid,
  };
}
