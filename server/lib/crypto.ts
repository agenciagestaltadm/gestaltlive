import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hash de senha: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Token aleatório opaco (enviado ao cliente). Apenas o hash SHA-256 é persistido. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Alfabeto sem caracteres ambíguos (sem 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function shortCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

export function numericCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
