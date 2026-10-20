"use client";
/**
 * Contagem de envios da Nuvem de Palavras aguardando aprovação, por pergunta da sessão.
 * Alimentada pelo evento RT.wordCloudPending (painel/apresentador) e pelas listas de moderação;
 * lida pelos componentes com `useWordCloudPending` (sem recarregar o estado inteiro do painel).
 */
import { useSyncExternalStore } from "react";
import { admin } from "@/lib/api";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function setWordCloudPending(sessionQuestionId: string, pending: number) {
  if (counts.get(sessionQuestionId) === pending) return;
  counts.set(sessionQuestionId, pending);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Busca leve da contagem (lista só dos pendentes); falhas mantêm o valor anterior. */
export async function fetchWordCloudPending(sessionId: string, sessionQuestionId: string) {
  try {
    const r = await admin.get<{ counts: { PENDENTE: number } }>(`/sessions/${sessionId}/questions/${sessionQuestionId}/wordcloud?status=PENDENTE`);
    setWordCloudPending(sessionQuestionId, r.counts.PENDENTE ?? 0);
  } catch {
    /* sem contagem: o selo simplesmente não aparece */
  }
}

/** Pendentes da pergunta (`undefined` enquanto nenhuma contagem chegou). */
export function useWordCloudPending(sessionQuestionId: string | null | undefined): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (sessionQuestionId ? counts.get(sessionQuestionId) : undefined),
    () => undefined,
  );
}
