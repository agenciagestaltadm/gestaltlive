"use client";
/**
 * Fila de envio de slides em lote: até N envios simultâneos (XMLHttpRequest para ter progresso),
 * validação prévia no cliente, status por arquivo e "tentar novamente". Quando a fila esvazia,
 * entrega os arquivos enviados com sucesso (e ainda não inseridos) para `onIdle`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetDTO } from "@shared/presentations";
import { ACCEPTED_SLIDE_TYPES, MAX_SLIDE_BYTES, uuidv4 } from "./types";

export type UploadStatus = "fila" | "enviando" | "ok" | "reaproveitado" | "erro";

export interface UploadEntry {
  key: string;
  file: File;
  name: string;
  size: number;
  status: UploadStatus;
  loaded: number;
  error: string | null;
  /** Falhas de validação no cliente não podem ser repetidas. */
  retryable: boolean;
  asset: AssetDTO | null;
  inserted: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  FORMATO_INVALIDO: "Formato inválido: envie JPG ou PNG.",
  IMAGEM_INVALIDA: "Imagem corrompida ou inválida.",
  ARQUIVO_GRANDE: "Arquivo maior que 20 MB.",
  ARQUIVO_VAZIO: "Arquivo vazio.",
  MUITO_GRANDE: "Arquivo maior que 20 MB.",
};

function validate(file: File): string | null {
  const okType = ACCEPTED_SLIDE_TYPES.includes(file.type) || /\.(png|jpe?g)$/i.test(file.name);
  if (!okType) return "Formato não suportado: exporte os slides como JPG ou PNG.";
  if (file.size === 0) return "Arquivo vazio.";
  if (file.size > MAX_SLIDE_BYTES) return "Arquivo maior que 20 MB.";
  return null;
}

export function useUploadQueue({
  orgId,
  concurrency = 4,
  folder,
  onIdle,
}: {
  orgId: string;
  concurrency?: number;
  folder?: string | null;
  /** Recebe os arquivos concluídos e ainda não inseridos; devolva `false` se a inserção falhar. */
  onIdle: (done: UploadEntry[]) => Promise<boolean> | boolean;
}) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const ref = useRef<UploadEntry[]>([]);
  const active = useRef(0);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const onIdleRef = useRef(onIdle);
  const folderRef = useRef(folder);
  useEffect(() => {
    onIdleRef.current = onIdle;
    folderRef.current = folder;
  });

  const commit = useCallback(() => setEntries([...ref.current]), []);
  const patch = useCallback(
    (key: string, p: Partial<UploadEntry>) => {
      ref.current = ref.current.map((e) => (e.key === key ? { ...e, ...p } : e));
      commit();
    },
    [commit],
  );

  const [inserting, setInserting] = useState(false);
  const flushInsert = useCallback(async () => {
    if (active.current > 0 || ref.current.some((e) => e.status === "fila")) return;
    const ready = ref.current.filter((e) => e.asset && !e.inserted && (e.status === "ok" || e.status === "reaproveitado"));
    if (!ready.length) return;
    const keys = new Set(ready.map((e) => e.key));
    ref.current = ref.current.map((e) => (keys.has(e.key) ? { ...e, inserted: true } : e));
    commit();
    setInserting(true);
    let ok = false;
    try {
      ok = (await onIdleRef.current(ready)) !== false;
    } catch {
      ok = false;
    } finally {
      setInserting(false);
    }
    if (!ok) {
      ref.current = ref.current.map((e) => (keys.has(e.key) ? { ...e, inserted: false } : e));
      commit();
    }
  }, [commit]);

  const pumpRef = useRef<() => void>(() => undefined);

  const start = useCallback(
    (entry: UploadEntry) => {
      active.current++;
      patch(entry.key, { status: "enviando", loaded: 0, error: null });
      const xhr = new XMLHttpRequest();
      xhrs.current.set(entry.key, xhr);
      const fd = new FormData();
      fd.append("file", entry.file, entry.file.name);
      if (folderRef.current) fd.append("folder", folderRef.current);
      let lastPaint = 0;
      xhr.upload.onprogress = (ev) => {
        const now = performance.now();
        if (now - lastPaint < 120 && ev.loaded < ev.total) return; // limita repinturas
        lastPaint = now;
        patch(entry.key, { loaded: ev.lengthComputable ? Math.min(ev.loaded, entry.size) : 0 });
      };
      const finish = (p: Partial<UploadEntry>) => {
        xhrs.current.delete(entry.key);
        active.current = Math.max(0, active.current - 1);
        patch(entry.key, p);
        pumpRef.current();
        void flushInsert();
      };
      xhr.onload = () => {
        let json: { asset?: AssetDTO; reused?: boolean; error?: { code?: string; message?: string } } | null = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          json = null;
        }
        if ((xhr.status === 200 || xhr.status === 201) && json?.asset) {
          finish({ status: json.reused ? "reaproveitado" : "ok", loaded: entry.size, asset: json.asset });
          return;
        }
        let msg: string;
        if (xhr.status === 413) msg = "Arquivo maior que 20 MB.";
        else if (xhr.status === 401) msg = "Sua sessão expirou. Entre novamente e tente de novo.";
        else if (xhr.status === 403) msg = "Você não tem permissão para enviar slides.";
        else msg = (json?.error?.code && ERROR_MESSAGES[json.error.code]) || json?.error?.message || `Erro ${xhr.status} no envio.`;
        const retryable = !(json?.error?.code && ["FORMATO_INVALIDO", "IMAGEM_INVALIDA", "ARQUIVO_GRANDE", "ARQUIVO_VAZIO", "MUITO_GRANDE"].includes(json.error.code)) && xhr.status !== 413;
        finish({ status: "erro", error: msg, retryable });
      };
      xhr.onerror = () => finish({ status: "erro", error: "Falha de conexão. Verifique a internet e tente novamente.", retryable: true });
      xhr.ontimeout = () => finish({ status: "erro", error: "O envio demorou demais. Tente novamente.", retryable: true });
      xhr.onabort = () => finish({ status: "erro", error: "Envio cancelado.", retryable: true });
      xhr.open("POST", `/api/admin/assets?orgId=${encodeURIComponent(orgId)}`);
      xhr.timeout = 5 * 60_000;
      xhr.send(fd);
    },
    [orgId, patch, flushInsert],
  );

  const pump = useCallback(() => {
    while (active.current < concurrency) {
      const next = ref.current.find((e) => e.status === "fila");
      if (!next) break;
      start(next);
    }
  }, [concurrency, start]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const add = useCallback(
    (files: File[]) => {
      const fresh: UploadEntry[] = files.map((file) => {
        const err = validate(file);
        return {
          key: uuidv4(),
          file,
          name: file.name,
          size: file.size,
          status: err ? "erro" : "fila",
          loaded: 0,
          error: err,
          retryable: !err,
          asset: null,
          inserted: false,
        };
      });
      ref.current = [...ref.current, ...fresh];
      commit();
      pump();
    },
    [commit, pump],
  );

  const retry = useCallback(
    (key?: string) => {
      ref.current = ref.current.map((e) => (e.status === "erro" && e.retryable && (!key || e.key === key) ? { ...e, status: "fila", error: null, loaded: 0 } : e));
      commit();
      pump();
    },
    [commit, pump],
  );

  const cancelAll = useCallback(() => {
    ref.current = ref.current.map((e) => (e.status === "fila" ? { ...e, status: "erro", error: "Envio cancelado.", retryable: true } : e));
    commit();
    for (const x of xhrs.current.values()) x.abort();
  }, [commit]);

  const clearFinished = useCallback(() => {
    ref.current = ref.current.filter((e) => e.status === "fila" || e.status === "enviando" || (e.asset && !e.inserted));
    commit();
  }, [commit]);

  const dismiss = useCallback(
    (key: string) => {
      ref.current = ref.current.filter((e) => e.key !== key || e.status === "enviando");
      commit();
    },
    [commit],
  );

  useEffect(() => {
    const map = xhrs.current;
    return () => {
      for (const x of map.values()) x.abort();
    };
  }, []);

  const summary = useMemo(() => {
    const total = entries.reduce((a, e) => a + (e.status === "erro" && !e.retryable ? 0 : e.size), 0);
    const loaded = entries.reduce((a, e) => a + (e.status === "ok" || e.status === "reaproveitado" ? e.size : e.status === "enviando" ? e.loaded : 0), 0);
    const count = (s: UploadStatus) => entries.filter((e) => e.status === s).length;
    return {
      total,
      loaded,
      pct: total ? (loaded / total) * 100 : 0,
      queued: count("fila"),
      uploading: count("enviando"),
      ok: count("ok"),
      reused: count("reaproveitado"),
      failed: count("erro"),
      retryable: entries.filter((e) => e.status === "erro" && e.retryable).length,
      pendingInsert: entries.filter((e) => e.asset && !e.inserted).length,
      busy: count("fila") + count("enviando") > 0,
    };
  }, [entries]);

  return { entries, add, retry, cancelAll, clearFinished, dismiss, summary, inserting, insertPending: flushInsert };
}
