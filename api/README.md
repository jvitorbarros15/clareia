# API pública do Clareia: carga (Fase 1)

Só o carregador. Ainda não há servidor HTTP. Plano: `agents/API-PUBLICA-PLANO-2026-11-17.md`.

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

`load.ps1` lê esse arquivo. Em CI ou em outro ambiente, defina `CLAREIA_API_DSN` (dono do banco) e `CLAREIA_API_RO_PASSWORD`.

## Carregar uma publicação

```
api\load.ps1 <pasta data\<id> de um build>
```

Passos, nesta ordem; qualquer falha aborta:

1. `npm run scan:cpf -- <pasta>` (sem `--known`).
2. `api/scripts/check-publication.ts`: as cinco recusas (id da pasta recalculado, schemas aceitos, não verificado sem `supplierKey`/`sha256`, rótulo genérico sem recibo, `id` de cada registro recalculado). Usa o código do build, não há cópia em Go.
3. `go run ./cmd/load <pasta>`: carrega `pub_<id>` numa transação, roda todas as conferências contra os arquivos e só então ativa (views `api.*` + `api.publications`). Fica 1 ativa + 1 anterior.

Carregar de novo a mesma pasta não faz nada. Os números esperados vêm sempre dos arquivos.

## Revogar e voltar

```
api\load.ps1 -Rollback          # volta para a anterior; recusa se ela foi revogada
api\load.ps1 -Revoke <id>       # apaga o schema; recusa se for a ativa; o id não carrega mais
```

Se a nova publicação retira algo da anterior (nome retido, CPF, registro), revogue a anterior logo depois de ativar.

## Papel somente-leitura

`clareia_api_ro`: `SELECT` só nas views `api.*`, sem `TEMPORARY`, `default_transaction_read_only = on`, `statement_timeout = 15s`. É criado pela própria carga.

## Testes

```
$env:CLAREIA_API_TEST_DSN = "postgres://<dono>:<senha>@127.0.0.1:54433/clareia_api"
cd api; go vet ./...; go test ./...
```

Sem `CLAREIA_API_TEST_DSN` os testes de banco são pulados. Cada teste cria e apaga o próprio banco e o próprio papel, sem mexer em `clareia_api`. Os testes das recusas e do CPF precisam de Node (`npx tsx`).

`api/testdata/` guarda 3 deputados recortados de um build real por `api/scripts/make-fixture.ts` (nunca editar à mão). Depois de regenerar: `npm run scan:cpf -- api/testdata`. O teste do CPF gera o número em tempo de execução; nenhum CPF vai para o git.
