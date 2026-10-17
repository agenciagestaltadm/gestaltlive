/**
 * Schemas Zod compartilhados entre servidor (validação autoritativa) e interface (formulários).
 * Todas as mensagens de erro em português do Brasil.
 */
import { z } from "zod";
import { CHART_TYPES } from "./charts/catalog";

export const QUESTION_TYPES = ["PERFIL", "OPINIAO", "CONHECIMENTO", "MULTIPLA_CORRETA", "SIM_NAO", "ESCALA", "NPS"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  PERFIL: "Pesquisa de perfil",
  OPINIAO: "Pesquisa de opinião",
  CONHECIMENTO: "Conhecimento (uma correta)",
  MULTIPLA_CORRETA: "Múltiplas respostas corretas",
  SIM_NAO: "Enquete Sim/Não",
  ESCALA: "Escala de avaliação",
  NPS: "NPS (0 a 10)",
};

export const SCORED_TYPES: QuestionType[] = ["CONHECIMENTO", "MULTIPLA_CORRETA"];
export const NUMERIC_TYPES: QuestionType[] = ["ESCALA", "NPS"];
export const isScoredType = (t: QuestionType) => SCORED_TYPES.includes(t);
export const isNumericType = (t: QuestionType) => NUMERIC_TYPES.includes(t);

export const SESSION_STATUSES = ["RASCUNHO", "AGENDADA", "AGUARDANDO", "AO_VIVO", "PAUSADA", "ENCERRADA", "CANCELADA"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  RASCUNHO: "Rascunho",
  AGENDADA: "Agendada",
  AGUARDANDO: "Aguardando início",
  AO_VIVO: "Ao vivo",
  PAUSADA: "Pausada",
  ENCERRADA: "Encerrada",
  CANCELADA: "Cancelada",
};

export const SQ_STATES = ["PRONTA", "ABERTA", "FECHADA", "RESULTADO_EXIBIDO"] as const;
export type SessionQuestionState = (typeof SQ_STATES)[number];
export const SQ_STATE_LABELS: Record<SessionQuestionState, string> = {
  PRONTA: "Pronta",
  ABERTA: "Aberta",
  FECHADA: "Fechada",
  RESULTADO_EXIBIDO: "Resultado exibido",
};

export const RESULTS_MODES = ["AO_VIVO", "APOS_ENCERRAMENTO", "MANUAL"] as const;
export type ResultsMode = (typeof RESULTS_MODES)[number];
export const RESULTS_MODE_LABELS: Record<ResultsMode, string> = {
  AO_VIVO: "Gráfico ao vivo",
  APOS_ENCERRAMENTO: "Resultado após encerramento",
  MANUAL: "Resultado após comando do palestrante",
};

export const SCREENS = ["BOAS_VINDAS", "PERGUNTA", "RESULTADO", "RANKING", "SATISFACAO", "PREMIACAO", "ENCERRAMENTO"] as const;
export type PresentationScreen = (typeof SCREENS)[number];
export const SCREEN_LABELS: Record<PresentationScreen, string> = {
  BOAS_VINDAS: "Boas-vindas",
  PERGUNTA: "Pergunta",
  RESULTADO: "Resultado",
  RANKING: "Ranking",
  SATISFACAO: "Satisfação",
  PREMIACAO: "Premiação",
  ENCERRAMENTO: "Encerramento",
};

/* -------------------------------------------------------------- util */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB)");
const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || v.startsWith("/api/uploads/") || /^https:\/\//.test(v), "Use uma URL https ou faça upload")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const shortText = (max: number, msg = "Campo obrigatório") => z.string().trim().min(1, msg).max(max, `Máximo de ${max} caracteres`);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/* -------------------------------------------------------------- scoring */
export const scoringSchema = z.object({
  basePoints: z.number().int().min(0).max(10000).default(100),
  weight: z.number().min(0.1).max(10).default(1),
  speedBonusEnabled: z.boolean().default(false),
  speedBonusMax: z.number().int().min(0).max(10000).default(50),
  wrongPenalty: z.number().int().min(0).max(10000).default(0),
});
export type ScoringConfig = z.infer<typeof scoringSchema>;
export const DEFAULT_SCORING: ScoringConfig = {
  basePoints: 100,
  weight: 1,
  speedBonusEnabled: false,
  speedBonusMax: 50,
  wrongPenalty: 0,
};

/* -------------------------------------------------------------- gráfico */
export const chartConfigSchema = z.object({
  type: z.enum(CHART_TYPES),
  colors: z.array(hexColor).max(20).nullable().optional().transform((v) => v ?? null),
  showPercent: z.boolean().default(true),
  showValues: z.boolean().default(true),
  showLegend: z.boolean().default(true),
  sortDesc: z.boolean().default(false),
  /** Pergunta de perfil usada para cruzamento (barras agrupadas, Sankey, heatmap...). */
  crossQuestionId: z.uuid().nullable().optional().transform((v) => v ?? null),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

/* -------------------------------------------------------------- perguntas */
export const optionInputSchema = z.object({
  id: z.uuid().optional(),
  label: shortText(200, "Informe o texto da alternativa"),
  imageUrl: optionalUrl,
  isCorrect: z.boolean().default(false),
  color: hexColor.nullable().optional().transform((v) => v ?? null),
});
export type OptionInput = z.infer<typeof optionInputSchema>;

export const questionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    title: shortText(300, "Informe o enunciado"),
    description: optText(2000),
    imageUrl: optionalUrl,
    category: optText(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    required: z.boolean().default(false),
    minSelections: z.number().int().min(1).max(20).default(1),
    maxSelections: z.number().int().min(1).max(20).default(1),
    scaleMin: z.number().int().min(0).max(10).nullable().optional().transform((v) => v ?? null),
    scaleMax: z.number().int().min(1).max(10).nullable().optional().transform((v) => v ?? null),
    scaleMinLabel: optText(60),
    scaleMaxLabel: optText(60),
    timeLimitSec: z.number().int().min(5).max(3600).nullable().optional().transform((v) => v ?? null),
    allowEdit: z.boolean().default(false),
    scoring: scoringSchema.nullable().optional().transform((v) => v ?? null),
    chart: chartConfigSchema,
    resultsMode: z.enum(RESULTS_MODES).default("MANUAL"),
    explanation: optText(2000),
    options: z.array(optionInputSchema).max(20).default([]),
  })
  .superRefine((q, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
    const correct = q.options.filter((o) => o.isCorrect).length;
    switch (q.type) {
      case "PERFIL":
      case "OPINIAO":
        if (q.options.length < 2) issue("Cadastre pelo menos 2 alternativas", ["options"]);
        if (correct > 0) issue("Pesquisas não possuem resposta correta", ["options"]);
        if (q.scoring) issue("Pesquisas não possuem pontuação", ["scoring"]);
        break;
      case "SIM_NAO":
        if (q.options.length !== 2) issue("Enquete Sim/Não deve ter exatamente 2 alternativas", ["options"]);
        if (correct > 0) issue("Enquetes não possuem resposta correta", ["options"]);
        if (q.scoring) issue("Enquetes não possuem pontuação", ["scoring"]);
        if (q.maxSelections !== 1 || q.minSelections !== 1) issue("Enquete Sim/Não aceita uma única resposta", ["maxSelections"]);
        break;
      case "CONHECIMENTO":
        if (q.options.length < 2) issue("Cadastre pelo menos 2 alternativas", ["options"]);
        if (correct !== 1) issue("Marque exatamente uma alternativa correta", ["options"]);
        if (!q.scoring) issue("Configure a pontuação", ["scoring"]);
        if (q.maxSelections !== 1 || q.minSelections !== 1) issue("Questão de conhecimento aceita uma única resposta", ["maxSelections"]);
        break;
      case "MULTIPLA_CORRETA":
        if (q.options.length < 3) issue("Cadastre pelo menos 3 alternativas", ["options"]);
        if (correct < 2) issue("Marque pelo menos 2 alternativas corretas", ["options"]);
        if (!q.scoring) issue("Configure a pontuação", ["scoring"]);
        if (q.minSelections < 2) issue("Esta modalidade exige selecionar mais de uma alternativa (mínimo 2)", ["minSelections"]);
        break;
      case "ESCALA":
        if (q.scaleMin === null || q.scaleMax === null) issue("Informe os limites da escala", ["scaleMin"]);
        else if (q.scaleMin >= q.scaleMax) issue("O valor mínimo deve ser menor que o máximo", ["scaleMin"]);
        if (q.options.length > 0) issue("Escalas não usam alternativas", ["options"]);
        if (q.scoring) issue("Escalas não possuem pontuação", ["scoring"]);
        break;
      case "NPS":
        if (q.scaleMin !== 0 || q.scaleMax !== 10) issue("NPS usa escala de 0 a 10", ["scaleMin"]);
        if (q.options.length > 0) issue("NPS não usa alternativas", ["options"]);
        if (q.scoring) issue("NPS não possui pontuação", ["scoring"]);
        break;
    }
    if (q.options.length > 0) {
      if (q.minSelections > q.maxSelections) issue("O mínimo de seleções não pode ser maior que o máximo", ["minSelections"]);
      if (q.maxSelections > q.options.length) issue("O máximo de seleções excede o número de alternativas", ["maxSelections"]);
      const labels = new Set(q.options.map((o) => o.label.toLowerCase()));
      if (labels.size !== q.options.length) issue("Há alternativas repetidas", ["options"]);
    }
    if (q.scoring?.speedBonusEnabled && !q.timeLimitSec) {
      issue("O bônus por velocidade exige um tempo limite", ["timeLimitSec"]);
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/** Campos considerados estruturais: não podem mudar depois que a pergunta recebeu respostas. */
export const STRUCTURAL_QUESTION_FIELDS = [
  "type",
  "options",
  "minSelections",
  "maxSelections",
  "scaleMin",
  "scaleMax",
  "scoring",
] as const;

/* -------------------------------------------------------------- cadastro do participante */
export const UNIQUENESS_POLICIES = ["EMAIL", "PHONE", "EMAIL_OR_PHONE", "NONE"] as const;
export const UNIQUENESS_LABELS: Record<(typeof UNIQUENESS_POLICIES)[number], string> = {
  EMAIL: "Um cadastro por e-mail",
  PHONE: "Um cadastro por WhatsApp",
  EMAIL_OR_PHONE: "Um cadastro por e-mail e por WhatsApp",
  NONE: "Sem restrição (apenas por aparelho)",
};
export const RANKING_DISPLAYS = ["APELIDO", "PRIMEIRO_NOME", "NOME_INICIAL"] as const;
export const RANKING_DISPLAY_LABELS: Record<(typeof RANKING_DISPLAYS)[number], string> = {
  APELIDO: "Apelido escolhido pelo participante",
  PRIMEIRO_NOME: "Primeiro nome",
  NOME_INICIAL: "Primeiro nome + inicial do sobrenome",
};

const fieldRule = z.object({ enabled: z.boolean(), required: z.boolean() });

export const registrationConfigSchema = z
  .object({
    phone: fieldRule.default({ enabled: true, required: true }),
    email: fieldRule.default({ enabled: true, required: true }),
    uniqueness: z.enum(UNIQUENESS_POLICIES).default("EMAIL_OR_PHONE"),
    rankingDisplay: z.enum(RANKING_DISPLAYS).default("APELIDO"),
    consentVersion: z.string().trim().min(1).max(40).default("1.0"),
    consentParticipationText: shortText(4000).default(
      "Autorizo o tratamento dos meus dados pela organizadora para participação neste treinamento (identificação, respostas, pontuação e premiação), conforme a Política de Privacidade.",
    ),
    marketingEnabled: z.boolean().default(true),
    consentMarketingText: shortText(4000).default(
      "Aceito receber conteúdos educativos e comunicações comerciais da organizadora. Posso revogar quando quiser.",
    ),
    privacyPolicyUrl: optionalUrl,
  })
  .superRefine((r, ctx) => {
    if ((r.uniqueness === "EMAIL" || r.uniqueness === "EMAIL_OR_PHONE") && !(r.email.enabled && r.email.required)) {
      if (r.uniqueness === "EMAIL") ctx.addIssue({ code: "custom", message: "A unicidade por e-mail exige o e-mail obrigatório", path: ["uniqueness"] });
    }
    if (r.uniqueness === "PHONE" && !(r.phone.enabled && r.phone.required)) {
      ctx.addIssue({ code: "custom", message: "A unicidade por WhatsApp exige o WhatsApp obrigatório", path: ["uniqueness"] });
    }
    if (r.email.required && !r.email.enabled) ctx.addIssue({ code: "custom", message: "Campo obrigatório precisa estar habilitado", path: ["email"] });
    if (r.phone.required && !r.phone.enabled) ctx.addIssue({ code: "custom", message: "Campo obrigatório precisa estar habilitado", path: ["phone"] });
  });
export type RegistrationConfig = z.infer<typeof registrationConfigSchema>;

export const eventSettingsSchema = z.object({
  defaultResultsMode: z.enum(RESULTS_MODES).default("MANUAL"),
  showLeaderboardToParticipants: z.boolean().default(true),
  showPrizesToParticipants: z.boolean().default(true),
  autoCloseOnTimer: z.boolean().default(true),
  soundEffects: z.boolean().default(false),
  maxParticipants: z.number().int().min(1).max(100000).default(2000),
});
export type EventSettings = z.infer<typeof eventSettingsSchema>;

export const CUSTOM_FIELD_TYPES = ["TEXTO", "TEXTO_LONGO", "SELECAO", "NUMERO", "EMAIL", "TELEFONE"] as const;
export const customFieldInputSchema = z
  .object({
    id: z.uuid().optional(),
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_]+$/, "Use letras minúsculas, números e _"),
    label: shortText(120),
    type: z.enum(CUSTOM_FIELD_TYPES).default("TEXTO"),
    options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    required: z.boolean().default(false),
  })
  .superRefine((f, ctx) => {
    if (f.type === "SELECAO" && f.options.length < 2) ctx.addIssue({ code: "custom", message: "Informe pelo menos 2 opções", path: ["options"] });
  });
export type CustomFieldInput = z.infer<typeof customFieldInputSchema>;

/** Campos de perfil sugeridos (empresa, profissão, cidade, segmento). */
export const PRESET_CUSTOM_FIELDS: CustomFieldInput[] = [
  { key: "empresa", label: "Empresa", type: "TEXTO", options: [], required: false },
  { key: "profissao", label: "Profissão", type: "TEXTO", options: [], required: false },
  { key: "cidade", label: "Cidade", type: "TEXTO", options: [], required: false },
  {
    key: "segmento",
    label: "Segmento",
    type: "SELECAO",
    options: ["Varejo", "Serviços", "Indústria", "Saúde", "Educação", "Alimentação", "Tecnologia", "Outro"],
    required: false,
  },
];

/* -------------------------------------------------------------- eventos */
export const eventInputSchema = z.object({
  title: shortText(160, "Informe o título"),
  description: optText(4000),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
  location: optText(200),
  speakerUserId: z.uuid().nullable().optional().transform((v) => v ?? null),
  speakerName: optText(120),
  logoUrl: optionalUrl,
  welcomeMessage: optText(1000),
  closingMessage: optText(1000),
  theme: z.object({ primary: hexColor.optional(), secondary: hexColor.optional() }).default({}),
  registration: registrationConfigSchema.default(registrationConfigSchema.parse({})),
  settings: eventSettingsSchema.default(eventSettingsSchema.parse({})),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const prizeInputSchema = z.object({
  rank: z.number().int().min(1).max(3),
  name: shortText(120, "Informe o nome do prêmio"),
  description: optText(1000),
  imageUrl: optionalUrl,
  estimatedValueCents: z.number().int().min(0).max(100_000_000).nullable().optional().transform((v) => v ?? null),
  eligibility: optText(1000),
  pickupInfo: optText(1000),
});
export type PrizeInput = z.infer<typeof prizeInputSchema>;

export const sessionInputSchema = z.object({
  name: shortText(160, "Informe o nome da turma/sessão"),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
});

/* -------------------------------------------------------------- importação/exportação */
export const QUESTIONNAIRE_FORMAT = "gestalt-live/questionario";
export const questionnaireExportSchema = z.object({
  format: z.literal(QUESTIONNAIRE_FORMAT),
  version: z.literal(1),
  name: shortText(160),
  description: optText(2000),
  questions: z.array(questionInputSchema).max(200),
  registration: registrationConfigSchema.optional(),
  settings: eventSettingsSchema.optional(),
  customFields: z.array(customFieldInputSchema).max(30).optional(),
});
export type QuestionnaireExport = z.infer<typeof questionnaireExportSchema>;

/* -------------------------------------------------------------- participante */
export const joinInputSchema = z.object({
  fullName: shortText(120, "Informe seu nome completo").refine((v) => v.length >= 3, "Informe seu nome completo"),
  displayName: optText(30),
  email: z.string().trim().max(254).optional().nullable().transform((v) => (v ? v : null)),
  phone: z.string().trim().max(30).optional().nullable().transform((v) => (v ? v : null)),
  custom: z.record(z.string(), z.string().trim().max(500)).default({}),
  consentParticipation: z.literal(true, { error: "É necessário aceitar os termos de participação" }),
  consentMarketing: z.boolean().default(false),
});
export type JoinInput = z.infer<typeof joinInputSchema>;

export const answerInputSchema = z.object({
  sessionQuestionId: z.uuid(),
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  optionIds: z.array(z.uuid()).max(20).default([]),
  value: z.number().int().min(0).max(10).nullable().optional().transform((v) => v ?? null),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const satisfactionInputSchema = z.object({ value: z.enum(["POSITIVO", "NEGATIVO"]) });

/* -------------------------------------------------------------- admin */
export const loginSchema = z.object({
  email: z.email("E-mail inválido").max(254),
  password: z.string().min(1, "Informe a senha").max(200),
});
export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter pelo menos 10 caracteres")
  .max(200)
  .regex(/[A-Za-z]/, "Inclua letras")
  .regex(/[0-9]/, "Inclua números");
export const userCreateSchema = z.object({
  name: shortText(120),
  email: z.email("E-mail inválido").max(254),
  password: passwordSchema,
  role: z.enum(["ORG_ADMIN", "SPEAKER"]),
});
export const orgCreateSchema = z.object({
  name: shortText(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use letras minúsculas, números e hífen"),
  brand: z.object({ primary: hexColor.optional(), secondary: hexColor.optional() }).default({}),
  logoUrl: optionalUrl,
  retentionDays: z.number().int().min(30).max(3650).nullable().optional().transform((v) => v ?? null),
});
export const disqualifySchema = z.object({
  sessionParticipantId: z.uuid(),
  reason: z.string().trim().min(10, "Descreva a justificativa (mínimo 10 caracteres)").max(1000),
});
export const scoreAdjustmentSchema = z.object({
  sessionParticipantId: z.uuid(),
  points: z.number().int().min(-10000).max(10000).refine((v) => v !== 0, "Informe um valor diferente de zero"),
  reason: z.string().trim().min(10, "Descreva a justificativa (mínimo 10 caracteres)").max(1000),
});
