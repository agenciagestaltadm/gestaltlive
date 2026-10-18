/**
 * Biblioteca de slides (Gerenciador de Apresentações).
 *
 * - Aceita apenas JPG/PNG, validando a assinatura binária E a decodificação real (sharp).
 * - Remove metadados (EXIF/GPS) ao regravar; limita dimensões (descompressão maliciosa).
 * - Deduplica por SHA-256 do conteúdo enviado: o mesmo arquivo é gravado uma única vez por organização.
 * - Gera três variantes no armazenamento (disco local ou Supabase Storage — nunca no banco):
 *     orig — imagem integral sem metadados (download);
 *     tela — até 2560 px, alta qualidade (telão);
 *     mini — 480 px (editor, linha do tempo, prévias).
 */
import crypto from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { presentationAssets, presentationItems } from "../db/schema";
import { rowsOf } from "../db/client";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import type { AssetDTO } from "@shared/presentations";

export const MAX_SLIDE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 120_000_000; // ~ 12000 × 10000
const TELA_MAX = 2560;
const MINI_WIDTH = 480;

const SIGNATURES: { ext: "png" | "jpg"; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: "png", mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mime: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

const FILE_RE = /^([a-f0-9]{64})-(orig|tela|mini)\.(jpg|png|webp)$/;

type AssetRow = typeof presentationAssets.$inferSelect;

const keyOf = (orgId: string, file: string) => `${orgId}/slides/${file}`;
const variantFiles = (a: Pick<AssetRow, "sha256" | "ext">) => [`${a.sha256}-orig.${a.ext}`, `${a.sha256}-tela.webp`, `${a.sha256}-mini.webp`];

export function assetUrls(a: Pick<AssetRow, "orgId" | "sha256" | "ext">) {
  const base = `/api/assets/${a.orgId}/${a.sha256}`;
  return { mini: `${base}-mini.webp`, tela: `${base}-tela.webp`, original: `${base}-orig.${a.ext}` };
}

export function toAssetDTO(a: AssetRow, usage?: number): AssetDTO {
  return {
    id: a.id,
    originalName: a.originalName,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    folder: a.folder,
    createdAt: a.createdAt.toISOString(),
    urls: assetUrls(a),
    ...(usage !== undefined && { usage }),
  };
}

function cleanName(name: string) {
  return (
    name
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/[\\/]/g, "_")
      .trim()
      .slice(0, 200) || "slide"
  );
}

/** Recebe um arquivo, valida, deduplica e grava as variantes. */
export async function uploadAsset(ctx: AppContext, actor: Actor, orgId: string, file: File, folder: string | null) {
  authorize(actor, orgId, "event.write");
  if (file.size > MAX_SLIDE_BYTES) throw badRequest(`"${file.name}" excede ${MAX_SLIDE_BYTES / 1024 / 1024} MB.`, undefined, "ARQUIVO_GRANDE");
  if (file.size === 0) throw badRequest(`"${file.name}" está vazio.`, undefined, "ARQUIVO_VAZIO");
  return ingestAsset(ctx, actor, orgId, { name: file.name, buf: Buffer.from(await file.arrayBuffer()) }, folder);
}

/** Configuração de envio para o editor: direto ao Supabase Storage (Vercel) ou pela API (servidor próprio). */
export function uploadConfig(ctx: AppContext) {
  return { direct: !!ctx.storage.createUpload, maxBytes: MAX_SLIDE_BYTES };
}

/**
 * Envio direto (Vercel): o navegador grava o arquivo original numa área privada do Supabase Storage
 * e depois pede o processamento — assim slides de até 20 MB não passam pelo limite de 4,5 MB das funções.
 */
export async function createDirectUpload(ctx: AppContext, actor: Actor, orgId: string, input: { name: string; size: number; type: string }) {
  authorize(actor, orgId, "event.write");
  if (!ctx.storage.createUpload) throw badRequest("Envio direto indisponível neste servidor.");
  if (input.size > MAX_SLIDE_BYTES) throw badRequest(`"${input.name}" excede ${MAX_SLIDE_BYTES / 1024 / 1024} MB.`, undefined, "ARQUIVO_GRANDE");
  if (input.size <= 0) throw badRequest(`"${input.name}" está vazio.`, undefined, "ARQUIVO_VAZIO");
  if (!["image/png", "image/jpeg"].includes(input.type) && !/\.(png|jpe?g)$/i.test(input.name)) {
    throw badRequest(`"${input.name}" não é um JPG ou PNG válido.`, undefined, "FORMATO_INVALIDO");
  }
  const key = `${orgId}/${crypto.randomUUID()}`;
  const { uploadUrl } = await ctx.storage.createUpload(key);
  return { key, uploadUrl };
}

export async function importDirectUpload(ctx: AppContext, actor: Actor, orgId: string, input: { key: string; name: string; folder: string | null }) {
  authorize(actor, orgId, "event.write");
  if (!ctx.storage.takeUpload) throw badRequest("Envio direto indisponível neste servidor.");
  if (!new RegExp(`^${orgId}/[0-9a-f-]{36}$`).test(input.key)) throw badRequest("Envio inválido.");
  const buf = await ctx.storage.takeUpload(input.key);
  if (!buf) throw badRequest(`"${input.name}" não foi recebido. Envie novamente.`, undefined, "ENVIO_NAO_ENCONTRADO");
  if (buf.length > MAX_SLIDE_BYTES) throw badRequest(`"${input.name}" excede ${MAX_SLIDE_BYTES / 1024 / 1024} MB.`, undefined, "ARQUIVO_GRANDE");
  if (buf.length === 0) throw badRequest(`"${input.name}" está vazio.`, undefined, "ARQUIVO_VAZIO");
  return ingestAsset(ctx, actor, orgId, { name: input.name, buf }, input.folder);
}

async function ingestAsset(ctx: AppContext, actor: Actor, orgId: string, file: { name: string; buf: Buffer }, folder: string | null) {
  const buf = file.buf;
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig) throw badRequest(`"${file.name}" não é um JPG ou PNG válido.`, undefined, "FORMATO_INVALIDO");

  // decodificação real: rejeita arquivos corrompidos ou disfarçados
  let meta: Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw badRequest(`"${file.name}" está corrompido ou não é uma imagem válida.`, undefined, "IMAGEM_INVALIDA");
  }
  const expected = sig.ext === "png" ? "png" : "jpeg";
  if (meta.format !== expected || !meta.width || !meta.height) {
    throw badRequest(`"${file.name}" não é um JPG ou PNG válido.`, undefined, "FORMATO_INVALIDO");
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const [existing] = await ctx.db
    .select()
    .from(presentationAssets)
    .where(and(eq(presentationAssets.orgId, orgId), eq(presentationAssets.sha256, sha256)));
  if (existing) {
    // arquivo idêntico já enviado: reaproveita (sem novo arquivo físico)
    await ensureVariants(ctx, existing, buf);
    return { asset: toAssetDTO(existing), reused: true };
  }

  const pipeline = () => sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate(); // aplica orientação EXIF e descarta metadados
  const orig = sig.ext === "png" ? await pipeline().png({ compressionLevel: 9 }).toBuffer() : await pipeline().jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  const info = await sharp(orig).metadata();
  await writeVariants(ctx, orgId, sha256, sig.ext, orig, buf);

  const ins = await ctx.db
    .insert(presentationAssets)
    .values({
      orgId,
      sha256,
      originalName: cleanName(file.name),
      mime: sig.mime,
      ext: sig.ext,
      width: info.width ?? meta.width,
      height: info.height ?? meta.height,
      bytes: orig.length,
      folder: folder?.trim().slice(0, 80) || null,
      createdByUserId: actor.user.id,
    })
    .onConflictDoNothing()
    .returning();
  if (ins.length === 0) {
    // envio concorrente do mesmo arquivo
    const [row] = await ctx.db.select().from(presentationAssets).where(and(eq(presentationAssets.orgId, orgId), eq(presentationAssets.sha256, sha256)));
    return { asset: toAssetDTO(row), reused: true };
  }
  return { asset: toAssetDTO(ins[0]), reused: false };
}

async function writeVariants(ctx: AppContext, orgId: string, sha: string, ext: string, orig: Buffer, source: Buffer) {
  const tela = await sharp(source, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: TELA_MAX, height: TELA_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, smartSubsample: true })
    .toBuffer();
  const mini = await sharp(source, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: MINI_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  await Promise.all([
    ctx.storage.put(keyOf(orgId, `${sha}-orig.${ext}`), orig, ext === "png" ? "image/png" : "image/jpeg"),
    ctx.storage.put(keyOf(orgId, `${sha}-tela.webp`), tela, "image/webp"),
    ctx.storage.put(keyOf(orgId, `${sha}-mini.webp`), mini, "image/webp"),
  ]);
}

/** Recria variantes ausentes (ex.: volume de uploads restaurado parcialmente). */
async function ensureVariants(ctx: AppContext, a: AssetRow, source: Buffer) {
  if (!(await ctx.storage.exists(keyOf(a.orgId, `${a.sha256}-tela.webp`)))) {
    await writeVariants(ctx, a.orgId, a.sha256, a.ext, source, source);
  }
}

/** Lê uma variante. No Supabase Storage devolve a URL pública (a rota redireciona). */
export async function readAsset(ctx: AppContext, orgId: string, file: string): Promise<{ redirect: string } | { data: Buffer; mime: string }> {
  const m = FILE_RE.exec(file);
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !m) throw notFound();
  const key = keyOf(orgId, file);
  const direct = ctx.storage.publicUrl(key);
  if (direct) return { redirect: direct };
  const data = await ctx.storage.get(key);
  if (!data) throw notFound();
  const ext = m[3];
  return { data, mime: ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg" };
}

export async function listAssets(ctx: AppContext, actor: Actor, orgId: string, f: { q?: string; folder?: string; page?: number; pageSize?: number }) {
  authorize(actor, orgId, "event.read");
  const pageSize = Math.min(Math.max(f.pageSize ?? 60, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  const conds = [eq(presentationAssets.orgId, orgId)];
  if (f.q) conds.push(ilike(presentationAssets.originalName, `%${f.q.replace(/[%_]/g, "")}%`));
  if (f.folder) conds.push(eq(presentationAssets.folder, f.folder));
  const where = and(...conds);
  const [{ total }] = await ctx.db.select({ total: count() }).from(presentationAssets).where(where);
  const rows = await ctx.db
    .select()
    .from(presentationAssets)
    .where(where)
    .orderBy(desc(presentationAssets.createdAt), presentationAssets.originalName)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const usage = await usageCounts(ctx, rows.map((r) => r.id));
  const folders = await ctx.db
    .selectDistinct({ folder: presentationAssets.folder })
    .from(presentationAssets)
    .where(and(eq(presentationAssets.orgId, orgId), sql`${presentationAssets.folder} is not null`));
  return {
    total: Number(total),
    page,
    pageSize,
    folders: folders.map((x) => x.folder!).sort(),
    rows: rows.map((r) => toAssetDTO(r, usage.get(r.id) ?? 0)),
  };
}

async function usageCounts(ctx: AppContext, ids: string[]) {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const rows = await ctx.db
    .select({ id: presentationItems.assetId, n: sql<number>`count(distinct ${presentationItems.presentationId})::int` })
    .from(presentationItems)
    .where(inArray(presentationItems.assetId, ids))
    .groupBy(presentationItems.assetId);
  for (const r of rows) if (r.id) map.set(r.id, Number(r.n));
  return map;
}

export async function assetUsage(ctx: AppContext, actor: Actor, id: string) {
  const a = await loadAsset(ctx, actor, id, "event.read");
  const rows = await ctx.db.execute(sql`
    select distinct p.id, p.title from presentation_items i join presentations p on p.id = i.presentation_id
     where i.asset_id = ${a.id} order by p.title`);
  return rowsOf<{ id: string; title: string }>(rows);
}

async function loadAsset(ctx: AppContext, actor: Actor, id: string, perm: "event.read" | "event.write") {
  const [a] = await ctx.db.select().from(presentationAssets).where(eq(presentationAssets.id, id));
  if (!a) throw notFound("Arquivo não encontrado.");
  authorize(actor, a.orgId, perm);
  return a;
}

export async function updateAsset(ctx: AppContext, actor: Actor, id: string, input: { folder?: string | null; originalName?: string }) {
  const a = await loadAsset(ctx, actor, id, "event.write");
  const [u] = await ctx.db
    .update(presentationAssets)
    .set({
      ...(input.folder !== undefined && { folder: input.folder?.trim().slice(0, 80) || null }),
      ...(input.originalName !== undefined && { originalName: cleanName(input.originalName) }),
    })
    .where(eq(presentationAssets.id, a.id))
    .returning();
  return toAssetDTO(u);
}

/** Exclui o arquivo da biblioteca somente se nenhuma apresentação o utiliza. */
export async function deleteAsset(ctx: AppContext, actor: Actor, id: string) {
  const a = await loadAsset(ctx, actor, id, "event.write");
  const [{ n }] = await ctx.db.select({ n: count() }).from(presentationItems).where(eq(presentationItems.assetId, a.id));
  if (Number(n) > 0) throw conflict("Este arquivo está em uso em apresentações. Remova os slides antes de excluí-lo.", "ARQUIVO_EM_USO");
  await ctx.db.delete(presentationAssets).where(eq(presentationAssets.id, a.id));
  await ctx.storage.remove(variantFiles(a).map((f) => keyOf(a.orgId, f)));
  await audit(ctx.db, actor, a.orgId, "asset.delete", "presentation_asset", a.id, { name: a.originalName });
}
