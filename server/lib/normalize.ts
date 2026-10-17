/** Normalização de identificadores para a política de unicidade. */

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

/**
 * Normaliza telefones brasileiros para E.164 sem "+": 55 + DDD + número.
 * Aceita "(11) 98888-7777", "+55 11 98888-7777", "11988887777".
 * Retorna null quando não é possível reconhecer um número válido.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = Number(d.slice(2, 4));
    if (ddd < 11 || ddd > 99) return null;
    return d;
  }
  // números internacionais: 8–15 dígitos (E.164)
  if (!d.startsWith("55") && d.length >= 8 && d.length <= 15) return d;
  return null;
}

/** Remove caracteres de controle e espaços repetidos de textos livres. */
export function cleanText(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

export function firstName(fullName: string): string {
  return cleanText(fullName).split(" ")[0] ?? fullName;
}

export function firstNameInitial(fullName: string): string {
  const parts = cleanText(fullName).split(" ");
  if (parts.length < 2) return parts[0] ?? fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase()}.`;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
