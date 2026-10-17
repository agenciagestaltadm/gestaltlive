# ADR-005 — Identidade do participante sem senha

**Status:** aceito

## Contexto
Participantes entram por QR Code sem senha. E-mail e WhatsApp são autodeclarados e não verificados. É preciso evitar cadastros duplicados, permitir retorno após queda de conexão e impedir que alguém responda em nome de outra pessoa.

## Decisão
- No cadastro o servidor emite uma **credencial de participação** (token aleatório de 256 bits); só o hash SHA-256 é guardado. O aparelho guarda o token no `localStorage` (por código de sessão) e o envia como `Bearer` em toda operação e no handshake do socket.
- O servidor **sempre** deriva o participante do token — IDs enviados pelo cliente são ignorados. Toda pergunta respondida precisa pertencer à sessão da credencial.
- **Unicidade configurável** por sessão (`EMAIL`, `PHONE`, `EMAIL_OR_PHONE`, `NONE`) com identificadores normalizados e índices únicos parciais.
- Um cadastro duplicado **não devolve** a credencial existente (isso permitiria assumir a identidade de outra pessoa digitando o e-mail dela). A recuperação é feita por **código de 6 dígitos** emitido pela equipe no painel (válido por 15 min, limitado por IP e por sessão); a credencial anterior é invalidada.
- Nome de exibição no ranking configurável (apelido, primeiro nome, nome + inicial); e-mail e telefone nunca aparecem em DTOs públicos.

## Consequências
- Limpar os dados do navegador exige o código de recuperação.
- Várias abas com a mesma credencial são a mesma pessoa (presença deduplicada).
