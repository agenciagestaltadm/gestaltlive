# Guia de interface — Gestalt Live

Convenções obrigatórias para todas as telas. Interface **100% em português do Brasil**.

## Stack de UI
- Next.js 16 (App Router) — páginas de UI são **componentes cliente** (`"use client"`) que consomem a API HTTP (`/api/...`). O Next não acessa o banco.
- Tailwind CSS v4 com tokens definidos em `src/app/globals.css` (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-brand`, `text-brand`, `bg-navy-900`, `text-gold`, `text-positive`, `text-negative`…). Tema escuro via classe `.dark` no `<html>` (admin alterna; participante e telão usam sempre escuro).
- Componentes do design system (padrão shadcn/ui), **sempre reutilize**:
  - `@/components/ui/button` → `Button` (variants: default | secondary | outline | ghost | positive | negative | link; sizes: sm | default | lg | xl | icon | icon-sm; prop `loading`).
  - `@/components/ui/primitives` → `Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Textarea, NativeSelect, Label, Field (label/hint/error/required), Switch, Badge (tone), Spinner, Skeleton, Separator, EmptyState, Stat, Progress, Tabs/TabsList/TabsTrigger/TabsContent, Dialog, Tip, Menu/MenuTrigger/MenuContent/MenuItem`.
  - `@/components/ui/toast` → `toast.success/error/info`.
  - Ícones: `lucide-react`.
  - Marca: `@/components/brand` → `GestaltLogo`, `ProductMark`, `EventLogo`.
- Formulários: React Hook Form + Zod, reaproveitando os schemas de `@shared/schemas` sempre que possível. Erros de validação do servidor chegam em `ApiError.details` (`[{ path, message }]`) — use `fieldErrors()` de `@/lib/hooks`.

## Dados e ações
- `@/lib/api` → `admin.get/post/put/patch/del/upload/download` (prefixo `/api/admin`, cookie de sessão). Erros lançam `ApiError` (`status`, `code`, `message`, `details`).
- `@/lib/hooks` → `useApi(fetcher, deps)` (`data, error, loading, reload, setData`) e `useAction()` (`pending, run(key, fn, mensagemDeSucesso)`) que já exibe toast de erro.
- Contexto admin: `useAdmin()` de `@/components/admin/admin-context` → `{ me, org, orgId, orgs, can(perm), role }`. **Toda listagem/criação de nível organização usa `?orgId=${orgId}`**. Esconda ações sem permissão com `can(...)` (o backend também bloqueia).
- Layout de página admin: `PageHeader` de `@/components/admin/admin-shell` (`title`, `description`, `actions`, `back`).
- Contratos: tipos em `@shared/types`, schemas em `@shared/schemas`, rotas em `server/app.ts`, regras em `server/domains/*.ts`. Leia o serviço antes de consumir uma rota.
- Gráficos: `ChartView` de `@/components/charts/chart-view` (props `data: ResultsDTO`, `type: ChartType`, `config`, `theme`, `large`, `height`, `preview`, `exportName`); catálogo em `@shared/charts/catalog`, compatibilidade em `@shared/charts/compat`, prévia com dados ilustrativos em `previewResults()` de `@shared/charts/options`. Satisfação: `SatisfactionPie`, `SatisfactionTimeline`, `SatisfactionStats` de `@/components/charts/satisfaction-charts`.

## Visual
- Estilo SaaS premium: cartões `rounded-2xl`, espaçamento consistente (`gap-4/6`, `p-5`), títulos `font-black`, números com `tabular`.
- Fúcsia (`brand`) para ações principais; azul-marinho para superfícies escuras; verde/vermelho somente para satisfação e acerto/erro; dourado/prata/bronze para 1º/2º/3º.
- Responsivo: desktop-first no admin, mas tudo deve funcionar em 375px (tabelas com `overflow-x-auto`, grids que quebram).
- Estados obrigatórios: carregando (`Skeleton`/`Spinner`), vazio (`EmptyState`), erro (mensagem + tentar novamente).
- Acessibilidade: rótulos em todos os campos, `aria-label` em botões só com ícone, contraste AA, foco visível, sem depender só de cor.
- Datas: `fmtDateTime`, `fmtDate`; números: `fmtInt`, `fmtPct`, `fmtMoney` de `@/lib/utils`.

## Rotas
| Área | Rota |
|---|---|
| Público | `/`, `/entrar/[codigo]`, `/evento/[codigo]` |
| Participante | `/s/[codigo]/ao-vivo`, `/ranking`, `/premios`, `/perfil` |
| Telão | `/apresentacao/[codigo]?t=TOKEN` |
| Admin | `/admin`, `/admin/eventos`, `/admin/eventos/novo`, `/admin/eventos/[id]` (+ `/perguntas`, `/premios`, `/sessoes`, `/cadastro`), `/admin/sessoes`, `/admin/sessoes/[id]/controle`, `/admin/sessoes/[id]/resultados`, `/admin/participantes`, `/admin/participantes/[id]`, `/admin/relatorios`, `/admin/banco`, `/admin/templates`, `/admin/configuracoes`, `/admin/organizacoes` |
