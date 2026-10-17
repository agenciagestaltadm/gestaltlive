# ADR-004 — Motor de compatibilidade de gráficos

**Status:** aceito

## Contexto
O produto oferece 30 visualizações (ECharts). Oferecer todas para qualquer pergunta geraria representações incorretas (ex.: pizza de múltipla seleção, Sankey sem relação real, linha sem dimensão temporal).

## Decisão
`shared/charts/compat.ts` avalia cada tipo contra o contexto da pergunta (tipo, escolha única/múltipla, nº de categorias, escala numérica, dimensão temporal, existência de cruzamento real). O mesmo código roda:
- no construtor (galeria mostra todos os tipos; incompatíveis aparecem bloqueados com o motivo);
- no servidor ao salvar (rejeita com `GRAFICO_INCOMPATIVEL`);
- na exibição (se os dados reais não sustentarem o gráfico, usa o padrão e avisa).

Regras principais:
- Parte-do-todo (pizza, rosca, rose, semicírculo, treemap, waffle, funil, 100% empilhada, áreas empilhadas) apenas com escolha única e até 8 categorias (treemap sem limite).
- Temporais usam o horário de recebimento das respostas (evolução real).
- Agrupadas, empilhadas, Sankey e heatmap por segmento exigem cruzamento com uma pergunta de escolha única respondida pelos mesmos participantes da mesma sessão.
- Dispersão: nota × tempo de resposta, só escalas/NPS. Bolhas: tempo médio × % × quantidade.
- Sunburst/pizza multinível: só hierarquias reais (NPS → nota; certa/errada → alternativa após revelação; segmento → resposta).
- Gauge/KPI: indicadores únicos (média, NPS, % de acerto, % de "Sim", participação).

## Consequências
Percentuais são sempre sobre **respondentes**; seleções e inscritos são exibidos separadamente — em múltipla escolha a soma pode passar de 100%, e isso é explicitado.
