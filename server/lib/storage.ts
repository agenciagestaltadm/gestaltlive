/**
 * Armazenamento de arquivos (logos, imagens de perguntas/prêmios e slides).
 *  - DiskStore: diretório local (UPLOAD_DIR) — servidor próprio e Docker.
 *  - SupabaseStore: Supabase Storage — obrigatório na Vercel (o disco das funções é efêmero).
 *    Bucket público para as imagens servidas (nomes aleatórios ou SHA-256) e bucket privado para
 *    os envios diretos do navegador (slides grandes não passam pelo limite de 4,5 MB das funções).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { serviceHeaders, type SupabaseConfig } from "./supabase";

export interface BlobStore {
  readonly kind: "disk" | "supabase";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  /** URL pública direta (supabase) — as rotas /api/uploads e /api/assets redirecionam para ela. */
  publicUrl(key: string): string | null;
  /** Envio direto do navegador (somente supabase). */
  createUpload?(key: string): Promise<{ uploadUrl: string }>;
  takeUpload?(key: string): Promise<Buffer | null>;
}

const SAFE_KEY = /^[0-9a-f-]{36}(\/[A-Za-z0-9._-]+)+$/;
function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`chave de arquivo inválida: ${key}`);
}

export class DiskStore implements BlobStore {
  readonly kind = "disk" as const;
  constructor(private root: string) {}
  private file(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("caminho fora do diretório de uploads");
    return full;
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async exists(key: string) {
    try {
      await fs.access(this.file(key));
      return true;
    } catch {
      return false;
    }
  }
  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => fs.rm(this.file(k), { force: true })));
  }
  publicUrl() {
    return null;
  }
}

export class SupabaseStore implements BlobStore {
  readonly kind = "supabase" as const;
  constructor(private cfg: SupabaseConfig) {}
  private obj(bucket: string, key: string) {
    assertKey(key);
    return `${this.cfg.url}/storage/v1/object/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await fetch(this.obj(this.cfg.bucket, key), {
      method: "POST",
      headers: serviceHeaders(this.cfg, { "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "max-age=31536000" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`falha ao gravar no Supabase Storage (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  async get(key: string) {
    const res = await fetch(this.obj(this.cfg.bucket, key).replace("/object/", "/object/authenticated/"), { headers: serviceHeaders(this.cfg) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(key: string) {
    const res = await fetch(this.obj(this.cfg.bucket, key).replace("/object/", "/object/info/"), { headers: serviceHeaders(this.cfg) });
    return res.ok;
  }
  async remove(keys: string[]) {
    if (!keys.length) return;
    keys.forEach(assertKey);
    const res = await fetch(`${this.cfg.url}/storage/v1/object/${this.cfg.bucket}`, {
      method: "DELETE",
      headers: serviceHeaders(this.cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw new Error(`falha ao excluir do Supabase Storage (${res.status})`);
  }
  publicUrl(key: string) {
    assertKey(key);
    return `${this.cfg.url}/storage/v1/object/public/${this.cfg.bucket}/${key}`;
  }
  async createUpload(key: string) {
    assertKey(key);
    const res = await fetch(`${this.cfg.url}/storage/v1/object/upload/sign/${this.cfg.incomingBucket}/${key}`, {
      method: "POST",
      headers: serviceHeaders(this.cfg, { "Content-Type": "application/json" }),
      body: "{}",
    });
    if (!res.ok) throw new Error(`falha ao preparar o envio direto (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const { url } = (await res.json()) as { url: string };
    return { uploadUrl: `${this.cfg.url}/storage/v1${url.startsWith("/") ? url : `/${url}`}` };
  }
  /** Lê o arquivo enviado diretamente pelo navegador e o remove da área de recebimento. */
  async takeUpload(key: string) {
    assertKey(key);
    const url = `${this.cfg.url}/storage/v1/object/authenticated/${this.cfg.incomingBucket}/${key}`;
    const res = await fetch(url, { headers: serviceHeaders(this.cfg) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    await fetch(`${this.cfg.url}/storage/v1/object/${this.cfg.incomingBucket}`, {
      method: "DELETE",
      headers: serviceHeaders(this.cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [key] }),
    }).catch(() => undefined);
    return data;
  }
}
