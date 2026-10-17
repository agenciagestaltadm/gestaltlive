# Teste de carga — 300 participantes simultâneos (cenário 18)

Script: `tests/load/load-test.ts` (`npm run load -- --participantes 300 --perguntas 3 [--espalhar 8000]`).
Ele sobe um servidor real (API + Socket.IO) numa porta aleatória e simula:
1. **300 cadastros concorrentes** via HTTP (50 simultâneos);
2. **300 conexões WebSocket** autenticadas;
3. **3 perguntas pontuadas**. Para cada uma, o roteiro é:
   1. Libera a pergunta e mede a entrega a todos os 300 sockets.
   2. Os 300 respondem; 10% reenviam a mesma resposta para testar a idempotência.
   3. Encerra a pergunta.
   4. Revela a resposta e mede a entrega dos pontos individuais aos 300.
4. **375 votos de satisfação** (300 votos + 75 trocas de "Insatisfeito" para "Valeu a pena");
5. **verificações de integridade**: respostas duplicadas, livro-razão × agregados, falhas de publicação.

O ambiente de teste foi este:
- **Máquina:** Windows 10, Node 24.13.
- **Banco:** **PGlite em memória**, que executa uma consulta por vez.
- **Topologia:** cliente e servidor na mesma máquina.

Os resultados brutos estão em `docs/load-results/`.

## Resultados (medidos em 16/10/2026)

| Métrica | Rajada (todos respondem no mesmo instante) | Respostas espalhadas em 8 s |
|---|---|---|
| Cadastro HTTP (p50 / p95) | 591 / 983 ms | 1 056 / 2 018 ms |
| Conexão WebSocket (p50 / p95) | 176 / 246 ms | 298 / 371 ms |
| Conectados contabilizados pelo servidor | 300 / 300 | 300 / 300 |
| **Entrega da pergunta a todos** (p50 / p95 / máx.) | **53 / 104 / 108 ms** | **105 / 171 / 175 ms** |
| **Resposta HTTP aceita** (p50 / p95 / máx.) | 2 500 / 4 413 / 4 727 ms | **39 / 425 / 586 ms** |
| Respostas aceitas por pergunta | 300 (+30 reenvios → 200 "duplicada") | 300 (+30 reenvios → 200 "duplicada") |
| Entrega dos pontos individuais a todos (p95) | < 41 ms | < 50 ms |
| Votos de satisfação (p50 / p95) | 3 075 / 3 076 ms (rajada de 300) | 1 108 / 2 223 ms |
| Resultado da satisfação | 300 votos válidos, 100% "Valeu a pena" após as trocas (correto) | idem |
| Respostas duplicadas | **0** | **0** |
| Divergências livro-razão × ranking | **0** | **0** |
| Falhas na publicação em tempo real | 0 (2 910 eventos emitidos) | 0 (3 036 eventos) |
| Memória do processo (RSS) | 615 MB | 588 MB |
| Re-tentativas de rede do cliente | 4 | 58 |
| **Veredito** | ✅ aprovado | ✅ aprovado |

## Interpretação

- **Tempo real:** a pergunta liberada chega aos 300 celulares em menos de 0,2 s e os pontos individuais em menos de 0,05 s. O agrupamento de atualizações (300–1000 ms) manteve o número de eventos estável (~3 mil eventos para todo o roteiro).
- **Integridade:** nenhuma resposta duplicada, nenhum ponto duplicado e o livro-razão bate com o ranking em todos os cenários, inclusive com reenvios e rajadas.
- **Latência das respostas:** no uso real as respostas chegam espalhadas por alguns segundos, e nesse caso o p50 fica em ~40 ms e o p95 abaixo de 0,6 s. Na rajada artificial (300 no mesmo milissegundo) o p50 sobe para ~2,5 s. Isso acontece porque o **PGlite serializa todas as transações**; com PostgreSQL real, as transações de resposta (que só fazem `FOR SHARE` na pergunta) rodam em paralelo pelo pool de conexões (`DB_POOL_MAX`, padrão 20).
- **Re-tentativas:** no Windows a fila de conexões TCP pendentes é limitada (~200). Algumas conexões da rajada foram recusadas e recuperadas pela repetição automática do cliente, que usa a mesma chave de idempotência (`src/lib/api.ts`). O servidor usa `backlog: 4096`; em Linux de produção esse limite é configurável (`net.core.somaxconn`).

## Como repetir contra PostgreSQL real

```bash
docker compose up -d db
LOAD_DATABASE_URL=postgres://gestalt:gestalt@localhost:5432/gestalt_live npm run load -- --participantes 300 --perguntas 3
```

Recomendações para eventos maiores (> 1 000 pessoas):
- PostgreSQL dedicado com `DB_POOL_MAX` entre 30 e 50;
- duas ou mais instâncias com `REDIS_URL` (adapter do Socket.IO) e *sticky sessions* no balanceador;
- Wi-Fi do local dimensionado para o público.

Ainda não testado (depende de infraestrutura externa): carga com PostgreSQL real e várias instâncias, e testes em rede Wi-Fi real com aparelhos físicos.
