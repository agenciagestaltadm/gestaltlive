import { describe, expect, it } from "vitest";
import { firstNameInitial, normalizeEmail, normalizePhone } from "@server/lib/normalize";
import { questionInputSchema } from "@shared/schemas";

describe("normalização", () => {
  it("e-mail", () => {
    expect(normalizeEmail("  Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
    expect(normalizeEmail("invalido@")).toBeNull();
  });
  it("telefone brasileiro em formatos variados", () => {
    expect(normalizePhone("(11) 98888-7777")).toBe("5511988887777");
    expect(normalizePhone("+55 11 98888-7777")).toBe("5511988887777");
    expect(normalizePhone("11988887777")).toBe("5511988887777");
    expect(normalizePhone("1133334444")).toBe("551133334444");
    expect(normalizePhone("123")).toBeNull();
  });
  it("nome de exibição", () => {
    expect(firstNameInitial("Ana Paula Souza")).toBe("Ana S.");
  });
});

describe("validação de perguntas por modalidade", () => {
  const chart = { type: "bar_vertical" as const };
  it("pesquisa não pode ter resposta correta", () => {
    const r = questionInputSchema.safeParse({ type: "OPINIAO", title: "x", chart, options: [{ label: "a", isCorrect: true }, { label: "b" }] });
    expect(r.success).toBe(false);
  });
  it("conhecimento exige exatamente uma correta e pontuação", () => {
    expect(questionInputSchema.safeParse({ type: "CONHECIMENTO", title: "x", chart, options: [{ label: "a" }, { label: "b" }] }).success).toBe(false);
    expect(
      questionInputSchema.safeParse({ type: "CONHECIMENTO", title: "x", chart, scoring: {}, options: [{ label: "a", isCorrect: true }, { label: "b" }] }).success,
    ).toBe(true);
  });
  it("múltiplas corretas exige seleção mínima de 2", () => {
    const base = { type: "MULTIPLA_CORRETA", title: "x", chart, scoring: {}, maxSelections: 3, options: [{ label: "a", isCorrect: true }, { label: "b", isCorrect: true }, { label: "c" }] };
    expect(questionInputSchema.safeParse({ ...base, minSelections: 1 }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...base, minSelections: 2 }).success).toBe(true);
  });
  it("bônus por velocidade exige tempo limite", () => {
    const r = questionInputSchema.safeParse({
      type: "CONHECIMENTO",
      title: "x",
      chart,
      scoring: { speedBonusEnabled: true },
      options: [{ label: "a", isCorrect: true }, { label: "b" }],
    });
    expect(r.success).toBe(false);
  });
});
