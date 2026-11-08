# Clareia

Portal de transparência sobre deputados federais, com dados oficiais conferidos: despesas da cota parlamentar (CEAP) hoje; votações, projetos, eleições e emendas nas próximas etapas.

Todo número publicado passa por uma releitura independente do arquivo oficial antes de entrar no site. Fornecedores pessoa física aparecem só como "Fornecedor pessoa física", e o site e o banco são varridos em busca de CPF antes de cada gravação.

## Como funciona

- **Coleta agendada** (`.github/workflows/collect.yml`): GitHub Actions, 3 vezes por dia. Restaura o banco de uma cópia cifrada no Cloudflare R2, coleta só se a fonte mudou, audita (quando `PUBLISH_ENABLED` está ligado), gera o site e salva o banco de novo.
- **Versões por domínio** (`src/publications.ts`): cada coleta vira uma versão; só uma versão com auditoria aprovada fica ativa.
- **Site estático** (`src/build-site.ts`, `real/`): gerado a partir da versão ativa, sem servidor nem banco online.

## Executar localmente

Node.js 22 ou superior:

```sh
npm ci
npm run collect
npm run build:site
npm run dev
```

Abra http://127.0.0.1:4174. Detalhes, recorte atual, conferências e limites: [real/README.md](real/README.md).

## Verificar

```sh
npm run typecheck
npm test
npm run verify:annual
npm run verify:browser
```

`verify:browser` precisa do servidor ativo e do Playwright com Chromium. Relatórios ficam em `output/qa/`, fora do Git.

O protótipo visual com dados fictícios foi retirado; o último estado dele está na tag `mvp-final`.

## Descobrir o universo histórico

`npm run discover:people -- --local --run descoberta-2025-2026` compara as listas históricas e os IDs dos anuais CEAP, preserva originais cifrados e produz uma conferência independente. Não altera o banco ou os dados do site. Contrato, uso, resultados observados e limites: [descoberta de pessoas](docs/source-contracts/camara-people-discovery.md).

Após a descoberta, `npm run collect:people -- --local --discovery-run ID --run ID` coleta todos os históricos em dois passes. `npm run resolve:people -- --local --run ID` deriva intervalos e competências e audita contra os originais, com atribuição pública desativada. [Contrato e limites do histórico](docs/source-contracts/camara-people-history.md).
