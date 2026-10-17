/**
 * Fluxo principal em navegador real: login do administrador, sessão ao vivo, cadastro do
 * participante no celular, liberação da pergunta no painel, resposta, satisfação, telão e pódio.
 */
import { test, expect, devices, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@e2e.test");
  await page.getByLabel("Senha").fill("SenhaE2E12345");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("sessão ao vivo de ponta a ponta (desktop + celular + telão)", async ({ browser, page }) => {
  // administrador
  await loginAdmin(page);
  await expect(page.getByRole("heading", { name: /Olá/ })).toBeVisible();
  const api = page.request;
  const orgs = await (await api.get("/api/admin/orgs")).json();
  const events = await (await api.get(`/api/admin/events?orgId=${orgs[0].id}`)).json();
  const ev = events[0];
  const s = await (await api.post(`/api/admin/events/${ev.id}/sessions`, { data: { name: "Turma E2E" } })).json();
  await api.post(`/api/admin/sessions/${s.id}/lobby`, { data: {} });

  // participante no celular
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const p = await phone.newPage();
  await p.goto(`/entrar/${s.code}`);
  await expect(p.getByText(ev.title)).toBeVisible();
  await p.getByLabel("Nome completo").fill("Joana Teste Lima");
  await p.getByLabel("Como quer aparecer no ranking?").fill("Joana");
  await p.getByLabel("WhatsApp").fill("11977776666");
  await p.getByLabel("E-mail").fill("joana@e2e.test");
  await p.getByText(/Autorizo o tratamento/).click();
  await p.getByRole("button", { name: "Entrar no treinamento" }).click();
  await expect(p).toHaveURL(new RegExp(`/s/${s.code}/ao-vivo`));
  await expect(p.getByText(/Você está dentro/)).toBeVisible();
  // botões de satisfação sempre acessíveis
  await expect(p.getByRole("button", { name: "Valeu a pena" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Insatisfeito" })).toBeVisible();

  // palestrante inicia e libera a primeira pergunta pelo painel
  await page.goto(`/admin/sessoes/${s.id}/controle`);
  await page.getByRole("button", { name: "Iniciar sessão" }).click();
  await expect(page.getByText("Ao vivo").first()).toBeVisible();
  await page.getByRole("button", { name: "Liberar pergunta" }).click();

  // a pergunta chega ao celular sem recarregar
  await expect(p.getByText("Qual é o principal segmento do seu negócio?")).toBeVisible();
  await p.getByRole("radio", { name: /Serviços/ }).click();
  await p.getByRole("button", { name: "Confirmar resposta" }).click();
  await expect(p.getByText(/Resposta enviada/)).toBeVisible();

  // o painel recebe a resposta em tempo real
  await expect(page.getByText(/1 respondente/).first()).toBeVisible();

  // satisfação (troca de avaliação reflete só o voto atual)
  await p.getByRole("button", { name: "Insatisfeito" }).click();
  await p.getByRole("button", { name: "Valeu a pena" }).click();
  await expect(p.getByRole("button", { name: "Valeu a pena" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("100%").first()).toBeVisible();

  // reconexão: recarregar a página mantém a identidade e a resposta
  await p.reload();
  await expect(p.getByText(/Resposta enviada/)).toBeVisible();

  // telão
  const info = await (await api.get(`/api/admin/sessions/${s.id}`)).json();
  const screen = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const tv = await screen.newPage();
  await tv.goto(new URL(info.screenUrl).pathname + new URL(info.screenUrl).search);
  await expect(tv.getByRole("heading", { name: "Qual é o principal segmento do seu negócio?" })).toBeVisible();
  await expect(tv.getByText(/Respostas recebidas/)).toBeVisible();

  // encerramento → pódio com prêmios no telão e no celular
  await page.getByRole("button", { name: "Encerrar" }).click();
  await page.getByRole("button", { name: /Encerrar e mostrar pódio/ }).click();
  await expect(tv.getByText("Vencedores")).toBeVisible();
  await expect(tv.getByText("Mentoria individual de 1 hora")).toBeVisible();
  await expect(p.getByText(/Treinamento encerrado/)).toBeVisible();

  await phone.close();
  await screen.close();
});

test("rotas administrativas exigem login", async ({ page }) => {
  await page.goto("/admin/eventos");
  await expect(page).toHaveURL(/\/login/);
});

test("telas principais funcionam em celular e tablet", async ({ browser }) => {
  for (const device of [devices["iPhone 13"], devices["iPad Mini"]]) {
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    await loginAdmin(page);
    await page.goto("/admin/eventos");
    await expect(page.getByText("Vendas Inteligentes com Marketing Digital")).toBeVisible();
    // sem rolagem horizontal
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  }
});
