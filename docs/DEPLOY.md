# Implantação

## Requisitos
- Host com **conexões persistentes** (VM, contêiner, Docker, Fly.io, Railway, Render, AWS ECS/EC2…) para o modo com Socket.IO e agendador residente — ou a **Vercel**, no modo serverless com Supabase Realtime e Storage ([VERCEL.md](VERCEL.md)).
- PostgreSQL 15+ (recomendado 17).
- Redis 7 — apenas se houver mais de uma instância.
- HTTPS no proxy/balanceador (cookies `Secure`, câmeras abrindo o QR Code em páginas seguras).

## Docker Compose (recomendado)

```bash
cp .env.example .env
# edite: APP_SECRET (obrigatório), SEED_SUPERADMIN_EMAIL/PASSWORD, PUBLIC_URL=https://live.seudominio.com.br
docker compose up -d --build
docker compose logs -f app
```

A aplicação aplica as migrações na inicialização e cria o superadministrador e o evento de demonstração (desative com `SEED_DEMO=false`). Troque a senha do superadmin no primeiro acesso: **Configurações → Minha conta**.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | `postgres://usuario:senha@host:5432/banco` (produção) · `pglite:./.data/db` (local) |
| `APP_SECRET` | Segredo de 32+ bytes (assina tokens do telão). **Obrigatório em produção.** |
| `PUBLIC_URL` | URL pública usada em links e QR Codes. Vazio = deriva do cabeçalho `Host`. |
| `PORT` | Porta HTTP (padrão 3000). |
| `REDIS_URL` | Ativa o adapter Redis do Socket.IO (múltiplas instâncias). |
| `TRUST_PROXY` | `true` atrás de proxy: usa `X-Forwarded-For/Proto/Host` para IP e URL. |
| `COOKIE_SECURE` | `true` (padrão em produção) exige HTTPS para o cookie administrativo. |
| `UPLOAD_DIR` | Pasta das imagens enviadas (persistir em volume). |
| `MAX_UPLOAD_BYTES` | Limite por imagem (padrão 3 MB). |
| `DB_POOL_MAX` | Conexões do pool PostgreSQL (padrão 20). |
| `LOG_LEVEL` | `debug` · `info` · `warn` · `error`. Logs estruturados em JSON (stdout/stderr). |
| `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` / `SEED_DEMO` | Dados iniciais (idempotente). |

## Sem Docker

```bash
npm ci
npm run build          # next build + bundle do servidor (dist/server.mjs)
DATABASE_URL=postgres://... APP_SECRET=... PUBLIC_URL=https://... npm start
```

## Proxy reverso (Nginx)

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;       # WebSocket
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;                      # conexões longas
  client_max_body_size 8m;                       # uploads
}
```
Com `TRUST_PROXY=true`. Para várias instâncias, use `ip_hash` (sticky) no `upstream` e configure `REDIS_URL`. Aplique também *rate limiting* no proxy (`limit_req`) como proteção adicional — os limites internos são por instância.

## Evento presencial com rede local (sem internet)
Rode no notebook do palestrante com `DATABASE_URL=pglite:./.data/db` (ou Postgres local), deixe `PUBLIC_URL` vazio e acesse o painel pelo IP da máquina na rede (ex.: `http://192.168.0.10:3000`). Assim o QR Code aponta para o IP e os celulares conectados ao mesmo Wi-Fi entram diretamente. Libere a porta no firewall.

## Backup e retenção
- Backup diário do PostgreSQL (`pg_dump`) e do volume de uploads.
- `organizations.retention_days` define o prazo de retenção por organização; a rotina automática (a cada hora) anonimiza os participantes vencidos e é auditada como "Sistema" (ver `docs/LGPD.md`). A anonimização individual continua disponível no CRM.
- Webhooks de integração (opcionais, por organização) saem do servidor para a URL configurada: libere HTTPS de saída se houver firewall.

## Checklist de produção
- [ ] `APP_SECRET` forte e exclusivo
- [ ] HTTPS ativo e `COOKIE_SECURE=true`
- [ ] Senha do superadmin trocada
- [ ] Textos de consentimento e política de privacidade validados pelo jurídico
- [ ] Backup do banco agendado
- [ ] Teste de carga contra o banco de produção (`docs/LOAD_TEST.md`)
- [ ] Ensaio com aparelhos reais na rede do local do evento


## Vercel
Veja [VERCEL.md](VERCEL.md): API como função, tempo real pelo Supabase Realtime e arquivos no Supabase Storage.

## Supabase (PostgreSQL gerenciado)
1. No painel do projeto, clique em **Connect** e copie a URI do **Session pooler** (porta **5432**). O *Direct connection* é só IPv6 e o *Transaction pooler* (6543) não é indicado para este servidor, que mantém conexões abertas.
2. Coloque em `DATABASE_URL` com a senha do banco. Codifique caracteres especiais da senha (`@` → `%40`, `#` → `%23`).
3. Defina `DB_POOL_MAX=10` (ou menos que o limite de conexões do plano).
4. Rode `npm run db:migrate` e `npm run db:seed` (ou apenas inicie o servidor: ele faz os dois).

Detalhes:
- SSL é ligado automaticamente para hosts remotos (`DB_SSL=verify` valida o certificado se você configurar a CA do Supabase).
- Ao conectar no Supabase, o servidor liga **RLS sem políticas** em todas as tabelas do schema `public`. Assim a API REST automática do Supabase (chave `anon`, que é pública) não lê nem grava nada; o Gestalt Live conecta como dono das tabelas e não é afetado.
- As chaves `anon` e `service_role` não são usadas pela aplicação. Nunca coloque a `service_role` em código do navegador.
- Imagens (logos, slides) continuam em `UPLOAD_DIR` no disco do servidor, não no Supabase Storage.
