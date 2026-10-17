# ADR-001 — Processo único: API Hono + Socket.IO + Next.js

**Status:** aceito

## Contexto
O produto depende de WebSockets persistentes (centenas de celulares conectados durante horas) e de estado efêmero compartilhado (presença, agregação de eventos, agendador do cronômetro). Rotas do Next.js em ambiente serverless não mantêm conexões, e um servidor customizado do Next com Route Handlers gera dois grafos de módulos (o do Next e o do servidor), o que duplica singletons.

## Decisão
Um processo Node (`server/index.ts`) com:
- **Hono** atendendo `/api/*` — toda a lógica de negócio, testável com `app.request()` sem subir o Next;
- **Socket.IO** em `/socket.io`;
- **Next.js** (App Router) como camada de interface, atendendo as demais rotas;
- **agendador** interno para fechamento automático por cronômetro (idempotente, reidratado do banco).

## Consequências
- Implantação em VM/contêiner (Docker Compose fornecido). Não suporta hospedagem serverless.
- Escala horizontal: possível com o adapter Redis do Socket.IO (`REDIS_URL`) e *sticky sessions* no balanceador (necessário para o transporte polling). A presença é contada por instância — em várias instâncias o número de "conectados" é a soma por instância (limitação documentada).
- O agendador roda em todas as instâncias; o fechamento é idempotente (`FOR UPDATE` + verificação de estado).
