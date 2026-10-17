# ADR-003 — Pontuação em duas fases (cálculo e publicação)

**Status:** aceito

## Contexto
Se os pontos fossem lançados no momento da resposta, o participante descobriria pelo placar se acertou antes de o palestrante revelar o gabarito. O requisito é: "não revelar a alternativa correta antes do momento configurado" e "pontuação calculada exclusivamente no backend".

## Decisão
1. **Cálculo no fechamento** da pergunta (`scoreQuestion`): para cada resposta aceita, `isCorrect`, `points` e `speedBonus` são gravados em `participant_answers`, usando o relógio do servidor e a configuração congelada na versão da pergunta.
   - Acerto: `floor((pontosBase + bônus) × peso)`; bônus = `floor(bonusMaximo × max(0, 1 − tempo/limite))` quando habilitado e houver tempo limite.
   - Erro: `−penalidade` (0 por padrão). Sem resposta: 0.
   - Múltiplas corretas: acerto somente com o conjunto exato.
2. **Publicação** (`publishScores`): os pontos entram em `score_transactions` e nos agregados de `session_participants` em uma única instrução (CTE `INSERT … ON CONFLICT DO NOTHING RETURNING` + `UPDATE … FROM`). Acontece na revelação do gabarito, ao liberar a próxima pergunta, ao exibir o ranking, ao descongelar o ranking ou ao encerrar a sessão.

## Consequências
- Ranking e placar individual nunca antecipam o gabarito.
- Publicação idempotente (`unique(answer_id, kind)`); revelar duas vezes não duplica pontos.
- Ajustes manuais (`ADJUSTMENT`) são auditados e exigem justificativa; após o resultado final, apenas a desclassificação/reintegração justificada (que gera nova revisão do pódio) é permitida.
- Consistência verificável: `ledgerMismatches()` compara agregados com a soma do livro-razão (usado nos testes e no teste de carga).
