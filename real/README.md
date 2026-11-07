# Piloto real — arquivo CEAP da Câmara

Implementado em 3 de novembro de 2026. Interface em português; coletor e backend em TypeScript.

## Executar

Node.js 22 ou superior:

```sh
npm ci
npm run collect
npm run build:site
npm run dev
```

Abra **http://127.0.0.1:4174**. `build:site` gera `dist/` a partir da versão auditada ativa; `npm run dev` só serve `dist/`.

O banco local é PostgreSQL via PGlite, persistido em `data/local/postgres`. Se `DATABASE_URL` estiver definido no ambiente, o adaptador usa um servidor PostgreSQL normal. `.env.example` documenta as opções; arquivos `.env` não são carregados automaticamente.

O piloto local permite um processo por vez: **encerre o servidor antes de coletar novamente**. Após uma interrupção forçada, a próxima execução assume a trava se o dono já terminou; `npm run unlock` faz o mesmo manualmente e remove a trava apenas se o processo registrado já tiver terminado. Em Windows/OneDrive, o adaptador ajusta o atributo de diretórios exclusivamente dentro da árvore local do banco, para permitir a reabertura pelo filesystem do PGlite.

## Recorte e resultado

- Câmara, legislatura 57; competências janeiro e fevereiro de 2025.
- IDs 204379 (Acácio Favacho), 204534 (Tabata Amaral), 160976 (Tiririca).
- Seleção técnica de amostra, sem representatividade estatística ou ranking.
- **194 lançamentos; R$ 209.337,46** de soma do campo `vlrLiquido` no arquivo anual, na captura de 03/11/2026.
- O campo é uma medida específica da fonte, não gasto total do mandato ou juízo sobre a legitimidade da despesa.

## Descoberta que mudou a fonte principal

A API retornou **179 registros e R$ 211.273,11** para o mesmo recorte. O arquivo anual continha 15 ocorrências adicionais, incluindo telefonia e dois ajustes negativos de complementação de auxílio-moradia. A diferença líquida foi **−R$ 1.935,65**.

Por isso, o piloto usa o **arquivo anual como fonte explícita de todos os valores**, sem fazer união cega de fontes. A API fornece identidade e uma comparação registrada; não substitui linhas do CSV. Todas as ocorrências da API precisam estar reconciliadas no arquivo. Uma ocorrência extra na API bloqueia a publicação para investigação.

A versão preliminar baseada apenas na API foi preservada no banco, mas retida nas rotas públicas. Links para ela retornam indisponibilidade. Não presumimos que o comportamento encontrado nesta amostra vale para todos os períodos.

### As 15 ocorrências, registro por registro

`npm run verify:api-annual` compara as páginas da API e o CSV preservados na execução publicada (`data/runs/9d9bdb37-…`), sem reutilizar o normalizador. Resultado: 179 pares exatos (pessoa, competência, documento, categoria e valor líquido; número, emissão e lote também conferem), 15 ocorrências só no arquivo, nenhuma só na API.

| Grupo no arquivo anual | Ocorrências | Soma líquida | Característica |
|---|---:|---:|---|
| TELEFONIA · CELULAR FUNCIONAL | 6 | R$ 1.552,44 | `ideDocumento` = 0, sem CNPJ válido; 204379 e 204534 |
| TELEFONIA · RAMAL | 7 | R$ 5,91 | `ideDocumento` = 0, sem CNPJ válido; os três deputados |
| COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA | 2 | −R$ 3.494,00 | 160976, jan e fev: `vlrDocumento` 1747, `vlrGlosa` vazio, `vlrLiquido` −1747 |

Total: −R$ 1.935,65, igual à diferença entre as somas. No arquivo de 2025 inteiro, `ideDocumento` = 0 só aparece em TELEFONIA (RAMAL, CELULAR FUNCIONAL, LINHA DIRETA): é um identificador ausente, não um valor. A interface mostra "Sem documento fiscal (código 0 na fonte)" nesses registros. Nos ajustes de auxílio-moradia, documento positivo e líquido negativo não formam a conta documento − glosa; a interface mostra os três campos separadamente, sem equação, e não recalcula o líquido.

### O arquivo anual mudou depois da publicação

A coleta de 05/11/2026 (execução `13cc2ab4`) foi retida pela proteção de `src/annual.ts`. O arquivo `Ano-2025` caiu de cerca de 209 mil para 170 mil linhas (sha `012b0b…` para `9341f9…`). No recorte, passou de 194 para 134 registros: saíram 58 passagens SIGEPA e 2 ajustes de auxílio-moradia, e nenhum entrou. A API continuou com 179 registros, então 58 ocorrências ficaram só na API.

Uma segunda captura no mesmo dia trouxe o mesmo hash, e o servidor da Câmara indica regeneração em 05/11/2026 às 06:19 (GMT), também no arquivo de 2024. A redução é estável, mas a causa não é conhecida: não a trate como correção nem como falha sem confirmar com a Câmara. A versão publicada segue sendo a da execução `9d9bdb37`.

### O arquivo anual não é um superconjunto da API

Consulta da API em 04/11/2026 para o ano inteiro de 2025 dos mesmos três IDs: além de telefonia interna e auxílio-moradia ausentes da API, **141 lançamentos de PASSAGEM AÉREA - SIGEPA de agosto a dezembro**, com `codDocumento` em formato UUID, existem na API e não aparecem no arquivo anual capturado. Nenhum caso semelhante ocorre em janeiro–fevereiro. Ampliar o recorte para esses meses dispara o bloqueio de ocorrência extra na API (`src/annual.ts`, `extraInApi`). Esse bloqueio continua até a regra de união abaixo ser implementada.

### Regra de união API + arquivo anual (obrigatória antes de passar de fevereiro)

Implementada em `unionRecords` (`src/annual.ts`). Uma ocorrência que estava publicada e sumiu das duas fontes retém a publicação: revise e rode `npm run collect -- --accept-removed` para publicar sem ela, com a retirada registrada na versão.

1. **Chave de pareamento.** `(ID Câmara, ano, mês de competência, ideDocumento/codDocumento como texto, txtDescricao/tipoDespesa, valor líquido em centavos)`, a mesma de `src/reconcile.ts`. Pareamento 1:1 por multiplicidade: cada ocorrência de uma fonte consome no máximo uma da outra. Sem tolerância de valor, sem janela de datas e sem casar por nome de fornecedor.
2. **Par conferido.** Número do documento, data de emissão e lote também precisam coincidir. Se a chave casar e esses campos divergirem, o par é retido para revisão e a publicação daquela pessoa/mês não acontece.
3. **Quem vence no par.** O arquivo anual fornece todos os valores e campos descritivos (`vlrLiquido`, `vlrDocumento`, `vlrGlosa`, fornecedor, datas). A API fica como referência cruzada (`codDocumento`, URL da página).
4. **Só no arquivo anual.** Entram, com fonte = arquivo anual. Tipos conhecidos: TELEFONIA (RAMAL, CELULAR FUNCIONAL, LINHA DIRETA; `ideDocumento` = 0) e ajustes de COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA, inclusive negativos. Um tipo fora dessa lista retém a publicação até ser revisado e adicionado.
5. **Só na API.** Entram apenas PASSAGEM AÉREA - SIGEPA, com qualquer formato de `codDocumento` (os de janeiro–fevereiro são numéricos), com fonte = API e `valorLiquido` da API. Qualquer outro tipo só na API continua bloqueando a publicação.
6. **Promoção.** Se uma captura anual posterior trouxer uma ocorrência que estava só na API, ela passa a par e o valor do arquivo anual vence. Isso gera uma nova versão (novo identificador por conteúdo).
7. **Conferência.** Total da união = total anual + só API = total API + só anual. As duas igualdades precisam fechar em centavos, com o acumulador independente e a soma SQL, antes de publicar.
8. **Apresentação.** Cada registro traz a origem: "arquivo anual e API", "só no arquivo anual" ou "só na API (ausente do arquivo anual capturado em <data>)". A origem aparece na tabela, no diálogo do registro e numa coluna da exportação CSV. O resumo mostra quanto do total vem de cada origem. Filtros e gráficos não escondem registros de uma só fonte.

Também foi necessário passar `idLegislatura=57` explicitamente: sem esse filtro, as consultas históricas tentadas retornaram listas vazias. O coletor recusou publicar esses resultados como zero.

## Fluxo da coleta

1. Ler `config/pilot.json`, validar três IDs, dois meses encerrados e legislatura explícita.
2. Confirmar os IDs na API; armazenar nome/retrato atuais sem inferir UF ou partido históricos.
3. Coletar todas as páginas de despesas duas vezes, com tamanhos 100 e 25, e comparar os conjuntos.
4. Baixar duas cópias do arquivo anual oficial, preservar os ZIPs e hashes, ler todas as linhas e selecionar os IDs/competências.
5. Comparar as duas capturas do recorte. Preservar ocorrências distintas do mesmo documento; reter linhas exatamente iguais e ambíguas.
6. Validar o esquema e valores. Campos vazios de documento/glosa permanecem `null`; não se presume zero. Valores negativos são mantidos.
7. Comparar a cobertura da API com o arquivo; registrar a diferença sem combinar as somas.
8. Reconciliar a soma normalizada em centavos com um acumulador decimal independente e uma soma SQL.
9. Inserir a versão e trocar a referência ativa em uma transação. Falhas anteriores à publicação mantêm a versão aprovada anterior.

O identificador da versão é o SHA-256 do corpo canônico completo da versão (métrica, recorte, pessoas, registros, páginas e hashes, validação e textos de limitação) junto com a versão do esquema (`clareia.snapshot.v2`, `src/model.ts`). Só os horários de captura (`publishedAt`, `collectedAt`, `fetchedAt`, `profileFetchedAt`) ficam fora, para que recoletar o mesmo conteúdo seja idempotente: nesse caso a versão já gravada, com os horários da primeira captura, é mantida e o manifesto da nova execução registra os próprios horários. Qualquer outra mudança, inclusive só de texto com o mesmo total, gera outro identificador e nova versão. `publish` recusa um identificador que não corresponda ao conteúdo e, se o identificador já existir com corpo diferente, falha em vez de ignorar. As versões anteriores permanecem preservadas.

### Versões no banco local

| Versão | Execução | Situação |
|---|---|---|
| `98d2b15d…` | `ce550a5f…`, `0b5e35f7…` | Só API (179 registros). Retida nas rotas públicas. |
| `1fc35649…` | `aa7ad39c…` | Arquivo anual, 194 registros, R$ 209.337,46. **Órfã**: produzida por uma versão anterior do cálculo do identificador. |
| `8eb3b85c…` | `9d9bdb37…` | Arquivo anual, mesmo conteúdo. Versão ativa. |

Conferência de 04/11/2026 pelas rotas do servidor: as duas versões do arquivo anual têm o mesmo SHA-256 do CSV (`012b0bb6…`; o ZIP difere), 194 registros, soma idêntica e registros iguais campo a campo, exceto o horário de captura. `1fc35649…` não foi apagada; fica registrada aqui como duplicata substituída por `8eb3b85c…`. A próxima coleta, já com o identificador por conteúdo, criará uma nova versão para o mesmo conteúdo, porque a fórmula mudou; as duas anteriores continuam no banco como histórico.

## Retomada e evidência

Cada execução tem `data/runs/<run-id>/manifest.json`, respostas JSON originais, metadados, dois ZIPs anuais e eventuais relatórios de falha. Os arquivos brutos podem conter identificadores pessoais e **não são versionados nem servidos pelo site**.

Para retomar uma execução, com o servidor encerrado:

```sh
npm run collect -- --resume ID-DA-EXECUCAO
```

Páginas de API com hash válido podem ser reaproveitadas por até uma hora; arquivos anuais são baixados novamente. Cache adulterado ou expirado é descartado. Cada registro público aponta para o arquivo original, hash do CSV e posição da linha sem o cabeçalho, começando em zero. O comprovante é um link informado pela fonte, não uma auditoria do documento.

## Testes e conferência independente

```sh
npm run typecheck
npm test
```

Com o servidor desligado:

```sh
npm run verify:annual
npm run verify:api-annual
```

Com o servidor ativo:

```sh
npm run verify:browser
```

`verify:annual` é uma releitura do **mesmo** arquivo da versão, a cópia guardada em `data/runs/<execução>/` (o hash do CSV precisa coincidir), por outro parser. Registros só da API são procurados, com o valor, nas páginas preservadas da mesma execução. A releitura compara com os registros gravados no banco, com o servidor desligado. O resultado fica guardado por versão: o site só serve versões com conferência aprovada, e uma versão nova fica privada até lá, enquanto a anterior aprovada continua no ar. Verifica a cadeia de processamento; não compara com a API nem prova que a fonte esteja completa. O verificador percorreu 209.081 linhas, selecionou 194 e reconciliou **37 grupos de pessoa/mês/categoria**, além da multiplicidade de documentos/valores, sem divergências. Dois registros tinham campos documento/glosa vazios; isso foi mantido explícito. Restituições no recorte do arquivo somaram zero nesta captura.

Os testes de backend cobrem precisão, valores negativos, campos ausentes, identidade, homônimos, duplicatas, paginação incompleta/repetida, tentativas, checkpoints adulterados, instabilidade, idempotência, rollback e revisões. Os testes de navegador cobrem pessoa → mês → categoria → fornecedor → registro, CSV, link com versão, filtros inválidos, bloqueio de arquivos brutos e layouts de 390/768/1360 px.

Playwright é uma dependência de verificação opcional, separada do runtime. Para instalá-la localmente: `npm install --no-save playwright` e `npx playwright install chromium`. No ambiente atual, o script também encontra a instalação global do Windows.

Relatórios e screenshots ficam em `output/qa/`, ignorado pelo Git. Se a reconciliação independente sinalizar falha para a versão consultada, a API retém seus números até revisão. Uma versão sem relatório externo não é rotulada como tendo passado nessa conferência.

## Interface e fontes

- `manifest.json`: publicação atual, com versão, cobertura e data de cada domínio.
- `data/<publicacao>/index.json`: recorte, pessoas, conferências e deputados sem dados.
- `data/<publicacao>/deputados/<id>/despesas.json` e `.csv`: registros de cada deputado, com IDs e proveniência.
- Retratos oficiais preservados em `real/portraits/`; origem e data em `sources.json`. `npm run cache:portraits` atualiza as imagens com o servidor ativo.
- [Arquivo anual oficial](https://www.camara.leg.br/cotas/Ano-2025.csv.zip) (o ano vem de `config/pilot.json`)
- [Significado dos campos CEAP](https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html)
- [Contrato da API](https://dadosabertos.camara.leg.br/api/v2/api-docs)

## Limites e próximos passos

Este é um piloto local, sem hospedagem, agendamento diário instalado, alertas externos, IA, ranking nacional ou cálculo por tempo em exercício. O adaptador para PostgreSQL externo está escrito, mas só o engine PostgreSQL local foi executado nesta entrega.

A coleta agendada, o banco cifrado no R2 e o site estático estão descritos no [README principal](../README.md). Próximo passo: ampliar o laboratório de casos reais; validar exercício e política temporal; depois expandir a população e os períodos e levar o desenho editorial (tag `mvp-final`) aos dados reais.
