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
- **Anonimização:** remove nome, e-mail, telefone e campos de perfil, substitui o nome de exibição por "Anônimo", apaga os eventos de integração do participante (outbox) e preserva apenas as estatísticas agregadas (respostas e pontos continuam nos indicadores). Irreversível e auditada.
- **Exclusão total:** não exposta na interface para preservar a integridade dos resultados oficiais já publicados; a anonimização é o caminho recomendado.

## Segurança
Senhas com scrypt; tokens aleatórios guardados como hash; cookies `httpOnly`/`SameSite=Lax`/`Secure`; verificação de origem nas mutações; autorização por organização em toda rota; rate limiting; uploads validados por assinatura binária (sem SVG); logs de auditoria de ações administrativas.

## Retenção
Cada organização possui `retention_days` (Configurações → Organização; entre 30 e 3650 dias, em branco = sem prazo).

Com o prazo definido, uma rotina automática (`server/domains/retention.ts`, agendada em `server/runtime.ts` a cada hora e 1 minuto após o início do servidor):
- **Anonimiza** os participantes cuja **última participação** — o mais recente entre a entrada na sessão (`session_participants.joined_at`) e o encerramento dela (`event_sessions.ended_at`) — é anterior a *agora − retention_days*. Usa a mesma anonimização do CRM (ver "Direitos do titular").
- **Nunca** afeta quem tem sessão em andamento (sala de espera, ao vivo ou pausada).
- **Remove do outbox** de integrações os itens já processados (ENVIADO/FALHOU) mais antigos que o prazo.
- **Audita** cada anonimização com ator de sistema (`participant.anonymize`, sem usuário, `data.system = "retencao"`) e um resumo por execução (`retention.run`). Na tela de auditoria, o usuário aparece como "Sistema". O registro de consentimento gerado tem `source = "SISTEMA"`.
- É idempotente e segura com várias instâncias (só altera quem ainda não foi anonimizado). Processa até 5.000 pessoas por organização a cada execução; o restante fica para a hora seguinte.

Limitação conhecida: os snapshots de ranking já gravados (`leaderboard_snapshots.entries`) guardam o nome de exibição da época e não são reescritos pela anonimização (ver `docs/PENDENCIAS.md`).

## Integrações (webhook)
Nada é enviado sem configuração explícita, e a plataforma **não envia WhatsApp nem e-mail**.
- A organização pode cadastrar **um webhook** (Configurações → Integrações). Sem webhook ativo, nenhum evento é enfileirado — nenhum dado pessoal é copiado para a fila.
- Eventos: `participant.joined` (somente quando o participante **concede o consentimento de marketing** naquele cadastro; inclui nome, e-mail, WhatsApp e campos de cadastro) e `session.ended` (apenas números agregados e o pódio pelo nome de exibição, sem contatos).
- Entrega por POST JSON assinado com HMAC-SHA256 (`X-Gestalt-Signature: sha256=<hex>` sobre `<timestamp>.<corpo>`), até 8 tentativas com backoff exponencial; status PENDENTE/ENVIADO/FALHOU. O segredo é exibido só na criação/rotação.
- Em produção, a URL precisa ser HTTPS e não pode apontar para rede interna (localhost, IPs privados); redirecionamentos não são seguidos.
- O painel mostra apenas a situação da fila (sem o conteúdo, que pode conter dados pessoais). Configuração, teste, rotação de segredo, remoção e reenvio são auditados.
- Revogar o marketing depois do envio não "desfaz" o que o sistema da organização já recebeu — a organização é responsável por tratar a revogação no próprio CRM.
