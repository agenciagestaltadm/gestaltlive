# Arquitetura — Gestalt Live

## Visão geral

```
                    ┌──────────────────────────── processo Node (server/index.ts) ───────────────────────────┐
 Celulares ──HTTP──▶│  /api/*        Hono (server/app.ts) ──▶ serviços de domínio (server/domains/*)        │
 (participantes)    │  /socket.io    Socket.IO gateway (server/realtime/gateway.ts) ◀── publicador (realtime)│──▶ PostgreSQL
 Telão ──WS────────▶│  demais rotas  Next.js 16 (src/app) — interface, componentes cliente                  │    (PGlite em dev)
 Palestrante/Admin ▶│  agendador     fecha perguntas com cronômetro vencido (server/domains/live.ts)        │──▶ Redis (opcional,
                    └──────────────────────────────────────────────────────────────────────────────────────┘    multi-instância)
```

- **Um único processo** hospeda API, gateway de tempo real, agendador e interface. Isso evita duplicar estado entre o Next.js e o Socket.IO e funciona em qualquer host com conexões persistentes (VM, contêiner, Fly.io, Railway, Render, ECS). **Não é compatível com hospedagem serverless** (Vercel Functions, Lambda) — ver [ADR-001](adr/001-processo-unico.md).
- **Toda regra de negócio está no servidor** (`server/domains`). A interface só chama a API e exibe o estado. Pontuação, prazos, ranking e agregados nunca são calculados no cliente para fins oficiais.
- **Código compartilhado** (`shared/`): schemas Zod (validação nos dois lados), contratos de DTO/eventos, regras puras de pontuação/desempate/NPS/satisfação, motor de compatibilidade e gerador de opções dos gráficos.

## Módulos do servidor

| Módulo | Responsabilidade |
|---|---|
| `auth/auth.ts` | Login (scrypt), sessões em banco com token opaco (hash SHA-256), cookie `httpOnly`/`SameSite=Lax` |
| `auth/permissions.ts` | Matriz de permissões por papel e organização (`authorize`) |
| `domains/orgs.ts` | Organizações, membros, indicadores gerais |
| `domains/events.ts` | Eventos, campos de cadastro, prêmios, templates |
| `domains/questions.ts` | Construtor: CRUD, versões imutáveis, bloqueio estrutural, banco de questões, import/export |
| `domains/sessions.ts` | Sessões, código curto, QR, token do telão (HMAC), sincronização das perguntas |
| `domains/participants.ts` | Cadastro, unicidade, consentimentos, credencial de participação, recuperação de acesso |
| `domains/answers.ts` | Submissão idempotente e concorrente de respostas |
| `domains/scoring.ts` | Cálculo no fechamento e publicação no livro-razão (score_transactions) |
| `domains/leaderboard.ts` | Ranking, desempate, congelamento, snapshots, resultado final, pódio, desclassificação |
| `domains/satisfaction.ts` | Termômetro (voto atual + histórico), agregados e evolução |
| `domains/results.ts` | Agregação por pergunta (respondentes × seleções × inscritos), linha do tempo, cruzamentos |
| `domains/live.ts` | Máquina de estados da sessão/pergunta, cronômetro, telão, ranking, fechamento automático |
| `domains/views.ts` | Snapshots de estado para participante, telão e painel |
| `domains/reports.ts` / `crm.ts` | Relatórios, comparativos, exportações, CRM e LGPD |
| `realtime/realtime.ts` | Publicação por canal, agregação em janelas curtas, presença por pessoa |
| `realtime/gateway.ts` | Autenticação/autorização da inscrição nos canais |

## Máquinas de estado

- **Sessão:** `RASCUNHO`/`AGENDADA` → `AGUARDANDO` (sala de espera, cadastro aberto) → `AO_VIVO` ⇄ `PAUSADA` → `ENCERRADA` (ou `CANCELADA`). Respostas só em `AO_VIVO`; satisfação em `AGUARDANDO`/`AO_VIVO`/`PAUSADA`.
- **Pergunta (no evento):** `RASCUNHO` → `PRONTA` (apenas prontas entram nas sessões).
- **Pergunta (na sessão):** `PRONTA` → `ABERTA` → `FECHADA` → `RESULTADO_EXIBIDO`. Não há reabertura (preserva a integridade da pontuação).

## Tempo real

- Canais: `s:{sessão}:participants`, `s:{sessão}:screen`, `s:{sessão}:control`, `sp:{participante}`.
- O cliente **não publica eventos** (só `hb`). Toda ação vai pela API HTTP, que valida, persiste e então o servidor publica.
- Envelope `{ sessionId, v, at, data }`; `v` é monotônico por sessão.
- Atualizações frequentes são agregadas: resultados (300 ms no painel, 700 ms para o público), ranking (1 s), satisfação (500 ms), presença (1 s). Pontos individuais são enviados para a sala pessoal de cada participante conectado a partir de **um** cálculo de ranking.
- Reconexão: o cliente recarrega o snapshot (`GET /api/p/:code/state`, `/api/screen/:code/state`, `/api/admin/sessions/:id/control`) com um atraso aleatório para não sobrecarregar a API quando centenas de aparelhos reconectam juntos.
- Presença: participantes distintos com pelo menos um socket; Socket.IO faz heartbeat (ping 20 s / timeout 20 s) e o cliente envia `hb` a cada 20 s; `last_seen_at` é gravado em lote a cada 30 s.

## Integridade dos resultados

- **Uma resposta aceita por participante e pergunta:** índice único parcial `(session_question_id, session_participant_id) WHERE status='ACCEPTED'`.
- **Idempotência:** `unique(session_participant_id, idempotency_key)`; reenvio idêntico com outra chave também retorna a resposta vigente.
- **Concorrência com o fechamento:** resposta trava a pergunta com `FOR SHARE`, fechamento com `FOR UPDATE`.
- **Prazo:** tempo efetivo do cronômetro calculado com o relógio do servidor, descontando pausas.
- **Pontuação em duas fases** ([ADR-003](adr/003-pontuacao-duas-fases.md)): cálculo no fechamento; publicação no livro-razão na revelação/avanço/ranking/encerramento. `unique(answer_id, kind)` impede lançamentos duplicados; o agregado do participante é atualizado na mesma instrução SQL (CTE).
- **Resultado oficial imutável:** snapshot `FINAL`; revisões (desclassificação/reintegração) geram nova revisão com justificativa e auditoria, preservando a anterior.

## Modelo de dados

27 tabelas (ver `server/db/schema.ts` e `server/db/migrations/`). Ajustes em relação à sugestão original:
- `scoring_rules` → coluna `questions.scoring` (jsonb validado por Zod) e congelada em `question_versions.snapshot`.
- `auth_sessions`, `prize_awards`, `disqualifications`, `integration_outbox` adicionadas.
- Templates guardam o questionário no mesmo formato de importação/exportação (`gestalt-live/questionario` v1).
- Todas as tabelas de tenant possuem `org_id`; consultas sempre partem de uma entidade cuja organização é autorizada.

## Decisões registradas

- [ADR-001 — Processo único com API Hono + Socket.IO + Next.js](adr/001-processo-unico.md)
- [ADR-002 — PostgreSQL com PGlite no desenvolvimento](adr/002-postgres-pglite.md)
- [ADR-003 — Pontuação em duas fases](adr/003-pontuacao-duas-fases.md)
- [ADR-004 — Motor de compatibilidade de gráficos](adr/004-compatibilidade-graficos.md)
- [ADR-005 — Identidade do participante sem senha](adr/005-identidade-participante.md)
