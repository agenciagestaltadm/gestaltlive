"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { toast } from "@/components/ui/toast";

/** Carrega dados da API com estado de carregamento/erro e função de recarga. */
export function useApi<T>(fetcher: (() => Promise<T>) | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(!!fetcher);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const reload = useCallback(async () => {
    if (!fetcherRef.current) return;
    setLoading(true);
    try {
      const d = await fetcherRef.current();
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

/** Executa uma ação com feedback (toast) e estado de carregamento. */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <R,>(key: string, fn: () => Promise<R>, success?: string): Promise<R | undefined> => {
    setPending(key);
    try {
      const r = await fn();
      if (success) toast.success(success);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro inesperado.");
      return undefined;
    } finally {
      setPending(null);
    }
  }, []);
  return { pending, run };
}

/** Mapeia detalhes de validação do servidor (path → mensagem). */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError && e.details) for (const d of e.details) out[d.path] ??= d.message;
  return out;
}
