"use client";
/**
 * Fila de envio de slides em lote: até N envios simultâneos (XMLHttpRequest para ter progresso),
 * validação prévia no cliente, status por arquivo e "tentar novamente". Quando a fila esvazia,
 * entrega os arquivos enviados com sucesso (e ainda não inseridos) para `onIdle`.
 *
 * Dois caminhos, decididos pelo servidor (GET /api/admin/assets/upload-config):
 *  - pela API (servidor próprio): multipart para /api/admin/assets;
 *  - direto ao Supabase Storage (Vercel): URL assinada → envio do arquivo → processamento pela API.
 *    Assim slides de até 20 MB não esbarram no limite de 4,5 MB por requisição das funções.
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

type ApiError = { code?: string; message?: string };
const NON_RETRYABLE = ["FORMATO_INVALIDO", "IMAGEM_INVALIDA", "ARQUIVO_GRANDE", "ARQUIVO_VAZIO", "MUITO_GRANDE"];

function errorFor(status: number, err: ApiError | undefined): { error: string; retryable: boolean } {
  let msg: string;
  if (status === 413) msg = "Arquivo maior que 20 MB.";
  else if (status === 401) msg = "Sua sessão expirou. Entre novamente e tente de novo.";
  else if (status === 403) msg = "Você não tem permissão para enviar slides.";
  else msg = (err?.code && ERROR_MESSAGES[err.code]) || err?.message || `Erro ${status} no envio.`;
  return { error: msg, retryable: !(err?.code && NON_RETRYABLE.includes(err.code)) && status !== 413 };
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; json: (T & { error?: ApiError }) | null }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  let json: (T & { error?: ApiError }) | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

let uploadConfig: Promise<{ direct: boolean }> | null = null;
function getUploadConfig() {
  uploadConfig ??= fetch("/api/admin/assets/upload-config", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ direct: boolean }>) : { direct: false }))
    .catch(() => {
      uploadConfig = null;
      return { direct: false };
    });
  return uploadConfig;
}

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
      const finish = (p: Partial<UploadEntry>) => {
        xhrs.current.delete(entry.key);
        active.current = Math.max(0, active.current - 1);
        patch(entry.key, p);
        pumpRef.current();
        void flushInsert();
      };
      const done = (json: { asset?: AssetDTO; reused?: boolean } | null) =>
        finish({ status: json?.reused ? "reaproveitado" : "ok", loaded: entry.size, asset: json!.asset! });
      const fail = (status: number, err?: ApiError) => finish({ status: "erro", ...errorFor(status, err) });

      /** Envia o corpo com progresso; resolve com status e texto da resposta. */
      const send = (method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string> = {}) =>
        new Promise<{ status: number; text: string } | null>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhrs.current.set(entry.key, xhr);
          let lastPaint = 0;
          xhr.upload.onprogress = (ev) => {
            const now = performance.now();
            if (now - lastPaint < 120 && ev.loaded < ev.total) return; // limita repinturas
            lastPaint = now;
            patch(entry.key, { loaded: ev.lengthComputable ? Math.min(ev.loaded, entry.size) : 0 });
          };
          xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
          xhr.onerror = () => {
            finish({ status: "erro", error: "Falha de conexão. Verifique a internet e tente novamente.", retryable: true });
            resolve(null);
          };
          xhr.ontimeout = () => {
            finish({ status: "erro", error: "O envio demorou demais. Tente novamente.", retryable: true });
            resolve(null);
          };
          xhr.onabort = () => {
            finish({ status: "erro", error: "Envio cancelado.", retryable: true });
            resolve(null);
          };
          xhr.open(method, url);
          for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
          xhr.timeout = 5 * 60_000;
          xhr.send(body);
        });
      const parse = (text: string) => {
        try {
          return JSON.parse(text) as { asset?: AssetDTO; reused?: boolean; error?: ApiError };
        } catch {
          return null;
        }
      };
      const q = `?orgId=${encodeURIComponent(orgId)}`;

      const viaApi = async () => {
        const fd = new FormData();
        fd.append("file", entry.file, entry.file.name);
        if (folderRef.current) fd.append("folder", folderRef.current);
        const r = await send("POST", `/api/admin/assets${q}`, fd);
        if (!r) return;
        const json = parse(r.text);
        if ((r.status === 200 || r.status === 201) && json?.asset) done(json);
        else fail(r.status, json?.error);
      };

      const direct = async () => {
        const type = entry.file.type || (/\.png$/i.test(entry.name) ? "image/png" : "image/jpeg");
        const prep = await postJson<{ key: string; uploadUrl: string }>(`/api/admin/assets/direct${q}`, { name: entry.name, size: entry.size, type });
        if (prep.status !== 201 || !prep.json?.uploadUrl) return fail(prep.status, prep.json?.error);
        const up = await send("PUT", prep.json.uploadUrl, entry.file, { "Content-Type": type });
        if (!up) return;
        if (up.status < 200 || up.status >= 300) return fail(up.status === 413 ? 413 : up.status, { message: "O armazenamento recusou o arquivo. Tente novamente." });
        patch(entry.key, { loaded: entry.size });
        const fin = await postJson<{ asset?: AssetDTO; reused?: boolean }>(`/api/admin/assets/direct/complete${q}`, { key: prep.json.key, name: entry.name, folder: folderRef.current ?? null });
        if ((fin.status === 200 || fin.status === 201) && fin.json?.asset) done(fin.json);
        else fail(fin.status, fin.json?.error);
      };

      void getUploadConfig()
        .then((cfg) => (cfg.direct ? direct() : viaApi()))
        .catch(() => finish({ status: "erro", error: "Falha de conexão. Verifique a internet e tente novamente.", retryable: true }));
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
