import { describe, expect, it } from "vitest";
import { aggregateWordCloud, cleanText, DEFAULT_WORD_CLOUD_RULES, forbiddenTerms, prepareEntry, type WordCloudRules } from "@shared/wordcloud";
import { questionInputSchema, wordCloudConfigSchema } from "@shared/schemas";
import { checkChart, chartContextForQuestion, compatibleCharts, defaultChartFor } from "@shared/charts/compat";

const rules = (p: Partial<WordCloudRules> = {}): WordCloudRules => ({ ...DEFAULT_WORD_CLOUD_RULES, ...p });
const entries = (...texts: string[][]) => texts.map((terms, i) => ({ terms, participantId: `p${i}` }));

describe("nuvem de palavras: limpeza e validação", () => {
  it("remove símbolos, controles, HTML e espaços sobrando", () => {
    expect(cleanText("  <b>Vendas</b>!!!  ​  ")).toBe("b Vendas b");
    expect(cleanText("Pós-venda   e\tCRM")).toBe("Pós-venda e CRM");
    expect(cleanText("<script>alert(1)</script>")).not.toMatch(/[<>()]/);
  });

  it("valida vazio, tamanho e quantidade de palavras significativas", () => {
    expect(prepareEntry("   ", rules())).toMatchObject({ ok: false, code: "VAZIA" });
    expect(prepareEntry("a".repeat(51), rules())).toMatchObject({ ok: false, code: "MUITO_LONGA" });
    expect(prepareEntry("vendas clientes preço tempo", rules())).toMatchObject({ ok: false, code: "PALAVRAS_DEMAIS" });
    expect(prepareEntry("de a o", rules())).toMatchObject({ ok: false, code: "SEM_PALAVRAS" });
    // artigos e preposições não contam no limite de palavras
    const ok = prepareEntry("Falta de clientes", rules());
    expect(ok).toMatchObject({ ok: true, terms: ["Falta", "clientes"] });
  });

  it("modo frase trata a resposta inteira como uma expressão", () => {
    expect(prepareEntry("Falta de clientes", rules({ mode: "FRASE", maxWords: 5 }))).toMatchObject({ ok: true, terms: ["Falta de clientes"] });
  });

  it("filtro compara palavras inteiras (sem falso positivo em palavras que contêm o termo)", () => {
    expect(forbiddenTerms("que merda", { profanityFilter: true, blocked: [] })).toEqual(["merda"]);
    expect(forbiddenTerms("M3RDA", { profanityFilter: true, blocked: [] })).toEqual(["merda"]);
    expect(forbiddenTerms("cupom e custo", { profanityFilter: true, blocked: [] })).toEqual([]);
    expect(forbiddenTerms("Concorrência", { profanityFilter: false, blocked: ["concorrencia"] })).toEqual(["concorrencia"]);
    expect(prepareEntry("porra", rules())).toMatchObject({ ok: false, code: "TERMO_NAO_PERMITIDO" });
    expect(prepareEntry("porra", rules({ profanityFilter: false }))).toMatchObject({ ok: true });
  });
});

describe("nuvem de palavras: agregação", () => {
  it("VENDAS, vendas e Vendas são o mesmo termo; acento opcional", () => {
    const agg = aggregateWordCloud(entries(["VENDAS"], ["vendas"], ["Vendas"], ["Automação"], ["automacao"]), rules());
    expect(agg.terms.map((t) => [t.label, t.count])).toEqual([
      ["Vendas", 3],
      ["Automação", 2],
    ]);
    const semDobra = aggregateWordCloud(entries(["Automação"], ["automacao"]), rules({ foldAccents: false }));
    expect(semDobra.terms).toHaveLength(2);
  });

  it("sinônimos configurados agrupam sob o termo canônico", () => {
    const agg = aggregateWordCloud(entries(["cliente"], ["Clientes"], ["CLIENTE"]), rules({ synonyms: [{ canonical: "Clientes", variants: ["cliente"] }] }));
    expect(agg.terms).toEqual([{ key: "clientes", label: "Clientes", count: 3, pct: 100 }]);
  });

  it("denominador explícito: termos no modo palavra, respostas no modo frase", () => {
    const palavra = aggregateWordCloud(entries(["Vendas", "CRM"], ["Vendas"]), rules());
    expect(palavra.denominator).toEqual({ kind: "TERMOS", value: 3 });
    expect(palavra.terms[0]).toMatchObject({ label: "Vendas", count: 2, pct: 66.7 });
    const frase = aggregateWordCloud(entries(["Falta de clientes"], ["falta de clientes"], ["Preço"]), rules({ mode: "FRASE" }));
    expect(frase.denominator).toEqual({ kind: "RESPOSTAS", value: 3 });
    expect(frase.terms[0]).toMatchObject({ count: 2, pct: 66.7 });
    expect(frase.totals.respondents).toBe(3);
  });

  it("termos ocultos deixam de contar e o limite de termos exibidos é respeitado", () => {
    const agg = aggregateWordCloud(entries(["Vendas"], ["Vendas"], ["Spam"], ["CRM"]), rules(), { hidden: ["spam"], maxTerms: 1 });
    expect(agg.terms).toEqual([{ key: "vendas", label: "Vendas", count: 2, pct: 66.7 }]);
    expect(agg.totals.uniqueTerms).toBe(2);
  });
});

describe("nuvem de palavras: tipo de pergunta e gráfico", () => {
  it("só a nuvem é compatível com o tipo, e a nuvem só com ele", () => {
    const ctx = chartContextForQuestion({ type: "NUVEM_PALAVRAS", optionCount: 0, maxSelections: 1 });
    expect(compatibleCharts(ctx)).toEqual(["wordcloud"]);
    expect(defaultChartFor(ctx)).toBe("wordcloud");
    expect(checkChart("wordcloud", chartContextForQuestion({ type: "PERFIL", optionCount: 3, maxSelections: 1 })).compatible).toBe(false);
  });

  it("schema aplica os padrões e recusa alternativas ou pontuação", () => {
    expect(wordCloudConfigSchema.parse({})).toMatchObject({ maxWords: 3, maxEntries: 1, maxChars: 50, profanityFilter: true, groupEquivalent: true });
    const base = { type: "NUVEM_PALAVRAS", title: "Qual palavra?", chart: { type: "wordcloud" }, wordCloud: {} };
    expect(questionInputSchema.safeParse(base).success).toBe(true);
    expect(questionInputSchema.safeParse({ ...base, options: [{ label: "a" }, { label: "b" }] }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...base, chart: { type: "donut" } }).success).toBe(false);
    expect(questionInputSchema.safeParse({ type: "PERFIL", title: "x", chart: { type: "wordcloud" }, options: [{ label: "a" }, { label: "b" }] }).success).toBe(false);
  });
});
