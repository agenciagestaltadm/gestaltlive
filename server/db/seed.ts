/**
 * Dados iniciais: superadministrador, organização Gestalt e (opcionalmente) um treinamento de
 * demonstração com 10 perguntas, 3 prêmios e campos de perfil. Idempotente.
 */
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { organizationMembers, organizations, users } from "./schema";
import { hashPassword } from "../lib/crypto";
import { log } from "../lib/logger";
import { loadActor } from "../auth/auth";
import { createEvent, setCustomFields, setPrizes } from "../domains/events";
import { createQuestion } from "../domains/questions";
import { PRESET_CUSTOM_FIELDS, type QuestionInput } from "@shared/schemas";

export interface SeedOptions {
  superadminEmail?: string;
  superadminPassword?: string;
  demo?: boolean;
}

const BRAND = { primary: "#FF0068", secondary: "#0B1736" };

export const DEMO_QUESTIONS: Omit<QuestionInput, "tags" | "required" | "allowEdit">[] = [
  {
    type: "PERFIL",
    title: "Qual é o principal segmento do seu negócio?",
    description: null,
    imageUrl: null,
    category: "Perfil",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: null,
    scoring: null,
    chart: { type: "donut", colors: null, showPercent: true, showValues: true, showLegend: true, sortDesc: false, crossQuestionId: null },
    resultsMode: "AO_VIVO",
    explanation: null,
    options: ["Varejo", "Serviços", "Indústria", "Saúde", "Educação"].map((label) => ({ label, imageUrl: null, isCorrect: false, color: null })),
  },
  {
    type: "OPINIAO",
    title: "Qual seu maior desafio para vender?",
    description: "Escolha até 2 alternativas.",
    imageUrl: null,
    category: "Opinião",
    minSelections: 1,
    maxSelections: 2,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: null,
    scoring: null,
    chart: { type: "bar_horizontal", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: true, crossQuestionId: null },
    resultsMode: "AO_VIVO",
    explanation: null,
    options: ["Gerar leads", "Converter propostas", "Precificação", "Fidelizar clientes", "Equipe comercial"].map((label) => ({ label, imageUrl: null, isCorrect: false, color: null })),
  },
  {
    type: "SIM_NAO",
    title: "Você já usa WhatsApp Business no atendimento?",
    description: null,
    imageUrl: null,
    category: "Opinião",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: null,
    scoring: null,
    chart: { type: "semicircle", colors: ["#22C55E", "#EF4444"], showPercent: true, showValues: true, showLegend: true, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: null,
    options: [
      { label: "Sim", imageUrl: null, isCorrect: false, color: "#22C55E" },
      { label: "Não", imageUrl: null, isCorrect: false, color: "#EF4444" },
    ],
  },
  {
    type: "CONHECIMENTO",
    title: "Qual métrica indica o percentual de leads que se tornam clientes?",
    description: null,
    imageUrl: null,
    category: "Métricas",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: 30,
    scoring: { basePoints: 100, weight: 1, speedBonusEnabled: true, speedBonusMax: 50, wrongPenalty: 0 },
    chart: { type: "bar_vertical", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: "A taxa de conversão mede quantos leads viram clientes em um período.",
    options: [
      { label: "CAC", imageUrl: null, isCorrect: false, color: null },
      { label: "Taxa de conversão", imageUrl: null, isCorrect: true, color: null },
      { label: "Ticket médio", imageUrl: null, isCorrect: false, color: null },
      { label: "Churn", imageUrl: null, isCorrect: false, color: null },
    ],
  },
  {
    type: "CONHECIMENTO",
    title: "O que significa a sigla CAC?",
    description: null,
    imageUrl: null,
    category: "Métricas",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: 25,
    scoring: { basePoints: 100, weight: 1, speedBonusEnabled: true, speedBonusMax: 50, wrongPenalty: 0 },
    chart: { type: "pie", colors: null, showPercent: true, showValues: true, showLegend: true, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: "CAC é o Custo de Aquisição de Cliente: investimento em marketing e vendas dividido pelos novos clientes.",
    options: [
      { label: "Custo de Aquisição de Cliente", imageUrl: null, isCorrect: true, color: null },
      { label: "Cadastro de Atendimento ao Cliente", imageUrl: null, isCorrect: false, color: null },
      { label: "Ciclo de Ativação Comercial", imageUrl: null, isCorrect: false, color: null },
    ],
  },
  {
    type: "MULTIPLA_CORRETA",
    title: "Quais destes são canais de aquisição digital?",
    description: "Marque todas as corretas.",
    imageUrl: null,
    category: "Marketing",
    minSelections: 2,
    maxSelections: 4,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: 40,
    scoring: { basePoints: 150, weight: 1, speedBonusEnabled: false, speedBonusMax: 50, wrongPenalty: 0 },
    chart: { type: "lollipop", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: "Tráfego pago, SEO e e-mail marketing são canais digitais; panfletagem é offline.",
    options: [
      { label: "Tráfego pago", imageUrl: null, isCorrect: true, color: null },
      { label: "SEO", imageUrl: null, isCorrect: true, color: null },
      { label: "E-mail marketing", imageUrl: null, isCorrect: true, color: null },
      { label: "Panfletagem", imageUrl: null, isCorrect: false, color: null },
    ],
  },
  {
    type: "CONHECIMENTO",
    title: "Qual é o primeiro passo de um funil de vendas?",
    description: null,
    imageUrl: null,
    category: "Vendas",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: 20,
    scoring: { basePoints: 100, weight: 1, speedBonusEnabled: true, speedBonusMax: 50, wrongPenalty: 0 },
    chart: { type: "treemap", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: "Tudo começa pela atração: gerar atenção e visitantes qualificados.",
    options: [
      { label: "Fechamento", imageUrl: null, isCorrect: false, color: null },
      { label: "Atração", imageUrl: null, isCorrect: true, color: null },
      { label: "Negociação", imageUrl: null, isCorrect: false, color: null },
      { label: "Pós-venda", imageUrl: null, isCorrect: false, color: null },
    ],
  },
  {
    type: "ESCALA",
    title: "De 1 a 5, quanto você domina marketing digital hoje?",
    description: null,
    imageUrl: null,
    category: "Autoavaliação",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: 1,
    scaleMax: 5,
    scaleMinLabel: "Iniciante",
    scaleMaxLabel: "Especialista",
    timeLimitSec: null,
    scoring: null,
    chart: { type: "column", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: false, crossQuestionId: null },
    resultsMode: "AO_VIVO",
    explanation: null,
    options: [],
  },
  {
    type: "CONHECIMENTO",
    title: "Qual indicador mede a recorrência de clientes que deixam de comprar?",
    description: null,
    imageUrl: null,
    category: "Métricas",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    timeLimitSec: 30,
    scoring: { basePoints: 100, weight: 1.5, speedBonusEnabled: true, speedBonusMax: 50, wrongPenalty: 0 },
    chart: { type: "donut", colors: null, showPercent: true, showValues: true, showLegend: true, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: "Churn é a taxa de cancelamento/abandono de clientes.",
    options: [
      { label: "LTV", imageUrl: null, isCorrect: false, color: null },
      { label: "Churn", imageUrl: null, isCorrect: true, color: null },
      { label: "ROI", imageUrl: null, isCorrect: false, color: null },
      { label: "NPS", imageUrl: null, isCorrect: false, color: null },
    ],
  },
  {
    type: "NPS",
    title: "De 0 a 10, quanto você recomendaria este treinamento a um amigo?",
    description: null,
    imageUrl: null,
    category: "Avaliação",
    minSelections: 1,
    maxSelections: 1,
    scaleMin: 0,
    scaleMax: 10,
    scaleMinLabel: "Nada provável",
    scaleMaxLabel: "Muito provável",
    timeLimitSec: null,
    scoring: null,
    chart: { type: "gauge", colors: null, showPercent: true, showValues: true, showLegend: false, sortDesc: false, crossQuestionId: null },
    resultsMode: "MANUAL",
    explanation: null,
    options: [],
  },
];

export async function seedDatabase(ctx: AppContext, opts: SeedOptions) {
  const email = (opts.superadminEmail ?? "admin@gestalt.local").toLowerCase();
  const [existing] = await ctx.db.select().from(users).where(eq(users.email, email));
  if (existing) return { created: false, userId: existing.id };
  const password = opts.superadminPassword ?? "GestaltLive@2026";
  const [user] = await ctx.db
    .insert(users)
    .values({ email, name: "Administrador Gestalt", passwordHash: await hashPassword(password), isSuperadmin: true })
    .returning();
  let [org] = await ctx.db.select().from(organizations).where(eq(organizations.slug, "gestalt"));
  if (!org) {
    [org] = await ctx.db
      .insert(organizations)
      .values({ name: "Gestalt Marketing, Tecnologia e Educação", slug: "gestalt", brand: BRAND, logoUrl: "/brand/logo-branco.png" })
      .returning();
  }
  await ctx.db.insert(organizationMembers).values({ orgId: org.id, userId: user.id, role: "ORG_ADMIN" }).onConflictDoNothing();
  log.info("superadministrador criado", { email });

  if (opts.demo) {
    const actor = (await loadActor(ctx, user.id))!;
    await createDemoEvent(ctx, actor, org.id);
    log.info("evento de demonstração criado");
  }
  return { created: true, userId: user.id, orgId: org.id };
}

export async function createDemoEvent(ctx: AppContext, actor: NonNullable<Awaited<ReturnType<typeof loadActor>>>, orgId: string) {
  const ev = await createEvent(ctx, actor, orgId, {
    title: "Vendas Inteligentes com Marketing Digital",
    description: "Treinamento prático sobre funil, métricas e canais digitais.",
    speakerName: "Equipe Gestalt",
    location: "Auditório principal",
    welcomeMessage: "Bem-vindo! Responda, pontue e concorra aos prêmios do Top 3.",
    closingMessage: "Obrigado por participar! Continue aplicando o que aprendeu hoje.",
    theme: BRAND,
  });
  await setCustomFields(ctx, actor, ev.id, PRESET_CUSTOM_FIELDS);
  for (const q of DEMO_QUESTIONS) {
    await createQuestion(ctx, actor, ev.id, { ...q, tags: [], required: false, allowEdit: false });
  }
  await setPrizes(ctx, actor, ev.id, [
    { rank: 1, name: "Mentoria individual de 1 hora", description: "Sessão estratégica com a equipe Gestalt.", estimatedValueCents: 50000, pickupInfo: "Agendamento pelo WhatsApp após o evento." },
    { rank: 2, name: "Kit Gestalt + livro de marketing", description: "Kit exclusivo com materiais da Gestalt.", estimatedValueCents: 15000, pickupInfo: "Retirar no balcão ao final." },
    { rank: 3, name: "Curso online Gestalt", description: "Acesso por 6 meses à plataforma de cursos.", estimatedValueCents: 10000, pickupInfo: "Acesso enviado por e-mail." },
  ]);
  return ev;
}
