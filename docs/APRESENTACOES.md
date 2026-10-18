# Gerenciador de Apresentações

Transforma o Gestalt Live no ambiente único da palestra. Você importa os slides exportados do Canva (JPG/PNG), intercala-os com perguntas, enquetes, quizzes, gráficos, ranking, satisfação, QR Code, premiação e telas personalizadas numa **linha do tempo única**, ensaia sem afetar dados reais e apresenta controlando telão e celulares sincronizados.

## Como usar (passo a passo)
1. **Crie o evento** (Admin → Eventos). As perguntas da palestra pertencem ao evento.
2. **Crie a apresentação** (Admin → Apresentações → Nova). Ela pode começar vazia ou ser duplicada de outra. Vincule-a ao evento para poder inserir perguntas.
3. **Importe os slides:** no Canva, use *Compartilhar → Baixar → PNG ou JPG* com todas as páginas. No editor, arraste os arquivos para a coluna *Slides* (ou clique em *Enviar slides*). O envio é em lote: até 4 arquivos simultâneos, com progresso e nova tentativa por arquivo. Os slides entram na **ordem numérica do nome** (`slide-2` antes de `slide-10`).
4. **Organize** arrastando os itens na linha do tempo. Também é possível:
   - selecionar vários itens com Ctrl/Shift para excluir, ocultar ou mover em lote;
   - desfazer e refazer (Ctrl+Z / Ctrl+Shift+Z).

   O salvamento é automático.
5. **Insira interações** pelos botões "+" entre os itens ou pela biblioteca: perguntas do evento (pesquisa, enquete ou quiz), gráfico dos resultados, ranking, satisfação, QR Code, premiação e tela personalizada.
6. **Configure cada item** (painel direito):
   - **Gerais:** transição, tempo de permanência e notas do palestrante;
   - **Slides:** enquadramento e fundo;
   - **Perguntas:** abrir automaticamente ou aguardar o comando, fechar no fim do tempo, avançar após encerrar e fechar ao sair do item;
   - **Gráfico:** tipo de gráfico;
   - **Tela personalizada:** título, subtítulo, mensagem e imagem de fundo.
7. **Ensaie** (botão *Ensaiar*). O ensaio:
   - percorre todos os itens com as imagens reais e as transições;
   - usa gráficos, ranking e pódio com **dados demonstrativos** e simula a liberação das perguntas;
   - **não grava nada**;
   - pode abrir um *telão de ensaio* em outra janela.
8. **Apresente:**
   1. Na aba *Sessões* do evento, escolha a apresentação da sessão e clique em **Apresentar**.
   2. No modo apresentador: abra inscrições, inicie a sessão, clique em *Abrir telão* (leve a janela para o projetor/TV e aperte **F** para tela cheia) e em *Iniciar apresentação*.
   3. Avance com as setas, Page Up/Down, Espaço ou o passador de slides.

### Atalhos do modo apresentador
| Tecla | Ação |
|---|---|
| → · Page Down · Espaço | Próximo item |
| ← · Page Up · Backspace | Item anterior |
| B | Tela preta (alternar) |
| P | Tela de pausa (alternar) |
| F | Tela cheia |
| Esc | Sair da tela cheia / fechar janela |

Os atalhos ficam desativados enquanto você digita em campos de texto. Passadores de slides de qualquer fabricante funcionam, porque enviam setas ou Page Up/Down.

## O que cada interface mostra
| Item no telão | Telão | Celular do participante | Painel do palestrante |
|---|---|---|---|
| Slide de imagem / tela personalizada | Imagem em tela cheia (sem cortes por padrão) com transição | "Acompanhe a apresentação"; ranking, prêmios e satisfação continuam acessíveis; **uma pergunta aberta continua aberta** | Item atual, próximo, notas, controles |
| Pergunta / enquete / quiz | Enunciado e alternativas; cronômetro e progresso de respostas | A pergunta aparece **quando liberada** (automático ou manual, conforme o item) | Respostas em tempo real, controles de cronômetro, fechar, revelar |
| Gráfico | Resultado da pergunta (gráfico do item ou o da pergunta) | Resultado, se público | Contagem e controles |
| Ranking | Top 10 com pódio | Top 10 e posição individual atualizados | Ranking oficial |
| Satisfação | Pizza e indicadores | Botões continuam disponíveis | Termômetro |
| QR Code | Tela de boas-vindas com QR e código | — | — |
| Premiação | Pódio com os prêmios | Pódio | — |

**Item no telão ≠ pergunta aberta.** Mudar de item nunca encerra uma pergunta. As exceções são o item configurado com *fechar ao sair* e a liberação de outra pergunta, que segue a regra existente de uma pergunta aberta por vez.

## Arquitetura
O módulo **orquestra a engine ao vivo existente**. Não há uma segunda engine de perguntas.

- **Banco** (migração `0002_apresentacoes`, aditiva):
  - `presentation_assets`: biblioteca de slides, deduplicada por SHA-256 por organização;
  - `presentations`;
  - `presentation_items`: tipo, ordem, título, oculto, transição, `settings` jsonb, referência a `asset_id` ou `question_id`;
  - `presentation_speaker_notes`: tabela separada, lida só pela rota do apresentador;
  - `presentation_session_states`: item atual, índice, status, sobreposição tela preta/pausa, versão;
  - `presentation_state_history`.

  Colunas novas: `event_sessions.presentation_id` e `session_questions.auto_close`. Telas novas no telão: `SLIDE` e `TELA_PERSONALIZADA`.
  - Desvio da sugestão original: `presentation_item_settings` virou a coluna `settings` (jsonb validado por Zod em `shared/presentations.ts`).
- **Arquivos** em disco (`UPLOAD_DIR/<org>/slides/`), **nunca no PostgreSQL**, em três variantes:
  - `orig`: sem metadados;
  - `tela`: até 2560 px, webp de alta qualidade, usada no telão;
  - `mini`: 480 px, usada no editor e nas miniaturas.

  A validação confere a assinatura binária **e** a decodificação real (`sharp`), com limite de 20 MB por arquivo e de pixels. GIF, SVG e arquivos disfarçados são recusados. Excluir um slide da apresentação não apaga o arquivo; excluir da biblioteca só é possível quando ele não está em uso.
- **Navegação** (`server/domains/presenter.ts`):
  - cada comando roda em `withLive` (trava da sessão + eventos após o commit);
  - é idempotente: `next`/`prev` só avançam se `fromItemId` for o item atual, o que protege contra duplo clique do passador e contra duas janelas de controle;
  - pula itens ocultos.

  Ao chegar a um item, aplica as ações existentes: `setPresentation`, `openInternal` (só se *abrir automaticamente*), exibição de resultados, publicação de pontuação no ranking e revelação de prêmios. Também registra o histórico, incrementa a versão e emite `presentation:item` para o telão e o painel.
- **Automação:** o agendador avança slides com tempo de permanência e respeita `auto_close` por pergunta. O avanço automático após o encerramento é um gancho em `closeInternal`.
- **Telão:** `src/components/screen/screen-view.tsx` usa unidades de contêiner (`cqw`/`cqh`). O mesmo componente renderiza o telão, a prévia do apresentador e o ensaio. Imagens em `object-fit: contain` por padrão, transições CSS leves (fade, deslizar, zoom; desligadas com `prefers-reduced-motion`) e pré-carregamento das próximas duas imagens.
- **Segurança:**
  - editar exige `event.write`; apresentar exige `session.control`;
  - outra organização recebe 404;
  - notas do palestrante nunca entram nos estados do telão nem do participante, o que é verificado em teste;
  - arquivos servidos com `nosniff` e CSP `default-src 'none'`.
- **Reutilização:**
  - duplicar no mesmo evento mantém as referências;
  - duplicar para outro evento copia as perguntas usadas e remapeia;
  - duplicar um evento leva as apresentações junto;
  - os slides não são reenviados (mesmo arquivo físico).

## API (prefixo `/api/admin`)
| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/assets?orgId=` | Biblioteca (busca, pasta, uso) / upload de **um** arquivo (`file`, `folder`) |
| PATCH/DELETE | `/assets/:id` | Renomear/mover para pasta · excluir (409 se em uso) |
| GET | `/assets/:id/usage` | Apresentações que usam o arquivo |
| GET/POST | `/presentations?orgId=&eventId=` | Listar · criar |
| GET/PUT/DELETE | `/presentations/:id` | Detalhe (com notas) · editar · excluir |
| PUT | `/presentations/:id/items` | Salva a linha do tempo inteira (mantém ids) |
| POST | `/presentations/:id/slides` | Insere slides a partir de arquivos (`assetIds`, `insertAt`, `order`: `natural` por nome ou `pedida` na ordem enviada) |
| POST | `/presentations/:id/duplicate` | Duplica (`targetEventId` opcional) |
| GET/POST | `/sessions/:id/presenter` | Estado do apresentador · comandos `start`, `next`, `prev`, `goto`, `override`, `finish` |

Arquivos: `GET /api/assets/:org/:sha256-{orig,tela,mini}.{jpg,png,webp}`, com cache imutável.

## Testes
- `tests/unit/presentations.test.ts`: ordenação natural, navegação com itens ocultos, mapeamento item → telão, validação e padrões seguros.
- `tests/integration/presentations.test.ts`:
  - upload real de PNG/JPG, deduplicação, rejeição de arquivo disfarçado, corrompido ou GIF;
  - 50 slides em ordem natural; inserção na ordem de seleção (`order: "pedida"`) e capa da lista; linha do tempo completa; reordenação mantendo ids;
  - referências inválidas;
  - sessão real:
    - pergunta manual não abre sozinha;
    - liberação pelo painel;
    - **voltar ao slide mantém a pergunta aberta**;
    - gráfico com o tipo do item;
    - quiz automático com avanço após encerrar;
    - ranking com pontos, satisfação, tela personalizada, tela preta e pausa, premiação;
  - comando duplicado ignorado; retomada da posição; limites;
  - tempo de permanência;
  - duplicação para outro evento e do evento;
  - arquivo em uso;
  - permissões.
- `tests/integration/presenter-realtime.test.ts` (Socket.IO real): telão e painel recebem o item; o celular recebe a pergunta automática; slides não vão ao celular; a pergunta continua aberta ao voltar ao slide; o telão reconectado recupera o item; o gráfico chega ao telão.
- `tests/e2e/presentations.spec.ts` (build de produção, Chromium):
  - upload de 12 PNGs pelo seletor de arquivos, ordem natural, miniaturas (nunca os originais) no editor;
  - linha do tempo com pergunta automática, gráfico, ranking e premiação; notas no 1º slide;
  - ensaio navegando pelo teclado;
  - sessão real com 3 interfaces: apresentador (PageDown/→), telão (imagem `tela`, sem notas) e celular (Pixel 7) que recebe e responde a pergunta;
  - voltar ao slide mantém a pergunta respondida/aberta; recarregar o apresentador mantém a posição; gráfico, ranking e premiação no telão;
  - duplicar para outro evento;
  - editor e apresentador sem rolagem horizontal em celular e tablet.

Resultado da última execução: 101 testes Vitest (12 arquivos) e 5 E2E Playwright passando.

## Limitações
- Formatos aceitos: JPG e PNG (PDF, vídeo e GIF animado não). Para PDF do Canva, exporte como PNG.
- Arquivos em disco local: com várias instâncias, usar volume compartilhado ou armazenamento de objetos (S3).
- Perguntas de uma apresentação precisam ser do evento vinculado. Para reutilizar em outro evento, use *Duplicar para outro evento*.
- O ensaio é local (no navegador). Ele não simula outros celulares nem testa a rede do local; o QR exibido é demonstrativo (não leva a nenhuma sessão).
- Teclas apertadas enquanto o modo apresentador ainda está carregando (logo após abrir ou recarregar) são ignoradas. Espere o painel aparecer.
- Sem transição entre itens interativos: as transições (fade, deslizar, zoom) valem para slides de imagem; telas interativas trocam direto.
