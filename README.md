# GESTALT LIVE

Plataforma de interação ao vivo para palestras, cursos e treinamentos da **Gestalt Marketing, Tecnologia e Educação**: o público entra por QR Code, responde pesquisas e quizzes pontuados em tempo real, acompanha um ranking gamificado, avalia a experiência a qualquer momento ("Termômetro do Treinamento") e o Top 3 recebe prêmios em um pódio animado no telão. Todos os dados ficam guardados para relatórios, comparativos entre turmas e CRM, respeitando a LGPD.

- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · componentes padrão shadcn/ui (Radix) · Lucide · React Hook Form + Zod · ECharts 6 · Hono · Socket.IO · Drizzle ORM · PostgreSQL (PGlite no desenvolvimento) · Redis opcional · Vitest · Playwright.
- **Arquitetura:** um processo Node com API, gateway de tempo real, agendador e interface — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [ADRs](docs/adr/).

## Início rápido (sem Docker)

Requisitos: Node 20.11+ (testado com Node 24).

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`. O banco PostgreSQL embutido (PGlite) é criado em `.data/db`, as migrações e o seed rodam sozinhos:

- **Administrador:** `admin@gestalt.local` / `GestaltLive@2026` (definidos em `.env`; troque a senha em *Configurações → Minha conta*).
- **Evento de demonstração:** "Vendas Inteligentes com Marketing Digital" — 10 perguntas de 7 tipos, gráficos variados, 3 prêmios e campos de perfil.

Para participar pelo celular na mesma rede, acesse o painel pelo IP do computador (ex.: `http://192.168.0.10:3000`): o QR Code passa a apontar para esse endereço.

### Roteiro de uso
1. **Admin → Eventos →** evento demo → **Sessões → Nova sessão**.
2. **Abrir controle** → *Abrir inscrições* → *Abrir telão* (outra janela/projetor) → *Iniciar sessão*.
3. Público lê o QR Code → cadastro → aguarda.
4. No painel: **Liberar pergunta** (ou tecla `N`), acompanhe o gráfico ao vivo, **Fechar**, **Exibir resultado** (`R`), **Revelar resposta correta** (`C`), telas do telão (`1`–`7`), congelar/ocultar ranking.
5. **Encerrar** → resultado oficial congelado e pódio com prêmios no telão.
6. **Relatórios** → indicadores, gráficos, PDF/CSV/XLSX, comparativo entre turmas; **Participantes** → CRM.

## Produção

```bash
docker compose up -d --build     # app + PostgreSQL 17 + Redis 7
```
Detalhes, variáveis, proxy e checklist em [docs/DEPLOY.md](docs/DEPLOY.md).

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Desenvolvimento (API + tempo real + Next com recarga) |
| `npm run build` / `npm start` | Build de produção (`next build` + `dist/server.mjs`) e execução |
| `npm test` | Testes unitários e de integração (Vitest, PGlite em memória) |
| `npm run test:e2e` | E2E com Playwright (requer `npm run build` e `npx playwright install chromium`) |
| `npm run load -- --participantes 300 --perguntas 3 [--espalhar 8000]` | Teste de carga |
| `npm run typecheck` · `npm run lint` | TypeScript e ESLint |
| `npm run db:generate` · `npm run db:migrate` · `npm run db:seed` | Migrações (drizzle-kit) e seed |

## Funcionalidades implementadas

**Perfis e segurança** — Superadmin, Administrador da organização, Palestrante e Participante; autorização no backend por organização/papel; multi-tenant (`org_id` em todas as entidades); senha scrypt; sessão em banco com cookie `httpOnly`; verificação de `Origin` (CSRF); rate limiting; validação Zod no servidor; uploads validados por assinatura; auditoria.

**Eventos** — templates de treinamento (salvar/importar/exportar), eventos (duplicar, arquivar), sessões independentes (código curto sem caracteres ambíguos, QR Code, link público, token próprio do telão), estados RASCUNHO → AGENDADA → AGUARDANDO → AO_VIVO ⇄ PAUSADA → ENCERRADA/CANCELADA.

**Cadastro do participante** — sem senha; campos padrão configuráveis (obrigatório/opcional), campos personalizados e presets (empresa, profissão, cidade, segmento); política de unicidade por sessão (e-mail, WhatsApp, ambos, nenhum) com normalização; apelido/nome no ranking; consentimentos separados (participação obrigatória, marketing opcional) com versão e data; credencial persistida no aparelho; recuperação por código emitido pela equipe.

**Construtor de perguntas** — 7 tipos (perfil, opinião, conhecimento, múltiplas corretas, sim/não, escala, NPS), imagem, alternativas com imagem e cor, categoria, tags, tempo limite, edição antes do encerramento, modo de exibição de resultados, explicação; arrastar e soltar; duplicar; banco de questões; importação/exportação JSON; versionamento com bloqueio estrutural de perguntas já respondidas.

**Gráficos** — 30 visualizações ECharts em galeria com prévia; motor de compatibilidade que só oferece gráficos estatisticamente corretos (parte-do-todo apenas em escolha única, temporais com horário real, cruzamentos reais por pergunta de perfil, hierarquias reais); cores, %, valores, legenda, ordenação; totais de inscritos × respondentes × seleções; "Aguardando respostas"; tela cheia; exportação PNG/SVG/PDF; tema claro/escuro; transições animadas; respeita movimento reduzido.

**Ao vivo** — painel do palestrante com KPIs, sequência de perguntas, cronômetro autoritativo no servidor (iniciar, pausar, +15 s, encerrar), fechar, exibir/ocultar resultado, revelar correta, próxima, voltar visualização, controle das 7 telas do telão, congelar/ocultar ranking, janelas destacadas de ranking e satisfação, atalhos de teclado, atividade, recuperação de acesso; fechamento automático por tempo.

**Gamificação** — pontos base, peso, bônus por velocidade opcional (`floor(bônus × max(0, 1 − t/limite))`), penalidade opcional, cálculo exclusivo no servidor com relógio do servidor; publicação em livro-razão idempotente (não antecipa o gabarito); ranking com desempate determinístico (pontos → acertos → menor tempo em acertos → inscrição → id); Top 10, posição individual, distância para a próxima posição, movimentação; resultado final imutável com revisões auditadas (desclassificação/reintegração com justificativa).

**Prêmios** — 1º/2º/3º com imagem, valor, regras e retirada; card "Prêmios de hoje"; pódio animado com confete; registro de premiação e confirmação de entrega.

**Termômetro do Treinamento** — botões permanentes "Insatisfeito"/"Valeu a pena" em todas as abas; um voto atual por pessoa com histórico; pizza e indicadores só sobre votos registrados; evolução temporal; comparativo entre sessões.

**Telão** — `/apresentacao/[codigo]?t=…`: boas-vindas com QR, pergunta (cronômetro e progresso), resultado, ranking, satisfação, premiação e encerramento; tipografia proporcional à tela; QR permanente no canto; tela cheia (`F`).

**Participante** — app web mobile-first (Ao vivo, Ranking, Prêmios, Meu perfil), safe areas, teclado virtual, estados de carregamento/desconexão/reconexão/erro, feedback de acerto/erro e pontos, sons opcionais (só após ativação), histórico individual, gestão de consentimento.

**Relatórios e CRM** — relatório visual por sessão (participação, distribuição, acerto, dificuldade, distribuição de pontuações, Top 10, classificação, satisfação, perfil) com segmentação por campo ou resposta; PDF, CSV e XLSX; visão geral com filtros (evento, período, palestrante); comparativo entre turmas; lista de participantes com busca, filtros e segmentação por resposta; perfil individual; revogação de marketing; anonimização; exportação autorizada.

## Critérios de aceitação → verificação

| # | Cenário | Como foi verificado |
|---|---|---|
| 1 | Treinamento com 10 perguntas | `builder.test.ts` (10 tipos/gráficos), seed demo |
| 2 | Gráficos diferentes com prévia | galeria no construtor (verificação visual) + `charts-compat.test.ts` |
| 3 | Três prêmios | `live-flow.test.ts` |
| 4 | Sessão com link e QR Code | `live-flow.test.ts` |
| 5 | 30 participantes | `live-flow.test.ts` |
| 6 | Pergunta chega a todos automaticamente | `realtime.test.ts` (15 sockets), E2E, carga (300) |
| 7 | Gráfico atualiza sem recarregar | `realtime.test.ts`, E2E |
| 8 | Pontuação calculada no servidor | `live-flow.test.ts` (bônus exato), `scoring.test.ts` |
| 9 | Top 10 e posição individual | `live-flow.test.ts` |
| 10 | Troca de satisfação conta só o voto atual | `live-flow.test.ts`, E2E |
| 11 | Reenvios não duplicam pontos | `live-flow.test.ts` (mesma chave, nova chave, 10 simultâneos), carga |
| 12 | Desconectar e recuperar o estado | `realtime.test.ts`, E2E (reload) |
| 13 | Sessões simultâneas isoladas | `realtime.test.ts` |
| 14 | Pódio final com prêmios | `live-flow.test.ts`, E2E |
| 15 | Visualizar e exportar resultados | `live-flow.test.ts` (relatório, CSV, XLSX) |
| 16 | Computador, tablet e celular | E2E (desktop, Pixel 7, iPhone 13, iPad Mini) + verificação visual |
| 17 | Acesso não autorizado negado | `realtime.test.ts` (API, socket, telão, outra org, palestrante, CSRF) |
| 18 | Carga de 300 participantes | [docs/LOAD_TEST.md](docs/LOAD_TEST.md) |

Situação atual: **65 testes unitários/integração e 3 E2E passando**, `tsc` sem erros, ESLint com 0 erros.

## Documentação
- [Arquitetura](docs/ARCHITECTURE.md) e [decisões (ADRs)](docs/adr/)
- [Implantação](docs/DEPLOY.md)
- [Teste de carga](docs/LOAD_TEST.md)
- [Privacidade e LGPD](docs/LGPD.md)
- [Guia de interface](docs/UI_GUIDE.md)
- [Limitações e pendências](docs/PENDENCIAS.md)

## Estrutura

```
server/      API (Hono), domínios, autenticação, tempo real, banco (schema + migrações + seed)
shared/      schemas Zod, contratos, regras de pontuação, gráficos (catálogo, compatibilidade, opções)
src/app/     rotas Next.js (público, participante, telão, admin)
src/components/  design system, gráficos, telas ao vivo, construtor, relatórios
tests/       unit · integration · e2e · load
docs/        arquitetura, ADRs, deploy, carga, LGPD, pendências
public/brand logos oficiais Gestalt
```
