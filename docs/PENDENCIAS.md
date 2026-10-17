# Limitações e pendências conhecidas

## Dependem de infraestrutura externa
- **Carga com PostgreSQL real e múltiplas instâncias:** os testes de carga foram executados com PGlite (serializado). Repetir contra o PostgreSQL de produção (`docs/LOAD_TEST.md`).
- **Ensaio com aparelhos reais** na rede Wi-Fi do local do evento (iOS/Android, câmeras lendo o QR).
- **Validação jurídica** dos textos de consentimento, termos e política de privacidade.
- **Licença de uso web da fonte Diora Sunbright** (arquivo da identidade visual embarcado via `next/font/local`). Lato é licenciada sob OFL.
- **Domínio, HTTPS e backups** do ambiente de produção.
- **Armazenamento de imagens** em disco local (`UPLOAD_DIR`): com várias instâncias, usar volume compartilhado ou migrar para S3/compatível.

## Funcionais
- **Integrações:** há webhook genérico por organização (outbox + HMAC + novas tentativas; ver `docs/LGPD.md`). Faltam: conector nativo do CRM LIDIA (mapeamento de campos/autenticação próprios), evento de revogação de marketing para o CRM, mais de um destino por organização e reenvio em massa. A proteção contra rede interna valida o nome/IP da URL, mas não a resolução DNS (*DNS rebinding*).
- **Retenção:** a rotina automática anonimiza participantes vencidos, mas não reescreve os snapshots de ranking já gravados (`leaderboard_snapshots.entries` mantém o nome de exibição da época) nem remove IP/*user agent* dos registros de consentimento (`consent_records`) — o mesmo vale para a anonimização manual.
- **Relatório segmentado:** a satisfação e as exportações CSV/XLSX consideram a sessão inteira (não aplicam o filtro de segmento); a tela avisa.
- **Verificação de e-mail/WhatsApp:** não há (dados autodeclarados); a recuperação de acesso é por código emitido pela equipe.
- **Presença em múltiplas instâncias:** cada instância conta seus próprios sockets; com Redis os eventos são compartilhados, mas o total de "conectados" é por instância.
- **Rate limiting** em memória por instância (complementar no proxy).
- **Exportação de templates** não preserva a referência de cruzamento (`crossQuestionId`) entre perguntas — é reconfigurada após importar.
- **Editor de perguntas:** alternativas reordenadas por botões ↑↓ (arrastar e soltar apenas na lista de perguntas).
- **Painel inicial** de usuários sem `participants.read` mostra participações somadas (não pessoas únicas).

## Qualidade
- **Lint:** 0 erros. As regras do React Compiler (`react-hooks/set-state-in-effect`, `refs`, `purity`, `use-memo`) estão como aviso (41 ocorrências de padrões válidos sem o compilador: sincronização de estado em efeitos e "latest ref"). Refatorar se o React Compiler for adotado.
- **E2E** apenas em Chromium (desktop, Pixel 7, iPhone 13 e iPad Mini emulados).
- **Comparativo entre turmas** reconstrói o relatório de cada sessão — pode ficar lento em eventos com dezenas de turmas (paginar/agregar no futuro).
