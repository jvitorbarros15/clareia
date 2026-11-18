# API pública do Clareia: carga (Fase 1), servidor (Fase 2) e fornecedores e categorias (Fase 3)

Carregador e servidor HTTP somente leitura (`/healthz`, `/v1/meta`, `/v1/deputies`, `/v1/deputies/{id}`, `/v1/deputies/{id}/expenses`, `/v1/expenses/{public_id}`, `/v1/suppliers`, `/v1/suppliers/{key}`, `/v1/categories`). Plano: `agents/API-PUBLICA-PLANO-2026-11-17.md`.

## Postgres local

Um contêiner só para a API, em `127.0.0.1` e em porta diferente do `clareia-pg`:

```
docker run -d --name clareia-api-pg -p 127.0.0.1:54433:5432 \
  -e POSTGRES_DB=clareia_api -e POSTGRES_USER=clareia_api_owner \
  -e POSTGRES_PASSWORD=<senha> postgres:16
```

Se `docker run` falhar com "ports are not available", a porta caiu num intervalo reservado pelo Windows (`netsh int ipv4 show excludedportrange protocol=tcp`): escolha outra.

As senhas ficam fora do repo, em `~/.clareia/api-pg.env` (nunca o `r2.env`):

```
API_PG_OWNER=clareia_api_owner
API_PG_OWNER_PASSWORD=...
API_PG_RO_PASSWORD=...
API_PG_PORT=54433
API_PG_DB=clareia_api
```

`load.ps1` só lê esse arquivo, monta o DSN (com a senha escapada) e chama `go run ./cmd/load`. As variáveis valem só durante a chamada e são restauradas no fim. Em CI ou em outro ambiente, defina `CLAREIA_API_DSN` (dono do banco).

## Preparar o banco (uma vez)

```
api\load.ps1 -Setup
```

Cria o papel somente-leitura e fecha o que o `PUBLIC` deixa aberto. Precisa de superusuário. A senha do papel (`CLAREIA_API_RO_PASSWORD`) só é usada aqui; a carga nunca a toca. Sem o papel, a carga recusa e manda rodar `--setup`.

## Carregar uma publicação

```
api\load.ps1 <pasta data\<id> de um build>
# ou direto: cd api; go run ./cmd/load <pasta>
```

O próprio `cmd/load` faz tudo, nesta ordem; qualquer falha aborta antes de abrir o banco:

1. `npm run scan:cpf -- <pasta>` (sem `--known`).
2. `api/scripts/check-publication.ts`: as cinco recusas (id da pasta recalculado, schemas aceitos, não verificado sem `supplierKey`/`sha256`, rótulo genérico sem recibo, `id` de cada registro recalculado). Usa o código do build, não há cópia em Go.
3. Recusa pasta com `index.publishedAt` anterior ao da ativa (para voltar, use `--rollback`).
4. Carrega `pub_<id>` numa transação, roda todas as conferências contra os arquivos e só então ativa (views `api.*` + `api.publications`). Fica 1 ativa + 1 anterior.

Não há caminho que pule os passos 1 e 2. Os passos Node rodam sem as variáveis `CLAREIA_API_*`.

Carregar de novo uma pasta já carregada não faz nada: um schema existente nunca é apagado nem recarregado pela carga. Os números esperados vêm sempre dos arquivos.

## Revogar e voltar

```
api\load.ps1 -Rollback          # volta para a anterior; recusa se ela foi revogada
api\load.ps1 -Revoke <id>       # apaga o schema; recusa se for a ativa; o id não carrega mais
```

Se a nova publicação retira algo da anterior (nome retido, CPF, registro), revogue a anterior logo depois de ativar. Se a ativa precisa sair do ar e não há outra para ativar, a ferramenta ainda não faz isso: à mão, `DROP SCHEMA pub_<id> CASCADE` e uma linha `revoked` em `api.publications`.

## Papel somente-leitura

`clareia_api_ro`: `SELECT` só nas views `api.*`, sem `TEMPORARY`, `default_transaction_read_only = on`, `statement_timeout = 15s`. O `--setup` também tira do `PUBLIC` o `CONNECT` em `postgres` e `template1` e a execução de `lo_create`, `lo_creat` e `lo_from_bytea`.

## Servidor

```
$env:CLAREIA_API_RO_DSN = "postgres://clareia_api_ro:<senha>@127.0.0.1:54433/clareia_api"
cd api; go run -ldflags "-X main.version=<versão>" ./cmd/server     # escuta em 127.0.0.1:8787
```

- `CLAREIA_API_RO_DSN`: DSN do papel `clareia_api_ro` (a senha nunca é logada). `CLAREIA_API_PORT`: porta, padrão 8787. Escuta só em `127.0.0.1`.
- Só GET e HEAD; outros métodos dão 405. Erros são `{error, message}`. Todo corpo traz `publication`.
- O servidor lê só as views `api.*`: ao ativar outra publicação (ou `--rollback`) ele passa a servir a nova sem reiniciar. Cursor de outra publicação dá 409.
- `ETag` = publicação + versão do binário (`-X main.version`) + hash da query; `If-None-Match` dá 304. `Cache-Control: public, max-age=300`.
- Ordem de atualização: rode o carregador (`load.ps1 <pasta da publicação ativa>`, mesmo que seja no-op) antes de subir um servidor novo. O servidor lê `api.suppliers`; sem essa view, `/v1/suppliers` responde 500. O no-op cria e confere `pub_<id>.suppliers` em publicações já carregadas e `--rollback` faz o mesmo na anterior. Se a conferência acusar divergência, apague `pub_<id>.suppliers` e rode a carga da pasta de novo.
- Contrato e peculiaridades dos dados: `api/openapi.yaml` (conferido por `TestOpenAPIMatchesServer`).

## Fornecedores e categorias

- `GET /v1/suppliers?q=&cursor=&limit=`: um registro por rótulo (`supplierLabel` se existir, senão `supplier`), com `totalCents`, `records`, `deputies` (deputados distintos), `key` e `verified`. Os 49 rótulos sem chave (pessoa física, nome não exibido etc.) aparecem uma vez cada, com `key: null`, `verified: false` e sem página de detalhe: nunca são divididos nem somados a outros. Ordem por rótulo em ordem de bytes (estável); cursor leva a publicação (409 se mudou); `limit` 1 a 500, padrão 100.
- `q` (3 a 100 caracteres) é busca por trecho do rótulo sem diferenciar maiúsculas nem os acentos comuns do português (á, ç, ñ etc., tratados em SQL dos dois lados). Não usa `unicode`/`unaccent`: letras fora dessa lista só casam iguais.
- `GET /v1/suppliers/{key}`: só chave verificada (64 hex). Devolve `label`, totais e `cells` por deputado, mês e categoria (`cents`, `records`), sem paginação. Chave desconhecida ou de rótulo sem chave: 404; chave malformada: 400.
- `GET /v1/categories`: soma de `deputy_categories` por categoria, maior primeiro. O servidor confere que a soma fecha com `totalCents` e `records` da publicação; se não fechar, responde 500 em vez de um total errado.
- Usa as views `api.supplier_cells`, `api.deputy_categories` e `api.publication` que já existiam. Índice `supplier_cells(supplier_key)` (`supplier_cells_supplier_key_idx`): publicações novas o criam na carga; uma já carregada o recebe no próximo `load.ps1 <pasta>` (no-op que roda `CREATE INDEX IF NOT EXISTS`). Rótulo acima de 137 bytes faz a carga recusar (o cursor da listagem estouraria o teto de 200 bytes do parâmetro).

## Teste de contrato contra a publicação real (local, fora da CI)

Percorre `/expenses` de todos os deputados da publicação ativa, e depois `/v1/suppliers`, `/v1/suppliers/{key}` de toda chave verificada e `/v1/categories` (células iguais ao `fornecedores.json`, categorias iguais ao `summary.json`). Exige registros idênticos aos `despesas.json` da pasta, na mesma ordem, perfis iguais ao `summary.json` (mês retido = `cents` null) e lista vazia para os `withoutData`.

```
$env:CLAREIA_API_CONTRACT = "1"
$env:CLAREIA_API_RO_DSN = "postgres://clareia_api_ro:<senha>@127.0.0.1:54433/clareia_api"
$env:CLAREIA_API_CONTRACT_DATA = "<pasta data\<id> da publicação ativa>"
$env:CLAREIA_API_CONTRACT_DUMP = "<pasta temporária>"     # opcional: guarda todas as respostas
cd api; go test -count=1 -v -run Contract ./internal/server
npm run scan:cpf -- <pasta temporária>                    # na raiz do repo; depois apague a pasta
```

## Testes

```
$env:CLAREIA_API_TEST_DSN = "postgres://<dono>:<senha>@127.0.0.1:54433/clareia_api"
cd api; go vet ./...; go test -p 1 ./...
```

Sem `CLAREIA_API_TEST_DSN` ou sem `npx`, os testes são pulados localmente e **falham quando `CI` está definido** (o GitHub Actions define). Cada teste cria e apaga o próprio banco e o próprio papel, sem mexer em `clareia_api`. Os testes das recusas e do portão precisam de Node.

`api/testdata/` guarda 3 deputados recortados de um build real por `api/scripts/make-fixture.ts` (nunca editar à mão). É dado real de publicação, mantido de propósito no repositório público: retirar um dado exige regenerar a fixture, e o histórico do git não se apaga. Depois de regenerar: `npm run scan:cpf -- api/testdata`. O teste do CPF gera o número em tempo de execução; nenhum CPF vai para o git.

Atenção: o `--setup` (que cada teste chama) tira o `CONNECT` em `postgres` e `template1` do `PUBLIC` no servidor inteiro. Aponte `CLAREIA_API_TEST_DSN` só para um servidor dedicado a isto (o contêiner `clareia-api-pg` ou o serviço do CI), nunca para um compartilhado.
