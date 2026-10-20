# Nuvem de Palavras

Oitava modalidade de pergunta do Gestalt Live. Os participantes enviam palavras ou frases curtas pelo celular e o telão mostra uma nuvem sendo construída em tempo real: quanto mais citado o termo, maior ele aparece.

Não é um módulo à parte: usa o mesmo cadastro de perguntas, o mesmo ciclo da sessão (liberar, cronômetro, encerrar, exibir/ocultar resultado), o mesmo tempo real (Socket.IO no servidor próprio, Supabase Realtime na Vercel), o Gerenciador de Apresentações, os relatórios e as exportações.

## Como usar
1. **Evento → Perguntas → Nova pergunta → Nuvem de Palavras.**
2. Aba **Nuvem** (regras):
   - **Modo**: *Palavra-chave* (cada palavra conta; artigos e preposições podem ser ignorados) ou *Frase curta* (a resposta inteira é uma expressão).
   - Máximo de palavras por resposta (padrão 3), de envios por participante (padrão 1) e de caracteres (padrão 50).
   - Permitir respostas repetidas do mesmo participante, exigir aprovação antes de exibir.
   - Filtro de palavras inadequadas (ativado), agrupar equivalentes, ignorar maiúsculas/minúsculas e acentos, ignorar palavras comuns.
   - Palavras bloqueadas e **sinônimos** (ex.: "Cliente" e "Clientes" → "Clientes"). Nada é agrupado por significado automaticamente.
   - O texto de orientação é a descrição da pergunta e a duração é o tempo limite (aba Comportamento).
3. Aba **Aparência**: estilos **Gestalt** (azul-marinho com fúcsia #FF0068 e branco), **Colorido** e **Minimalista** (fundo claro), fundo claro/escuro, animação de entrada, exibir frequência e máximo de termos — com **pré-visualização**. A aparência pode ser alterada durante a palestra.
4. Na apresentação, a pergunta aparece na biblioteca e pode ser inserida entre os slides como **Pergunta** (libera os envios) e como **Gráfico** (mostra a nuvem final).
5. Na sessão: **Liberar pergunta** → os celulares mostram o campo de texto → a nuvem cresce no telão → **Fechar pergunta** → exibir o resultado final → próximo item.

## Moderação (painel do palestrante)
- Envios pendentes (quando "exigir aprovação" está ligado) **não aparecem** no telão nem nos celulares até a aprovação.
- Aprovar/rejeitar envio, **ocultar** termo (deixa de contar), **bloquear** termo (oculta e recusa novos envios com ele) e **restaurar**.
- Nada é apagado: o envio muda de status, a regra fica registrada e todas as ações vão para o histórico da sessão e a auditoria.
- Termos inadequados são **recusados na hora** ("Sua resposta contém termos não permitidos"), não consomem envio e ficam registrados como recusados.

## Regras de contagem
- `VENDAS`, `vendas` e `Vendas` são o mesmo termo; "Automação" e "automacao" também (com "ignorar acentos").
- O rótulo exibido é a grafia mais usada (com acento quando houver), na forma capitalizada; siglas curtas ficam em maiúsculas (CRM).
- **Percentuais com denominador explícito**: no modo palavra-chave, sobre o total de termos contabilizados; no modo frase, sobre as respostas aprovadas. "Responderam" = participantes com envio aprovado.
- O texto original é preservado; a normalização é calculada na agregação — moderação e sinônimos valem também para envios anteriores.
- Depois da primeira resposta, as regras de envio (modo, limites, aprovação) ficam travadas; sinônimos, bloqueios e aparência continuam editáveis.

## Garantias
- Reenvio pela rede (mesma chave de idempotência) devolve o mesmo envio — nada é contado duas vezes.
- Limites de envios e de repetição valem mesmo com toques simultâneos (trava por participante).
- Prazo pelo relógio do servidor; pergunta fechada não aceita envios.
- Validação no servidor: limpeza de texto (sem HTML, controles ou caracteres invisíveis), tamanho, palavras, filtro, limite de requisições por participante.
- Telão e celulares recebem **apenas os termos agregados** (nunca envios pendentes, textos originais ou dados pessoais). A lista de envios originais só é vista no painel, com o apelido do participante.
- Ao reconectar, telão, painel e celular recebem a nuvem atual no estado inicial.
- LGPD: ao anonimizar um participante, o texto livre dele é apagado (fica só o registro do envio).

## Arquitetura
| Peça | Onde |
|---|---|
| Tipo, regras e aparência (Zod) | `shared/schemas.ts` (`NUVEM_PALAVRAS`, `wordCloudConfigSchema`, `chart.wordCloud`) |
| Limpeza, filtro, stopwords, sinônimos e agregação | `shared/wordcloud.ts` (funções puras, usadas no servidor, editor e ensaio) |
| Banco | migração `0004_nuvem_palavras`: `questions.word_cloud`, `word_cloud_entries`, `word_cloud_term_rules` |
| Envio, moderação, agregação, exportação | `server/domains/wordcloud.ts` |
| Resultados | `computeResults` devolve `wordCloud` + `categories` com os termos (mesmo canal `results:updated`) |
| Nuvem na tela | `src/components/charts/word-cloud-view.tsx` (SVG + transições) e `word-cloud-layout.ts` (d3-cloud, paletas, PNG) |
| Integração | `ChartView` desenha a nuvem sempre que a pergunta é desse tipo (telão, painel, apresentador, celular, ensaio, relatórios) |

Biblioteca de posicionamento: **d3-cloud** (BSD). O `echarts-wordcloud` foi descartado por não ser atualizado desde 2022 e exigir ECharts 5 (o projeto usa ECharts 6).

Desempenho: a nuvem é recalculada por janela de atualização do tempo real (300 ms no painel, 700 ms no telão; 1 s pelo tick na Vercel; 3 s no canal dos celulares), nunca a cada resposta. É uma consulta indexada às entradas aprovadas — para 300 participantes com 3 palavras, cerca de 900 linhas curtas. O layout no navegador é refeito no máximo a cada 1,2 s, com as palavras transitando suavemente para as novas posições.

## API
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/p/:code/wordcloud` | Envio do participante `{sessionQuestionId, text, idempotencyKey}` |
| GET | `/api/admin/sessions/:id/questions/:sqId/wordcloud?status=` | Envios (texto original, apelido, status), contagens e regras de termos |
| POST | `…/wordcloud/entries/:entryId/approve` · `/reject` | Moderação de envio |
| POST | `…/wordcloud/terms` `{term, action: hide\|block\|restore}` | Ocultar, bloquear ou restaurar termo |
| GET | `/api/admin/sessions/:id/export.csv?kind=nuvem` | CSV dos envios; o XLSX da sessão traz as abas "Nuvem de palavras" e "Termos da nuvem" |

Códigos de recusa do envio: `VAZIA`, `MUITO_LONGA`, `PALAVRAS_DEMAIS`, `SEM_PALAVRAS`, `TERMO_NAO_PERMITIDO` (422), `LIMITE_DE_ENVIOS`, `RESPOSTA_REPETIDA`, `PERGUNTA_FECHADA`, `TEMPO_ESGOTADO` (409).

## Testes
- `tests/unit/wordcloud.test.ts`: limpeza, limites, modo frase, filtro por palavra inteira (sem falso positivo), agrupamento de maiúsculas/acentos, sinônimos, denominadores, termos ocultos, compatibilidade de gráfico e schema.
- `tests/integration/wordcloud.test.ts`: cadastro, envio e regras no celular, limites, reenvio idempotente, recusa por filtro, pergunta fechada, trava de regras, pendentes fora do telão até aprovar, ocultar/restaurar/bloquear, relatório/CSV/XLSX/comparação entre turmas, anonimização (LGPD) e **300 participantes enviando simultaneamente com reenvios** (cada um conta uma vez).
- `tests/integration/realtime.test.ts`: telão e celulares recebem a nuvem crescendo via Socket.IO, e o estado do telão traz a nuvem após reconexão.
- `tests/integration/serverless.test.ts`: no modo Vercel, o tick publica a nuvem para telão e painel.
- `tests/integration/builder.test.ts`: exportação, importação e template levam regras e aparência.
- `tests/e2e/wordcloud.spec.ts`: fluxo completo no navegador.
