# Caderno Online de Estudos

Aplicação React/Vinext para organizar matérias, páginas de estudo, resumos, blocos de conteúdo, provas e arquivos. O projeto utiliza autenticação do ChatGPT, Cloudflare D1 para os dados e R2 para anexos.

## Conteúdo incluído

Este pacote contém um backup em `backup/caderno-conteudo-backup.json` com:

- 4 matérias;
- 9 páginas completas;
- 3 provas;
- títulos, textos, resumos e blocos formatados;
- nenhum anexo, pois não havia arquivos armazenados no momento da exportação.

Leia `backup/LEIA-ME.md` antes de publicar o repositório. O backup contém suas anotações pessoais; use um repositório privado caso não queira torná-las públicas.

## Executar localmente

Requisitos: Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Para validar a versão de produção:

```bash
npm run build
```

## Estrutura principal

- `app/notebook.tsx`: interface do caderno;
- `app/api/notebook/route.ts`: API de matérias, páginas, provas e anexos;
- `db/schema.ts`: estrutura do banco de dados;
- `drizzle/`: migrações do banco D1;
- `backup/`: cópia do conteúdo exportado.

## Persistência

O site hospedado mantém os dados no banco D1 do próprio projeto. O arquivo JSON deste repositório é um backup portátil e não substitui automaticamente o banco de uma nova implantação.
