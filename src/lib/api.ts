/** Clientes HTTP da interface: administração (cookie) e participante (token Bearer). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string; details?: { path: string; message: string }[] } })?.error;
    throw new ApiError(res.status, err?.code ?? "ERRO", err?.message ?? `Erro ${res.status}`, err?.details);
  }
  return json as T;
}

export async function adminFetch<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/admin${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?voltar=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  return handle<T>(res);
}

export const admin = {
  get: <T = unknown>(p: string) => adminFetch<T>(p),
  post: <T = unknown>(p: string, json: unknown = {}) => adminFetch<T>(p, { method: "POST", json }),
  put: <T = unknown>(p: string, json: unknown) => adminFetch<T>(p, { method: "PUT", json }),
  patch: <T = unknown>(p: string, json: unknown) => adminFetch<T>(p, { method: "PATCH", json }),
  del: <T = unknown>(p: string) => adminFetch<T>(p, { method: "DELETE" }),
  async upload(orgId: string, file: File): Promise<{ url: string }> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/uploads?orgId=${orgId}`, { method: "POST", body: fd, credentials: "same-origin" });
    return handle(res);
  },
  async download(p: string, filename: string) {
    const res = await fetch(`/api/admin${p}`, { credentials: "same-origin" });
    if (!res.ok) await handle(res);
    const blob = await res.blob();
    const { downloadBlob } = await import("./utils");
    downloadBlob(blob, filename);
  },
};

export async function publicFetch<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  return handle<T>(res);
}

/* ------------------------------------------------------------------ credencial do participante */
const key = (code: string) => `gestalt-live:p:${code.toUpperCase()}`;

export interface StoredCredential {
  token: string;
  sessionParticipantId: string;
  displayName: string;
}

export function loadCredential(code: string): StoredCredential | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as StoredCredential) : null;
  } catch {
    return null;
  }
}
export function saveCredential(code: string, c: StoredCredential) {
  try {
    localStorage.setItem(key(code), JSON.stringify(c));
  } catch {
    /* modo privado: a credencial vale apenas nesta aba */
  }
}
export function clearCredential(code: string) {
  try {
    localStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}

/**
 * Repete a requisição em falhas de rede ou 5xx/429 (Wi-Fi instável de auditório), com espera
 * exponencial e variação aleatória. Seguro porque as operações do participante são idempotentes
 * (respostas usam chave de idempotência; satisfação é "voto atual").
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retriable = !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
      if (!retriable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i + Math.random() * 400));
    }
  }
  throw last;
}

export function participantApi(code: string, token: string) {
  const call = <T,>(method: string, p: string, json?: unknown) =>
    withRetry(() => publicFetch<T>(`/p/${code}${p}`, { method, json, headers: { authorization: `Bearer ${token}` } }));
  return {
    state: <T,>() => call<T>("GET", "/state"),
    me: <T,>() => call<T>("GET", "/me"),
    answer: <T,>(body: unknown) => call<T>("POST", "/answers", body),
    word: <T,>(body: unknown) => call<T>("POST", "/wordcloud", body),
    satisfaction: <T,>(value: "POSITIVO" | "NEGATIVO") => call<T>("POST", "/satisfaction", { value }),
    profile: <T,>() => call<T>("GET", "/profile"),
    updateProfile: <T,>(displayName: string) => call<T>("PATCH", "/profile", { displayName }),
    marketing: <T,>(granted: boolean) => call<T>("POST", "/consent/marketing", { granted }),
    history: <T,>() => call<T>("GET", "/history"),
  };
}
