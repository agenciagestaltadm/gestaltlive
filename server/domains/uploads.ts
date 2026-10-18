/**
 * Upload de imagens (logos, perguntas, alternativas, prêmios).
 * Validação pelo conteúdo (assinatura binária), não pela extensão. SVG não é aceito (risco de XSS).
 */
import crypto from "node:crypto";
import type { AppContext } from "../context";
import { badRequest, notFound } from "../lib/errors";

const TYPES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: "png", mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mime: "image/gif", test: (b) => b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a" },
  { ext: "webp", mime: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;

export async function saveUpload(ctx: AppContext, orgId: string, file: File) {
  if (file.size > ctx.config.maxUploadBytes) {
    throw badRequest(`Imagem muito grande (máximo ${(ctx.config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB).`);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const type = TYPES.find((t) => t.test(buf));
  if (!type) throw badRequest("Formato não suportado. Envie PNG, JPG, GIF ou WEBP.");
  const name = `${crypto.randomBytes(16).toString("hex")}.${type.ext}`;
  await ctx.storage.put(`${orgId}/${name}`, buf, type.mime);
  return { url: `/api/uploads/${orgId}/${name}`, size: buf.length, mime: type.mime };
}

/** Lê uma imagem enviada. No Supabase Storage devolve a URL pública (a rota redireciona). */
export async function readUpload(ctx: AppContext, orgId: string, name: string): Promise<{ redirect: string } | { data: Buffer; mime: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !NAME_RE.test(name)) throw notFound();
  const key = `${orgId}/${name}`;
  const direct = ctx.storage.publicUrl(key);
  if (direct) return { redirect: direct };
  const data = await ctx.storage.get(key);
  if (!data) throw notFound();
  const ext = name.split(".").pop()!;
  return { data, mime: TYPES.find((t) => t.ext === ext)!.mime };
}
