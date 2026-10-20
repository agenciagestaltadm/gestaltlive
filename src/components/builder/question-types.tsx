"use client";
/** Apresentação dos tipos de pergunta: ícone, descrição e seletor em cartões. */
import { Brain, Cloud, Gauge, ListChecks, MessageSquareText, SlidersHorizontal, ThumbsUp, UserRound } from "lucide-react";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, isScoredType, type QuestionType } from "@shared/schemas";
import { Badge, Dialog } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const TYPE_ICONS: Record<QuestionType, React.ComponentType<{ className?: string }>> = {
  PERFIL: UserRound,
  OPINIAO: MessageSquareText,
  CONHECIMENTO: Brain,
  MULTIPLA_CORRETA: ListChecks,
  SIM_NAO: ThumbsUp,
  ESCALA: SlidersHorizontal,
  NPS: Gauge,
  NUVEM_PALAVRAS: Cloud,
};

export const TYPE_DESCRIPTIONS: Record<QuestionType, { text: string; example: string }> = {
  PERFIL: {
    text: "Conheça o público (cargo, segmento, região). Sem resposta correta e sem pontos. Pode servir de cruzamento para outros gráficos.",
    example: "Ex.: Qual é o seu segmento de atuação?",
  },
  OPINIAO: {
    text: "Colete percepções e preferências. Sem resposta correta e sem pontos; aceita resposta única ou múltipla.",
    example: "Ex.: Qual tema você quer aprofundar?",
  },
  CONHECIMENTO: {
    text: "Quiz com exatamente uma alternativa correta. Vale pontos e pode ter bônus por velocidade.",
    example: "Ex.: Qual é a capital da Austrália?",
  },
  MULTIPLA_CORRETA: {
    text: "O participante precisa marcar todas as alternativas corretas (duas ou mais). Vale pontos.",
    example: "Ex.: Quais destes são canais digitais?",
  },
  SIM_NAO: {
    text: "Enquete rápida com duas opções fixas: Sim e Não. Sem pontos.",
    example: "Ex.: Você já usou essa ferramenta?",
  },
  ESCALA: {
    text: "Avaliação numérica entre limites definidos (ex.: 1 a 5), com rótulos nos extremos.",
    example: "Ex.: De 1 a 5, quanto você domina o tema?",
  },
  NPS: {
    text: "Nota de 0 a 10 com classificação em promotores, neutros e detratores.",
    example: "Ex.: Quanto você recomendaria este treinamento?",
  },
  NUVEM_PALAVRAS: {
    text: "Permita que os participantes enviem palavras ou frases curtas pelo celular e acompanhe uma nuvem de palavras sendo construída em tempo real.",
    example: "Ex.: Qual palavra representa seu maior desafio nas vendas?",
  },
};

export function TypeBadge({ type, className }: { type: QuestionType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return (
    <Badge tone={isScoredType(type) ? "brand" : "muted"} className={cn("whitespace-nowrap", className)}>
      <Icon className="size-3.5" />
      {QUESTION_TYPE_LABELS[type]}
    </Badge>
  );
}

export function TypePicker({ value, onPick, disabled }: { value?: QuestionType; onPick: (t: QuestionType) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de pergunta">
      {QUESTION_TYPES.map((t) => {
        const Icon = TYPE_ICONS[t];
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onPick(t)}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60",
              active ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-border bg-card hover:border-brand/50 hover:bg-muted/50",
            )}
          >
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", active ? "bg-brand text-white" : "bg-muted text-foreground")}>
              <Icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-black">{QUESTION_TYPE_LABELS[t]}</span>
                {isScoredType(t) && <Badge tone="brand">Pontua</Badge>}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{TYPE_DESCRIPTIONS[t].text}</span>
              <span className="mt-1 block text-xs italic text-muted-foreground/80">{TYPE_DESCRIPTIONS[t].example}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TypePickerDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (t: QuestionType) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nova pergunta" description="Escolha o tipo. Você poderá ajustá-lo no editor enquanto a pergunta não tiver respostas." className="max-w-3xl">
      <TypePicker
        onPick={(t) => {
          onOpenChange(false);
          onPick(t);
        }}
      />
    </Dialog>
  );
}
