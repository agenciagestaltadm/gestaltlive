/**
 * Nuvem de Palavras no navegador (critérios de aceitação 1–20):
 * cadastro pela tela "Nova pergunta", inserção na linha do tempo de uma apresentação, liberação pelo
 * apresentador, envios pelo celular, nuvem crescendo no telão, recarga, encerramento, exportação e
 * próximo item. Salva capturas de tela em test-results/nuvem-*.png.
 */
import { test, expect, devices, type Browser, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@e2e.test");
  await page.getByLabel("Senha").fill("SenhaE2E12345");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function joinPhone(browser: Browser, code: string, i: number) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const p = await ctx.newPage();
  await p.goto(`/entrar/${code}`);
  await p.getByLabel("Nome completo").fill(`Pessoa Nuvem ${i}`);
  await p.getByLabel("WhatsApp").fill(`119777${String(10000 + i)}`);
  await p.getByLabel("E-mail").fill(`nuvem${i}@e2e.test`);
  await p.getByText(/Autorizo o tratamento/).click();
  await p.getByRole("button", { name: "Entrar no treinamento" }).click();
  await expect(p).toHaveURL(new RegExp(`/s/${code}/ao-vivo`));
  return { ctx, p };
}

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/nuvem-${name}.png` });

test("nuvem de palavras: cadastro, apresentação, celular, telão, recarga, encerramento e exportação", async ({ browser, page }) => {
  test.setTimeout(240_000);
  await loginAdmin(page);
  const api = page.request;
  const orgId = (await (await api.get("/api/admin/orgs")).json())[0].id;
  const ev = (await (await api.get(`/api/admin/events?orgId=${orgId}`)).json())[0];

  // 1–4. Nova pergunta → Nuvem de Palavras → regras → salvar
  await page.goto(`/admin/eventos/${ev.id}/perguntas`);
  await page.getByRole("button", { name: "Nova pergunta" }).click();
  await page.getByRole("radio", { name: /Nuvem de palavras/ }).click();
  await page.getByLabel(/Enunciado/).fill("O que é marketing para você?");
  await page.getByRole("tab", { name: "Nuvem" }).click();
  await expect(page.getByText("Palavra-chave").first()).toBeVisible();
  await page.getByLabel(/Máximo de envios por participante/).fill("2");
  await page.getByRole("tab", { name: "Aparência" }).click();
  // pré-visualização antes de salvar (dados de demonstração)
  await expect(page.locator('[role="dialog"] [role="img"][aria-label^="Nuvem"] svg text').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, "1-editor-aparencia");
  await page.getByRole("button", { name: "Salvar pergunta" }).click();
  await expect(page.getByText("O que é marketing para você?")).toBeVisible();
  const qs = await (await api.get(`/api/admin/events/${ev.id}/questions`)).json();
  const wcq = qs.find((q: any) => q.title === "O que é marketing para você?");
  expect(wcq.type).toBe("NUVEM_PALAVRAS");
  expect(wcq.wordCloud.maxEntries).toBe(2);

  // 5. linha do tempo: nuvem (libera automaticamente) e o resultado como gráfico
  const pres = await (await api.post(`/api/admin/presentations?orgId=${orgId}`, { data: { title: "Palestra com nuvem", eventId: ev.id } })).json();
  const saved = await api.put(`/api/admin/presentations/${pres.id}/items`, {
    data: [
      { type: "CUSTOM_SCREEN", title: "Abertura", settings: { heading: "Marketing Digital" } },
      { type: "QUESTION", questionId: wcq.id, settings: { openMode: "AUTOMATICO" } },
      { type: "CHART", questionId: wcq.id },
      { type: "LEADERBOARD" },
    ],
  });
  expect(saved.ok()).toBe(true);

  // 6. sessão com a apresentação
  const s = await (await api.post(`/api/admin/events/${ev.id}/sessions`, { data: { name: "Turma nuvem E2E", presentationId: pres.id } })).json();
  await api.post(`/api/admin/sessions/${s.id}/lobby`, { data: {} });
  await api.post(`/api/admin/sessions/${s.id}/start`, { data: {} });
  const phones = [];
  for (let i = 1; i <= 3; i++) phones.push(await joinPhone(browser, s.code, i));
  const info = await (await api.get(`/api/admin/sessions/${s.id}`)).json();
  const tvCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const tv = await tvCtx.newPage();
  await tv.goto(new URL(info.screenUrl).pathname + new URL(info.screenUrl).search);

  // 7. apresentador: abertura → nuvem (liberada automaticamente)
  await page.goto(`/admin/sessoes/${s.id}/apresentador`);
  await expect(page.getByRole("region", { name: /Primeiro item|Próximo item/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Iniciar apresentação/i }).click();
  await expect.poll(async () => (await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json()).presenter.status).toBe("APRESENTANDO");
  await page.locator("body").press("ArrowRight");

  // 8–9. celulares recebem o campo de texto e enviam
  const [a, b, c] = phones.map((x) => x.p);
  await expect(a.getByRole("heading", { name: "O que é marketing para você?" })).toBeVisible({ timeout: 15_000 });
  await expect(a.getByLabel(/Sua resposta/)).toBeVisible();
  await expect(a.getByText(/Você pode enviar mais 2 respostas/)).toBeVisible();
  await a.getByLabel(/Sua resposta/).fill("Vendas");
  await a.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(a.getByText(/Resposta enviada/)).toBeVisible();
  await shot(a, "2-celular-enviado");
  await b.getByLabel(/Sua resposta/).fill("VENDAS");
  await b.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(b.getByText(/Resposta enviada/)).toBeVisible();
  await c.getByLabel(/Sua resposta/).fill("vendas");
  await c.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(c.getByText(/Resposta enviada/)).toBeVisible();
  await c.getByLabel(/Sua resposta/).fill("Relacionamento");
  await c.getByRole("button", { name: "Enviar resposta" }).click();
  // 13. limite de envios respeitado
  await expect(c.getByText(/Você usou os 2 envios/)).toBeVisible();
  await expect(c.getByLabel(/Sua resposta/)).toHaveCount(0);

  // 10–12. telão: a palavra aparece, cresce e maiúsculas/minúsculas viram um termo só
  const vendas = tv.locator('[role="img"][aria-label^="Nuvem"] svg text', { hasText: "Vendas" });
  await expect(vendas).toBeVisible({ timeout: 15_000 });
  await expect(tv.locator('[role="img"][aria-label^="Nuvem"] svg text title', { hasText: /^Vendas: 3 / })).toHaveCount(1, { timeout: 15_000 });
  await expect(tv.locator('[role="img"][aria-label^="Nuvem"] svg text', { hasText: /^VENDAS|^vendas/ })).toHaveCount(0);
  await tv.waitForTimeout(1500);
  await shot(tv, "3-telao-nuvem");

  // 14. palavra inadequada recusada no celular
  await b.getByLabel(/Sua resposta/).fill("merda");
  await b.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(b.getByText(/termos não permitidos/)).toBeVisible();

  // 15. recarregar o telão mantém a nuvem
  await tv.reload();
  await expect(vendas).toBeVisible({ timeout: 15_000 });

  // painel do palestrante: estatísticas e ranking dos termos
  const panel = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1600 } });
  const ctl = await panel.newPage();
  await ctl.goto(`/admin/sessoes/${s.id}/controle`);
  await expect(ctl.getByText(/Nuvem de palavras ao vivo/i)).toBeVisible({ timeout: 20_000 });
  await expect(ctl.locator("table").filter({ hasText: "Palavra" }).filter({ hasText: "Vendas" }).first()).toBeVisible();
  await ctl.waitForTimeout(1500);
  await shot(ctl, "4-painel");

  // 16–17. encerrar a pergunta: o resultado fica salvo
  const st = await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json();
  const sqId = st.presenter.sessionQuestionIds[wcq.id];
  await api.post(`/api/admin/sessions/${s.id}/questions/${sqId}/close`, { data: {} });
  await expect(a.getByText(/Envios encerrados/)).toBeVisible({ timeout: 15_000 });
  const res = await (await api.get(`/api/admin/sessions/${s.id}/results/${sqId}`)).json();
  expect(res.wordCloud.terms[0]).toMatchObject({ label: "Vendas", count: 3 });

  // 18. exportação
  const csv = await (await api.get(`/api/admin/sessions/${s.id}/export.csv?kind=nuvem`)).text();
  expect(csv).toContain("Relacionamento");
  expect(csv).toContain("TERMO_NAO_PERMITIDO");

  // 19. a apresentação segue: resultado (gráfico) e o próximo item
  await page.locator("body").press("ArrowRight");
  await expect(tv.getByText(/Nuvem de palavras · pergunta/)).toBeVisible({ timeout: 15_000 });
  await page.locator("body").press("ArrowRight");
  await expect.poll(async () => (await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json()).presenter.currentIndex).toBe(3);

  for (const x of phones) await x.ctx.close();
  await tvCtx.close();
  await panel.close();
});

test("nuvem de palavras no celular e no tablet sem rolagem horizontal", async ({ browser }) => {
  for (const device of [devices["iPhone 13"], devices["iPad Mini"]]) {
    const ctx = await browser.newContext({ ...device, locale: "pt-BR" });
    const page = await ctx.newPage();
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  }
});
