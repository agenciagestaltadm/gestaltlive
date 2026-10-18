import { describe, expect, it } from "vitest";
import { firstVisible, itemInputSchema, naturalSort, screenForItem, stepIndex, ITEM_TYPES } from "@shared/presentations";

describe("ordenação natural dos arquivos", () => {
  it("respeita os números (slide-2 antes de slide-10)", () => {
    const files = ["slide-10.png", "slide-1.png", "slide-3.png", "slide-2.png", "Slide-11.PNG", "capa.png"];
    expect(naturalSort(files, (f) => f)).toEqual(["capa.png", "slide-1.png", "slide-2.png", "slide-3.png", "slide-10.png", "Slide-11.PNG"]);
  });
  it("funciona com exportações do Canva (1.png, 2.png … 50.png)", () => {
    const files = Array.from({ length: 50 }, (_, i) => `${i + 1}.png`).reverse();
    expect(naturalSort(files, (f) => f).slice(0, 12)).toEqual(["1.png", "2.png", "3.png", "4.png", "5.png", "6.png", "7.png", "8.png", "9.png", "10.png", "11.png", "12.png"]);
  });
});

describe("navegação", () => {
  const hidden = [true, false, true, false, false, true];
  it("pula itens ocultos", () => {
    expect(firstVisible(hidden)).toBe(1);
    expect(stepIndex(hidden, 1, 1)).toBe(3);
    expect(stepIndex(hidden, 3, -1)).toBe(1);
  });
  it("retorna null nos limites", () => {
    expect(stepIndex(hidden, 4, 1)).toBeNull();
    expect(stepIndex(hidden, 1, -1)).toBeNull();
    expect(firstVisible([true, true])).toBeNull();
  });
});

describe("mapeamento item → telão", () => {
  it("cada tipo usa uma tela existente ou nova", () => {
    const map = Object.fromEntries(ITEM_TYPES.map((t) => [t, screenForItem(t)]));
    expect(map).toEqual({
      IMAGE_SLIDE: "SLIDE",
      QUESTION: "PERGUNTA",
      POLL: "PERGUNTA",
      QUIZ: "PERGUNTA",
      CHART: "RESULTADO",
      LEADERBOARD: "RANKING",
      SATISFACTION: "SATISFACAO",
      QR_CODE: "BOAS_VINDAS",
      AWARDS: "PREMIACAO",
      CUSTOM_SCREEN: "TELA_PERSONALIZADA",
    });
  });
});

describe("validação dos itens", () => {
  it("slide exige imagem; pergunta exige referência; tela personalizada exige texto", () => {
    expect(itemInputSchema.safeParse({ type: "IMAGE_SLIDE" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ type: "QUIZ" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ type: "CUSTOM_SCREEN" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ type: "CUSTOM_SCREEN", settings: { heading: "Intervalo" } }).success).toBe(true);
    expect(itemInputSchema.safeParse({ type: "LEADERBOARD" }).success).toBe(true);
  });
  it("padrões seguros: abrir manualmente, sem avançar automático, sem fechar ao sair", () => {
    const it = itemInputSchema.parse({ type: "QUESTION", questionId: "8b3c5f8e-6f1a-4a7e-9d61-0b2f3c4d5e6f" });
    expect(it.settings).toMatchObject({ openMode: "MANUAL", advanceAfterClose: false, closeOnLeave: false, autoCloseOnTimer: null });
  });
});
