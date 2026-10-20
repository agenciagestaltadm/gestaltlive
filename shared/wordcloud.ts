/**
 * Nuvem de Palavras — normalização e agregação (funções puras, usadas no servidor, no editor e no ensaio).
 *
 * - Cada envio guarda o texto ORIGINAL (limpo) e as formas de superfície dos termos. As regras de
 *   agrupamento (maiúsculas, acentos, sinônimos, termos ocultos) são aplicadas na AGREGAÇÃO, então mudanças
 *   de moderação valem retroativamente sem reprocessar respostas.
 * - Modo PALAVRA: cada palavra significativa conta (artigos e preposições podem ser ignorados).
 *   Modo FRASE: a resposta inteira é uma expressão.
 * - O filtro de termos inadequados compara TOKENS inteiros (não trechos), evitando falsos positivos.
 */

export const WC_MODES = ["PALAVRA", "FRASE"] as const;
export type WordCloudMode = (typeof WC_MODES)[number];
export const WC_MODE_LABELS: Record<WordCloudMode, string> = { PALAVRA: "Palavra-chave", FRASE: "Frase curta" };

export const WC_STYLES = ["GESTALT", "COLORIDO", "MINIMALISTA"] as const;
export type WordCloudStyle = (typeof WC_STYLES)[number];
export const WC_STYLE_LABELS: Record<WordCloudStyle, string> = { GESTALT: "Gestalt", COLORIDO: "Colorido", MINIMALISTA: "Minimalista" };

export const WC_BACKGROUNDS = ["ESCURO", "CLARO"] as const;
export type WordCloudBackground = (typeof WC_BACKGROUNDS)[number];

export const WC_ANIMATIONS = ["SURGIR", "ZOOM", "NENHUMA"] as const;
export type WordCloudAnimation = (typeof WC_ANIMATIONS)[number];
export const WC_ANIMATION_LABELS: Record<WordCloudAnimation, string> = { SURGIR: "Surgir suavemente", ZOOM: "Zoom", NENHUMA: "Sem animação" };

/** Regras de coleta e agrupamento (fazem parte da versão da pergunta). */
export interface WordCloudRules {
  mode: WordCloudMode;
  maxWords: number;
  maxEntries: number;
  maxChars: number;
  allowRepeat: boolean;
  requireApproval: boolean;
  profanityFilter: boolean;
  groupEquivalent: boolean;
  ignoreCase: boolean;
  foldAccents: boolean;
  ignoreStopwords: boolean;
  blockedWords: string[];
  synonyms: { canonical: string; variants: string[] }[];
}

/** Aparência (editável durante a palestra). */
export interface WordCloudDisplay {
  style: WordCloudStyle;
  background: WordCloudBackground;
  animation: WordCloudAnimation;
  showFrequency: boolean;
  maxTerms: number;
}

export const DEFAULT_WORD_CLOUD_RULES: WordCloudRules = {
  mode: "PALAVRA",
  maxWords: 3,
  maxEntries: 1,
  maxChars: 50,
  allowRepeat: false,
  requireApproval: false,
  profanityFilter: true,
  groupEquivalent: true,
  ignoreCase: true,
  foldAccents: true,
  ignoreStopwords: true,
  blockedWords: [],
  synonyms: [],
};

export const DEFAULT_WORD_CLOUD_DISPLAY: WordCloudDisplay = {
  style: "GESTALT",
  background: "ESCURO",
  animation: "SURGIR",
  showFrequency: false,
  maxTerms: 60,
};

/* ------------------------------------------------------------------ limpeza e dobra */
/** Controles e caracteres invisíveis (zero-width, separadores de linha, BOM). */
const CONTROL = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF]", "g");
/** Mantém letras (qualquer alfabeto), números, espaço, hífen e apóstrofo. */
const NOT_ALLOWED = /[^\p{L}\p{N}\s'-]/gu;

/** Remove controles, caracteres invisíveis, símbolos e espaços sobrando. Nunca devolve HTML. */
export function cleanText(raw: string): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(CONTROL, " ")
    .replace(/[’`´]/g, "'")
    .replace(NOT_ALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripAccents(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Dobra completa (minúsculas + sem acentos) — usada em filtros, sinônimos e regras de moderação. */
export function fullFold(s: string) {
  return stripAccents(s.toLocaleLowerCase("pt-BR")).trim();
}

/** Palavras de um texto já limpo (sem hífens/apóstrofos soltos nas pontas). */
export function tokenize(clean: string): string[] {
  return clean
    .split(" ")
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

/* ------------------------------------------------------------------ palavras comuns e filtro */
export const STOPWORDS_PT = new Set(
  (
    "a o as os um uma uns umas de da do das dos d em na no nas nos num numa nuns numas por pela pelo pelas pelos " +
    "para pra pro pras pros com sem sob sobre entre ate e ou que se ao aos a as e ser sao foi era sou esta estao " +
    "mais muito muita muitos muitas pouco meu minha meus minhas seu sua seus suas nosso nossa nossos nossas teu tua " +
    "eu tu ele ela nos vos eles elas voce voces isso isto aquilo esse essa esses essas este esta estes estas aquele " +
    "aquela aqueles aquelas lhe lhes me te mim ti ja como quando onde porque pois mas tambem so tem ter ha tipo"
  ).split(" "),
);

/** Lista base de termos inadequados (comparação por token inteiro, sem acentos, com troca simples de leetspeak). */
const PROFANITY_PT = new Set(
  (
    "porra caralho caraio krl crl merda bosta foda foder fodase fodido fodida puta puto putaria putinha buceta boceta " +
    "xoxota cu cuzao cuzona arrombado arrombada babaca otario otaria vagabundo vagabunda corno corna cacete punheta " +
    "fdp vsf tnc pqp prr imbecil retardado retardada escroto escrota viado desgracado desgracada filhodaputa " +
    "piroca pica pau-no-cu vtnc"
  ).split(" "),
);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };
const unleet = (s: string) => s.replace(/[013457@$]/g, (c) => LEET[c] ?? c);

/** Termos proibidos encontrados no texto (lista base opcional + bloqueios da pergunta + bloqueios da sessão). */
export function forbiddenTerms(clean: string, opts: { profanityFilter: boolean; blocked: string[] }): string[] {
  const words = tokenize(clean).map(fullFold);
  const variants = new Set(words.flatMap((w) => [w, unleet(w), w.replace(/-/g, "")]));
  const phrase = fullFold(clean);
  const hits = new Set<string>();
  if (opts.profanityFilter) for (const v of variants) if (PROFANITY_PT.has(v)) hits.add(v);
  for (const b of opts.blocked) {
    const k = fullFold(cleanText(b));
    if (!k) continue;
    // bloqueio de uma palavra: token inteiro; de uma expressão: a expressão inteira dentro da resposta
    if (k.includes(" ") ? ` ${phrase} `.includes(` ${k} `) : variants.has(k)) hits.add(k);
  }
  return [...hits];
}

/* ------------------------------------------------------------------ preparação de um envio */
export type PrepareError = "VAZIA" | "MUITO_LONGA" | "PALAVRAS_DEMAIS" | "SEM_PALAVRAS" | "TERMO_NAO_PERMITIDO";

export type PreparedEntry =
  | { ok: true; original: string; normalized: string; terms: string[] }
  | { ok: false; code: PrepareError; message: string; original: string };

export function prepareEntry(raw: string, rules: WordCloudRules, extraBlocked: string[] = []): PreparedEntry {
  const original = cleanText(raw);
  if (!original) return { ok: false, code: "VAZIA", message: "Digite uma palavra ou frase.", original };
  if (original.length > rules.maxChars) {
    return { ok: false, code: "MUITO_LONGA", message: `Use no máximo ${rules.maxChars} caracteres.`, original };
  }
  const words = tokenize(original);
  const meaningful = rules.mode === "PALAVRA" && rules.ignoreStopwords ? words.filter((w) => !STOPWORDS_PT.has(fullFold(w))) : words;
  if (meaningful.length === 0) return { ok: false, code: "SEM_PALAVRAS", message: "Use palavras com significado (artigos e preposições não contam).", original };
  if (meaningful.length > rules.maxWords) {
    const n = rules.maxWords;
    return { ok: false, code: "PALAVRAS_DEMAIS", message: n === 1 ? "Envie apenas uma palavra." : `Use no máximo ${n} palavras.`, original };
  }
  const hits = forbiddenTerms(original, { profanityFilter: rules.profanityFilter, blocked: [...rules.blockedWords, ...extraBlocked] });
  if (hits.length) return { ok: false, code: "TERMO_NAO_PERMITIDO", message: "Sua resposta contém termos não permitidos. Tente outra palavra.", original };
  return {
    ok: true,
    original,
    normalized: fullFold(original),
    terms: rules.mode === "PALAVRA" ? meaningful : [original],
  };
}

/* ------------------------------------------------------------------ agregação */
export interface WordCloudTerm {
  /** Chave de agrupamento (estável; usada para moderação e animação). */
  key: string;
  label: string;
  count: number;
  /** Percentual sobre o denominador explícito (`denominator`). */
  pct: number;
}

export interface WordCloudAggregate {
  terms: WordCloudTerm[];
  /** TERMOS: total de ocorrências de termos (modo palavra) · RESPOSTAS: envios aprovados (modo frase). */
  denominator: { kind: "TERMOS" | "RESPOSTAS"; value: number };
  totals: { entries: number; termOccurrences: number; uniqueTerms: number; respondents: number };
}

type GroupingRules = Pick<WordCloudRules, "mode" | "groupEquivalent" | "ignoreCase" | "foldAccents" | "synonyms">;

/** Chave de um termo pelas regras atuais (sem sinônimos). */
export function termKey(surface: string, rules: GroupingRules): string {
  if (!rules.groupEquivalent) return surface;
  let k = surface;
  if (rules.ignoreCase) k = k.toLocaleLowerCase("pt-BR");
  if (rules.foldAccents) k = stripAccents(k);
  return k;
}

function synonymMap(rules: GroupingRules) {
  const map = new Map<string, string>(); // dobra completa da variante → rótulo canônico
  for (const g of rules.synonyms ?? []) {
    const canonical = cleanText(g.canonical);
    if (!canonical) continue;
    for (const v of [canonical, ...g.variants]) {
      const f = fullFold(cleanText(v));
      if (f) map.set(f, canonical);
    }
  }
  return map;
}

const hasAccent = (s: string) => s !== stripAccents(s);
const upper = (s: string) => s.toLocaleUpperCase("pt-BR");
const lower = (s: string) => s.toLocaleLowerCase("pt-BR");
const isCapitalized = (s: string) => s.length > 1 && s[0] === upper(s[0]) && s[0] !== lower(s[0]) && s.slice(1) !== upper(s.slice(1));
const isAllCaps = (s: string) => s === upper(s) && s !== lower(s);

/**
 * Rótulo exibido para um grupo de formas digitadas:
 * 1. a grafia (com/sem acento) mais usada, ignorando maiúsculas — "Automação" vence "automacao" no empate;
 * 2. dentro dela, a forma capitalizada ("Vendas"); siglas curtas em maiúsculas ("CRM");
 * 3. se ninguém capitalizou, a primeira letra vira maiúscula.
 */
function displayLabel(surfaces: Map<string, number>): string {
  const spelling = new Map<string, { total: number; forms: Map<string, number> }>();
  for (const [s, n] of surfaces) {
    const k = lower(s);
    const e = spelling.get(k) ?? { total: 0, forms: new Map() };
    e.total += n;
    e.forms.set(s, (e.forms.get(s) ?? 0) + n);
    spelling.set(k, e);
  }
  const [base, group] = [...spelling.entries()].sort((a, b) => b[1].total - a[1].total || Number(hasAccent(b[0])) - Number(hasAccent(a[0])) || a[0].localeCompare(b[0], "pt-BR"))[0];
  const forms = [...group.forms.entries()].sort((a, b) => b[1] - a[1]);
  const capitalized = forms.find(([f]) => isCapitalized(f));
  const acronym = forms.find(([f]) => isAllCaps(f) && f.replace(/[^\p{L}]/gu, "").length <= 5);
  if (acronym && (!capitalized || acronym[1] >= capitalized[1])) return acronym[0];
  if (capitalized) return capitalized[0];
  return upper(base[0]) + base.slice(1);
}

/**
 * Agrega envios aprovados em termos ordenados (frequência desc, chave asc).
 * `hidden`: dobras completas de termos ocultos/bloqueados — deixam de contar, mas os envios seguem registrados.
 */
export function aggregateWordCloud(
  entries: { terms: string[]; participantId: string }[],
  rules: GroupingRules,
  opts: { hidden?: Iterable<string>; maxTerms?: number } = {},
): WordCloudAggregate {
  const hidden = new Set([...(opts.hidden ?? [])].map(fullFold));
  const syn = synonymMap(rules);
  const groups = new Map<string, { count: number; forced: string | null; surfaces: Map<string, number> }>();
  const respondents = new Set<string>();
  let occurrences = 0;
  let counted = 0;
  for (const e of entries) {
    let any = false;
    for (const raw of e.terms) {
      const surface = cleanText(raw);
      if (!surface) continue;
      const canonical = syn.get(fullFold(surface)) ?? null;
      const key = canonical ? termKey(canonical, { ...rules, groupEquivalent: true, ignoreCase: true, foldAccents: true }) : termKey(surface, rules);
      if (hidden.has(fullFold(key))) continue;
      const g = groups.get(key) ?? { count: 0, forced: canonical, surfaces: new Map() };
      g.count++;
      g.surfaces.set(surface, (g.surfaces.get(surface) ?? 0) + 1);
      groups.set(key, g);
      occurrences++;
      any = true;
    }
    if (any) {
      counted++;
      respondents.add(e.participantId);
    }
  }
  const denominator = rules.mode === "FRASE" ? { kind: "RESPOSTAS" as const, value: counted } : { kind: "TERMOS" as const, value: occurrences };
  const all = [...groups.entries()].map(([key, g]) => ({
    key,
    label: g.forced ?? displayLabel(g.surfaces),
    count: g.count,
    pct: denominator.value ? Math.round((g.count / denominator.value) * 1000) / 10 : 0,
  }));
  all.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "pt-BR"));
  const max = opts.maxTerms ?? Infinity;
  return {
    terms: all.slice(0, max),
    denominator,
    totals: { entries: counted, termOccurrences: occurrences, uniqueTerms: all.length, respondents: respondents.size },
  };
}

/** Dados demonstrativos (pré-visualização do editor, galeria e ensaio). */
export const DEMO_WORD_CLOUD: { label: string; count: number }[] = [
  { label: "Prospecção", count: 30 },
  { label: "Clientes", count: 22 },
  { label: "Marketing", count: 18 },
  { label: "Tempo", count: 14 },
  { label: "Negociação", count: 12 },
  { label: "CRM", count: 9 },
  { label: "Concorrência", count: 8 },
  { label: "Preço", count: 7 },
  { label: "Equipe", count: 6 },
  { label: "Redes sociais", count: 5 },
  { label: "Follow-up", count: 5 },
  { label: "Fechamento", count: 4 },
  { label: "Leads", count: 4 },
  { label: "Objeções", count: 3 },
  { label: "Indicações", count: 3 },
  { label: "WhatsApp", count: 3 },
  { label: "Metas", count: 2 },
  { label: "Confiança", count: 2 },
  { label: "Pós-venda", count: 2 },
  { label: "Foco", count: 1 },
];
