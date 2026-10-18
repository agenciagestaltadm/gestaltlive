/**
 * Gerenciador de Apresentações no navegador: upload em lote pelo editor, linha do tempo com
 * pergunta e gráfico, ensaio, apresentação real com teclado (passador), telão com a imagem,
 * celular recebendo a pergunta, volta ao slide, recarga do apresentador e duplicação.
 */
import { test, expect, devices, type Page } from "@playwright/test";
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@e2e.test");
  await page.getByLabel("Senha").fill("SenhaE2E12345");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function makeSlides(n: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gl-slides-"));
  const files: string[] = [];
  for (let i = n; i >= 1; i--) {
    const f = path.join(dir, `slide-${i}.png`);
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="#0B1736"/><text x="960" y="600" font-size="220" fill="#FF0068" text-anchor="middle" font-family="Arial">SLIDE ${i}</text></svg>`);
    await sharp(svg).png().toFile(f);
    files.push(f);
  }
  return files;
}

test("apresentação completa: upload em lote, linha do tempo, ensaio, apresentar e duplicar", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await loginAdmin(page);
  const api = page.request;
  const orgs = await (await api.get("/api/admin/orgs")).json();
  const orgId = orgs[0].id;
  const events = await (await api.get(`/api/admin/events?orgId=${orgId}`)).json();
  const ev = events[0];
  const qs = await (await api.get(`/api/admin/events/${ev.id}/questions`)).json();

  // 1. cria a apresentação e envia 12 slides pelo editor (seletor de arquivos múltiplo)
  const pres = await (await api.post(`/api/admin/presentations?orgId=${orgId}`, { data: { title: "Palestra E2E", eventId: ev.id } })).json();
  await page.goto(`/admin/apresentacoes/${pres.id}`);
  const files = await makeSlides(12);
  await page.locator('input[type="file"]').first().setInputFiles(files);
  await expect
    .poll(async () => (await (await api.get(`/api/admin/presentations/${pres.id}`)).json()).items.length, { timeout: 60_000 })
    .toBe(12);
  const afterUpload = await (await api.get(`/api/admin/presentations/${pres.id}`)).json();
  expect(afterUpload.items.slice(0, 11).map((i: any) => i.title)).toEqual(Array.from({ length: 11 }, (_, i) => `slide-${i + 1}`));
  // miniaturas carregadas (não as originais)
  await expect(page.locator('img[src*="-mini.webp"]').first()).toBeVisible();
  expect(await page.locator('img[src*="-orig."]').count()).toBe(0);

  // 2. intercala pergunta (automática), gráfico, ranking e premiação; notas no 1º slide
  const items = afterUpload.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, assetId: i.assetId, settings: i.settings, notes: null }));
  items[0].notes = "NOTA SECRETA DO PALESTRANTE";
  const timeline = [
    items[0],
    items[1],
    { type: "QUESTION", questionId: qs[0].id, settings: { openMode: "AUTOMATICO" } },
    { type: "CHART", questionId: qs[0].id },
    items[2],
    { type: "LEADERBOARD" },
    { type: "AWARDS" },
    ...items.slice(3),
  ];
  const saved = await (await api.put(`/api/admin/presentations/${pres.id}/items`, { data: timeline })).json();
  expect(saved.items).toHaveLength(16);

  // 3. ensaio: navega sem gravar nada
  await page.goto(`/admin/apresentacoes/${pres.id}/ensaio`);
  await expect(page.getByText(/MODO ENSAIO/i).first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Qual é o principal segmento do seu negócio?").first()).toBeVisible();

  // 4. sessão real com a apresentação
  const s = await (await api.post(`/api/admin/events/${ev.id}/sessions`, { data: { name: "Turma Apresentação", presentationId: pres.id } })).json();
  await api.post(`/api/admin/sessions/${s.id}/lobby`, { data: {} });
  await api.post(`/api/admin/sessions/${s.id}/start`, { data: {} });
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const p = await phone.newPage();
  await p.goto(`/entrar/${s.code}`);
  await p.getByLabel("Nome completo").fill("Carlos Slide Teste");
  await p.getByLabel("WhatsApp").fill("11966665555");
  await p.getByLabel("E-mail").fill("carlos@e2e.test");
  await p.getByText(/Autorizo o tratamento/).click();
  await p.getByRole("button", { name: "Entrar no treinamento" }).click();
  await expect(p).toHaveURL(new RegExp(`/s/${s.code}/ao-vivo`));

  const info = await (await api.get(`/api/admin/sessions/${s.id}`)).json();
  const tvCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const tv = await tvCtx.newPage();
  await tv.goto(new URL(info.screenUrl).pathname + new URL(info.screenUrl).search);

  await page.goto(`/admin/sessoes/${s.id}/apresentador`);
  // antes de iniciar, as notas do 1º item já aparecem para o palestrante preparar a abertura
  await expect(page.getByText(/NOTA SECRETA/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Iniciar apresentação/i }).click();
  await expect.poll(async () => (await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json()).presenter.status).toBe("APRESENTANDO");
  // telão mostra a imagem do slide 1 (variante "tela") e nunca as notas
  await expect(tv.locator('img[src*="-tela.webp"]').first()).toBeVisible();
  await expect(tv.getByText(/NOTA SECRETA/)).toHaveCount(0);
  await expect(p.getByText(/Acompanhe a apresentação/)).toBeVisible();

  // 5. passador de slides: Page Down / seta direita
  await page.locator("body").press("PageDown"); // slide 2
  await page.locator("body").press("ArrowRight"); // pergunta automática
  await expect(p.getByRole("heading", { name: "Qual é o principal segmento do seu negócio?" })).toBeVisible();
  await expect(tv.getByRole("heading", { name: "Qual é o principal segmento do seu negócio?" })).toBeVisible();
  await p.getByRole("radio", { name: /Serviços/ }).click();
  await p.getByRole("button", { name: "Confirmar resposta" }).click();
  await expect(p.getByText(/Resposta enviada/)).toBeVisible();

  // 6. volta para o slide anterior: a pergunta continua aberta no celular
  await page.locator("body").press("ArrowLeft");
  await expect(tv.locator('img[src*="-tela.webp"]').first()).toBeVisible();
  await expect(p.getByText(/Resposta enviada/)).toBeVisible();

  // 7. recarregar o apresentador mantém a posição
  await page.reload();
  await expect(page.getByRole("region", { name: "Próximo item" })).toBeVisible({ timeout: 20_000 });
  const st = await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json();
  expect(st.presenter.currentIndex).toBe(1);

  // 8. avança até o gráfico (fecha a pergunta pela API de controle) e ao ranking/premiação
  const sqId = st.presenter.sessionQuestionIds[qs[0].id];
  await api.post(`/api/admin/sessions/${s.id}/questions/${sqId}/close`, { data: {} });
  for (const idx of [2, 3]) {
    await page.locator("body").press("ArrowRight");
    await expect.poll(async () => (await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json()).presenter.currentIndex).toBe(idx);
  }
  await expect(tv.getByText(/Resultado/).first()).toBeVisible();
  for (const idx of [4, 5, 6]) {
    await page.locator("body").press("ArrowRight");
    await expect.poll(async () => (await (await api.get(`/api/admin/sessions/${s.id}/presenter`)).json()).presenter.currentIndex).toBe(idx);
  }
  await expect(tv.getByText(/Vencedores|Pódio parcial|Prêmios de hoje/).first()).toBeVisible();

  // 9. duplicar para um novo evento
  const ev2 = await (await api.post(`/api/admin/events?orgId=${orgId}`, { data: { title: "Novo evento E2E" } })).json();
  const dup = await (await api.post(`/api/admin/presentations/${pres.id}/duplicate`, { data: { targetEventId: ev2.id } })).json();
  expect(dup.items).toHaveLength(16);
  expect(dup.eventId).toBe(ev2.id);

  await phone.close();
  await tvCtx.close();
});

test("editor e apresentador usáveis em celular e tablet", async ({ browser }) => {
  for (const device of [devices["iPhone 13"], devices["iPad Mini"]]) {
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    await loginAdmin(page);
    await page.goto("/admin/apresentacoes");
    await expect(page.getByText("Palestra E2E").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  }
});
