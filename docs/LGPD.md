# Privacidade e LGPD

> Este documento descreve o que o sistema implementa tecnicamente. Os textos de consentimento e a política de privacidade **precisam ser validados pelo jurídico** antes do uso comercial.

## Dados coletados
- **Identificação** (configurável por evento): nome completo, WhatsApp, e-mail e campos de perfil (empresa, profissão, cidade, segmento ou campos personalizados).
- **Participação:** respostas, tempos de resposta, pontuação, posição, avaliações de satisfação (voto atual + histórico).
- **Técnicos:** IP e *user agent* gravados apenas junto aos registros de consentimento; último acesso.

## Bases e consentimentos
- **Participação no evento** (obrigatório para entrar): texto e versão configuráveis por evento; registrado com data, hora, IP e cópia integral do texto (`consent_records`).
- **Comunicações comerciais** (opcional, nunca obrigatório): registro separado com a mesma estrutura. O participante pode **revogar** em "Meu perfil"; a organização também pode registrar a revogação no CRM (com justificativa e auditoria).
- Ao alterar um texto de consentimento sem mudar a versão, a versão é incrementada automaticamente.
- O histórico é append-only: a situação vigente é o registro mais recente de cada finalidade.

## Minimização e exposição
- Ranking, telão e eventos em tempo real nunca contêm e-mail ou telefone; o nome exibido é configurável (apelido, primeiro nome, nome + inicial) e filtrado para não conter e-mail/telefone.
- Palestrantes veem apenas nomes; contatos ficam restritos a administradores (`participants.read`).
- Exportações (CSV/XLSX) incluem e-mail/WhatsApp **apenas** de quem tem consentimento de marketing vigente, e toda exportação é auditada.
- Dados individuais de satisfação não são expostos na interface; a análise é agregada.

## Direitos do titular
- **Acesso/portabilidade:** perfil completo no CRM (dados, participações, respostas de perfil, pontuação, consentimentos) — exportável.
- **Revogação:** de marketing, pelo participante ou pela organização.
- **Anonimização:** remove nome, e-mail, telefone e campos de perfil, substitui o nome de exibição por "Anônimo" e preserva apenas as estatísticas agregadas (respostas e pontos continuam nos indicadores). Irreversível e auditada.
- **Exclusão total:** não exposta na interface para preservar a integridade dos resultados oficiais já publicados; a anonimização é o caminho recomendado.

## Segurança
Senhas com scrypt; tokens aleatórios guardados como hash; cookies `httpOnly`/`SameSite=Lax`/`Secure`; verificação de origem nas mutações; autorização por organização em toda rota; rate limiting; uploads validados por assinatura binária (sem SVG); logs de auditoria de ações administrativas.

## Retenção
Cada organização possui `retention_days` (configurável). A rotina automática de expurgo/anonimização ao fim do prazo ainda não foi implementada (ver `docs/PENDENCIAS.md`).
