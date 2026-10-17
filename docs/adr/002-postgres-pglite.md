# ADR-002 — PostgreSQL em produção, PGlite no desenvolvimento e nos testes

**Status:** aceito

## Contexto
A máquina de desenvolvimento não possui Docker nem PostgreSQL. Queremos o mesmo SQL, as mesmas migrações e as mesmas garantias (índices únicos parciais, `FOR UPDATE/SHARE`, CTEs com `INSERT … ON CONFLICT … RETURNING`) em todos os ambientes.

## Decisão
- **Drizzle ORM** com migrações SQL versionadas (`server/db/migrations`, geradas por `drizzle-kit`).
- `DATABASE_URL` seleciona o driver: `pglite:memory` (testes), `pglite:./.data/db` (desenvolvimento, PostgreSQL real compilado para WASM) ou `postgres://…` (produção via `pg`, pool configurável por `DB_POOL_MAX`).
- As migrações são aplicadas automaticamente na inicialização.

## Consequências
- Zero dependências externas para desenvolver e testar.
- PGlite executa uma consulta por vez (sem paralelismo real); por isso os números do teste de carga com PGlite são **conservadores**. A produção deve usar PostgreSQL 15+.
- Redis é opcional e usado apenas para o adapter do Socket.IO em múltiplas instâncias.
