# Publicação na Vercel (com Supabase)

O Gestalt Live roda de dois jeitos, com o mesmo código:

| | Servidor próprio (local, Docker, Railway…) | Vercel (serverless) |
|---|---|---|
| API | Hono no servidor Node (`server/index.ts`) | A mesma API como função (`src/app/api/[...path]/route.ts`) |
| Tempo real | Socket.IO | **Supabase Realtime** (canais privados) |
| Cronômetro das perguntas e avanço de slides | Agendador residente (250 ms) | **Tick da sessão**: o telão e o painel chamam `POST /api/realtime/tick` a cada segundo |
| Resultados, ranking e satisfação ao vivo | Agregação em memória | Calculados no tick e enviados só quando mudam |
| Presença ("conectados") | Conexões abertas | Sinal de vida do celular a cada 25 s |
| Imagens e slides | Disco (`UPLOAD_DIR`) ou Supabase Storage | **Supabase Storage** (obrigatório) |
| Slides grandes | Pela API (até 20 MB) | Direto do navegador ao Storage (até 20 MB, sem o limite de 4,5 MB das funções) |
| Migrações | Na inicialização | No build (`npm run vercel-build`) |
| Retenção LGPD e webhooks | Rotinas residentes | Rotina diária (Vercel Cron) + durante as sessões |

O modo é escolhido sozinho (na Vercel, `VERCEL=1`). Para forçar: `REALTIME_TRANSPORT=socket|supabase` e `STORAGE_DRIVER=disk|supabase`.

## Passo a passo
1. **Variáveis de ambiente** em *Vercel → Project → Settings → Environment Variables* (ambiente *Production*; marque *Preview* também se for usar):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | URI do **Transaction pooler** do Supabase (porta **6543**), com a senha do banco. Caracteres especiais da senha codificados (`@` → `%40`). |
   | `APP_SECRET` | O mesmo valor do `.env` local (64 caracteres). Trocar invalida logins e QR Codes do telão. |
   | `SUPABASE_URL` | `https://<projeto>.supabase.co` |
   | `SUPABASE_ANON_KEY` | Chave `anon` (pública) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Chave `service_role` (secreta — só no servidor) |
   | `PUBLIC_URL` | Domínio de produção, ex.: `https://gestaltlive.vercel.app` (links e QR Codes) |
   | `CRON_SECRET` | Texto aleatório longo (protege a rotina diária) |

   Opcionais: `DB_POOL_MAX` (padrão 3 na Vercel), `SEED_SUPERADMIN_EMAIL`/`SEED_SUPERADMIN_PASSWORD` (só para banco vazio), `SUPABASE_BUCKET` (padrão `gestalt-live`).
2. **Deploy:** cada `git push` na `main` publica. O build roda `npm run vercel-build`:
   migrações → preparação do Supabase (política dos canais e buckets) → seed (só em banco vazio) → `next build`.
3. **Primeiro acesso:** `https://<domínio>/login`. Usuários são os do Gestalt Live (Configurações → Equipe), não os do *Authentication* do Supabase.

## Segurança
- **Canais privados**: o servidor publica com a `service_role`; os navegadores só recebem (política RLS de leitura em `realtime.messages`, sem política de escrita). Testado: um cliente com a chave `anon` não consegue forjar eventos para os outros.
- Os nomes dos canais são derivados do `APP_SECRET` e entregues pelo `POST /api/realtime/ticket` somente a quem passa na mesma autorização do Socket.IO (token do participante, token do telão ou login com permissão de controle).
- Trocar o token do telão muda o canal dele e avisa o telão antigo (`rt:revoked`).
- Tabelas do schema `public` com RLS ligado e sem políticas: a API REST do Supabase não lê nem grava nada.
- Bucket `gestalt-live` público (nomes aleatórios ou SHA-256, como as rotas públicas de imagens) e bucket `gestalt-live-envios` privado (recebimento dos slides antes do processamento).

## Limites a conhecer
- **Supabase Realtime (plano Free):** cerca de 200 conexões simultâneas e 100 mensagens por segundo. Cada mensagem ao canal dos participantes conta uma vez por celular conectado — por isso esse canal recebe atualizações no máximo a cada 3 s. Para plateias acima de ~150 pessoas, use o plano Pro do Supabase.
- **Vercel Hobby:** pelos termos da Vercel, o plano Hobby é para uso pessoal e não comercial; para uso da empresa, o plano Pro. A rotina diária (Cron) roda uma vez por dia no Hobby.
- **Tick depende do telão ou do painel aberto:** sem nenhum deles, o cronômetro só é aplicado nas respostas (o servidor recusa respostas após o prazo), e o fechamento automático acontece quando um deles abrir.
- **Atualizações agregadas** chegam em até ~1 s ao painel e ao telão (no servidor próprio, ~0,3 s).
- Limites de requisições por IP/usuário ficam em memória por instância da função (mais permissivos que no servidor próprio).
- Cada tick e cada sinal de vida é uma invocação de função: uma sessão de 2 h com 300 celulares gera da ordem de 100 mil invocações.

## Testes
- `tests/integration/serverless.test.ts`: ticket e permissões, publicação ao fim da requisição, tick (exclusão mútua entre janelas, envio só do que mudou, gabarito só para o painel), fechamento pelo cronômetro, presença, revogação do telão, envio direto de slides e rotina diária — com o Supabase simulado.
- Verificado também contra o Supabase real: assinatura de canal privado, bloqueio de eventos forjados, Storage (gravação, leitura pública, envio assinado) e, com `next start` (API como função, como na Vercel), o telão recebendo a pergunta pelo Supabase Realtime e o tick fechando a pergunta de 20 s sozinho.
