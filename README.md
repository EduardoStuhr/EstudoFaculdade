# Caderno Online de Estudos

Aplicação React/Vinext para organizar matérias, páginas de estudo, blocos ricos, provas e anexos. Ela executa em Cloudflare Workers, usa D1/SQLite via Drizzle e armazena anexos no R2.

## Requisitos

- Node.js 22.13 ou superior;
- um banco D1 e um bucket R2 configurados pelo ambiente de hospedagem;
- Wrangler autenticado para aplicar migrations em um banco remoto.

## Configuração local

```bash
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Defina em `.dev.vars`:

```dotenv
JWT_SECRET=uma-chave-aleatoria-com-pelo-menos-32-caracteres
APP_URL=http://localhost:5173
RESEND_API_KEY=sua-chave-resend
EMAIL_FROM=Caderno de Estudos <conta@seu-dominio.com.br>
```

Em produção, configure `JWT_SECRET` e `RESEND_API_KEY` como secrets do Worker (não como variáveis versionadas). Configure também `EMAIL_FROM` e `APP_URL` no ambiente de execução. A sessão é um JWT assinado, entregue somente em cookie `HttpOnly`, `Secure` em HTTPS e `SameSite=Lax`, e validado contra o banco a cada requisição. As credenciais de `.dev.vars` são usadas apenas em desenvolvimento e não são copiadas para o build.

Não existe mais a conta automática `admin@local.test`/`123`. Todas as contas passam pela confirmação de e-mail.

## Banco e migrations

As migrations Drizzle ficam em `drizzle/`. A migration `0004_local_accounts_and_note_blocks.sql` cria `users`, separa blocos de notas em `note_blocks`, preserva o antigo proprietário em `legacy_owner` e introduz `user_id`.

Depois de configurar o nome do banco no Wrangler, aplique localmente ou no D1 publicado:

```bash
wrangler d1 migrations apply <NOME_DO_BANCO> --local
wrangler d1 migrations apply <NOME_DO_BANCO> --remote
```

Os registros antigos não são atribuídos automaticamente a uma conta. Após criar a conta de destino, revise e execute `scripts/reassign-legacy-user.sql`, substituindo os dois placeholders pelos IDs corretos. Isso atribui matérias, páginas, provas e metadados de anexos ao novo usuário sem copiar os binários do R2.

## Banco da conta Cloudflare de Eduardo

O binding `DB` usa o banco `caderno-estudos-db`, ID `e1924845-3615-4cc6-a0d1-50579f3ad132`. O ID não é uma credencial. A configuração fica em `wrangler.d1.json` e é reutilizada pelo build em `vite.config.ts`.

Para criar as tabelas no banco remoto, execute com uma conta/token Cloudflare autorizada:

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.d1.json
```

Esse comando aplica as migrations versionadas, incluindo as tabelas de login e confirmação de e-mail. A alteração no GitHub sozinha não executa a migration nem cria as tabelas.

Em Workers Builds, use `pnpm run build` para o build. Depois de configurar os recursos abaixo, o comando de deploy pode aplicar as migrations antes de publicar:

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.d1.json && npx wrangler deploy --config dist/server/wrangler.json
```

O token de build precisa de acesso ao D1 e à publicação do Worker. O nome do Worker gerado deve coincidir com o projeto em Workers Builds; confirme o nome no painel antes de publicar e, se necessário, informe `--name NOME_EXATO_DO_WORKER` no comando de deploy.

**Ainda necessário:** criar/verificar o bucket R2 `site-creator-r2`, usado pelo binding `BUCKET` existente, e configurar `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` no ambiente de execução. Não coloque as chaves em arquivos versionados. O cadastro continua bloqueado até o envio de e-mail estar configurado. Criar um endereço `workers.dev` não fornece um domínio remetente para o Resend.

## Autenticação e integração do ChatGPT

O header `oai-authenticated-user-id` foi removido. As rotas de dados exigem uma sessão JWT válida e cada consulta é filtrada por `user_id`.

As tools registradas por `document.modelContext.registerTool` continuam no navegador, na mesma página e sessão do usuário. Como elas chamam a API relativa do app, usam o cookie da sessão normal; não há token Bearer nem API key adicional.

Endpoints de autenticação:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/verify-email` — `{ token, password }`
- `POST /api/auth/resend-verification` — `{ email }`
- `POST /api/auth/forgot-password` — `{ email }`
- `POST /api/auth/reset-password` — `{ token, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Ativar o envio de e-mail

1. Crie uma conta no [Resend](https://resend.com), adicione seu domínio e valide os registros DNS pedidos pelo serviço. Crie uma API key com permissão de envio. O domínio de `EMAIL_FROM` deve estar verificado; o remetente de testes do provedor não serve para enviar a qualquer usuário.
2. Configure `APP_URL` com a origem pública exata (por exemplo, `https://caderno.seudominio.com.br`), sem caminho, parâmetros ou fragmento. HTTPS é obrigatório em produção. Os links são gerados somente a partir dessa configuração, nunca do header Host recebido.
3. Cadastre os secrets no Worker correto, por exemplo `npx wrangler secret put JWT_SECRET --name <WORKER>` e `npx wrangler secret put RESEND_API_KEY --name <WORKER>`. Configure `APP_URL` e `EMAIL_FROM` no mesmo ambiente. Não use prefixos `VITE_` ou `NEXT_PUBLIC_` para credenciais.
4. Aplique todas as migrations, inclusive `0005_email_authentication.sql`, no D1 do aplicativo antes de publicar o código. Faça backup e use uma janela de manutenção para coordenar a migration com o deploy. As contas existentes ficam pendentes de confirmação; seus cadernos são preservados. Na tela de entrada, use **Reenviar confirmação de e-mail**.
5. Publique o código e teste com uma caixa de entrada real: cadastro → e-mail → definição da senha/ativação → login → recuperação de senha → saída. Os testes automatizados simulam o provedor; não comprovam entrega real, DNS ou credenciais.

Sem configuração de e-mail, o cadastro e o envio de links retornam indisponibilidade e não liberam acesso. Se o primeiro envio falhar, a conta permanece pendente: solicite o reenvio quando o serviço voltar. Nas solicitações de recuperação e reenvio, a resposta permanece genérica inclusive quando o provedor falha; monitore a mensagem `Auth email delivery failed` no Worker e o painel do Resend.

### Comportamento e proteções

- Cadastro valida nome, e-mail normalizado e senha de 12 a 200 caracteres. A confirmação da senha também é solicitada na interface. O cadastro não abre uma sessão.
- A ativação exige que o dono do e-mail defina sua senha. Isso impede que uma senha escolhida por alguém que cadastrou o e-mail de outra pessoa permaneça válida depois da confirmação.
- Links aleatórios de 256 bits, armazenados somente como SHA-256 no D1: confirmação por 24 horas e recuperação por 30 minutos. A abertura da página não consome o link: é necessário enviar o formulário. O token vai no fragmento da URL, removido pelo navegador ao carregar a tela, e não nos logs HTTP. Se recarregar antes de concluir, reabra o link do e-mail.
- Consumo atômico por transação D1: um link não pode ser usado duas vezes, mesmo com requisições simultâneas. Ativar ou redefinir a senha invalida outros links e sessões da conta. O reenvio sozinho não invalida links ainda válidos.
- Senhas com PBKDF2-SHA256, salt individual e 600.000 iterações, via `node:crypto` com `nodejs_compat`; preserva os hashes existentes e evita o limite de iterações do WebCrypto do Workers. Dimensione o plano/limite de CPU do Worker para esse custo e monitore latência.
- Até 40 requisições de autenticação por IP em 15 minutos, 10 tentativas de login por e-mail e 3 solicitações de e-mail por endereço no mesmo período. Contadores atômicos no D1, com identificadores HMAC e `Retry-After`; não dependem da memória do Worker. Os limites contam tentativas válidas e inválidas. Usa somente `CF-Connecting-IP`; sem esse header, o ambiente local compartilha um limite.
- Respostas genéricas para credenciais inválidas e solicitações de recuperação/reenvio. A mensagem de e-mail não verificado no login aparece somente após conferir a senha. Isso reduz enumeração; não é uma garantia de tempos de resposta idênticos em serviços de rede.
- Sessões expiram em sete dias. **Sair da conta** revoga a sessão atual no banco; redefinir a senha revoga todas. JWTs anteriores à migration deixam de ser aceitos.
- Mutações exigem Origin da mesma origem. APIs de autenticação não usam cache; corpos JSON são limitados a 4 KiB. Tokens, senhas, chaves e respostas do provedor não são registrados em logs.
- Registros expirados de tokens, sessões e limites são removidos em lotes limitados durante o uso da autenticação.

### Verificação local

```bash
npm test
npm run typecheck
npm run build
```

Os testes executam as rotas reais com SQLite em memória, aplicam todas as migrations e simulam apenas o transporte D1 e o provedor de e-mail. Não enviam mensagens reais. Para testes manuais, use sua configuração Resend em `.dev.vars`. A implementação do envio segue a [API oficial do Resend](https://resend.com/docs/api-reference/emails/send-email).

## Conteúdo rico

Os blocos da anotação usam Tiptap com `StarterKit` e extensões de tabela. A colagem é sanitizada no navegador por DOMPurify, preservando parágrafos, listas, tabelas, negrito, itálico e quebras de linha. O D1 guarda o documento Tiptap como JSON em `note_blocks.content`; a API valida os nós e marcas aceitos antes de gravar.

Valide manualmente após iniciar o app: cole uma tabela de Word/Google Docs, texto com múltiplos parágrafos e listas ordenadas e não ordenadas; salve, recarregue a página e confirme que a estrutura foi preservada.

## Comandos

```bash
npm run dev
npm run build
npm run lint
npm run db:generate
```
