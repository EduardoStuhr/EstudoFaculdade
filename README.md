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
```

Em produção, configure `JWT_SECRET` como secret do Worker (não como variável versionada). A sessão é um JWT assinado, entregue somente em cookie `HttpOnly`, `Secure` em HTTPS e `SameSite=Lax`.

## Banco e migrations

As migrations Drizzle ficam em `drizzle/`. A migration `0004_local_accounts_and_note_blocks.sql` cria `users`, separa blocos de notas em `note_blocks`, preserva o antigo proprietário em `legacy_owner` e introduz `user_id`.

Depois de configurar o nome do banco no Wrangler, aplique localmente ou no D1 publicado:

```bash
wrangler d1 migrations apply <NOME_DO_BANCO> --local
wrangler d1 migrations apply <NOME_DO_BANCO> --remote
```

Os registros antigos não são atribuídos automaticamente a uma conta. Após criar a conta de destino, revise e execute `scripts/reassign-legacy-user.sql`, substituindo os dois placeholders pelos IDs corretos. Isso atribui matérias, páginas, provas e metadados de anexos ao novo usuário sem copiar os binários do R2.

## Autenticação e integração do ChatGPT

O header `oai-authenticated-user-id` foi removido. As rotas de dados exigem uma sessão JWT válida e cada consulta é filtrada por `user_id`.

As tools registradas por `document.modelContext.registerTool` continuam no navegador, na mesma página e sessão do usuário. Como elas chamam a API relativa do app, usam o cookie da sessão normal; não há token Bearer nem API key adicional.

Endpoints de autenticação:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

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
