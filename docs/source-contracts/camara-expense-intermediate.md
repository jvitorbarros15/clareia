# Despesas CEAP — carga intermediária anual

Primeiro incremento da etapa 2. Coleta e audita despesas de 2025 para a seleção intermediária, mantendo o piloto servido pelo site. Nenhum comando deste incremento abre o banco ativo, gera `dist/`, muda o manifesto do site ou aprova uma publicação.

## Entradas e escopo

```sh
npm run collect:expenses:intermediate -- --local --selection-run legacy-20261108 --run expenses-2025-intermediate-20261108 --workers 2
npm run verify:expenses:intermediate -- --local --run expenses-2025-intermediate-20261108
```

A seleção precisa ter 12–20 pessoas, critérios cobertos, cruzamento auditado correspondente e proposta reproduzível. O comando relê a descoberta aprovada e recalcula a seleção antes de fixar as entradas. Guarda o hash da proposta e a versão temporal usada. Locks protegem entrada e execução; outra seleção não sobrescreve uma execução existente.

O escopo do coletor suporta um ano, IDs e meses explícitos, sem exigir três pessoas/dois meses ou assumir 513 pessoas. Pessoas, meses e legislatura têm validação; só aceita meses encerrados. O comando intermediário permanece limitado à amostra. Um novo ano será uma composição explícita de versões, não uma troca silenciosa do ano do piloto.

A versão temporal pode conter desconhecido, conflito e troca intramês. Esses estados são copiados para cada competência, sem atribuição inventada. A permissão do plano para coletar despesas com limitações temporais não libera agrupamentos históricos, médias por exercício ou rankings nacionais.

## Captura e conferência

- Verifica e preserva o contrato OpenAPI de `/deputados/{id}/despesas`.
- Primeiro anual antes das consultas da API; segundo anual depois. Compara o multiconjunto das linhas anuais de todo o escopo. A estabilidade financeira não depende de os bytes do ZIP repactado serem iguais.
- Dois passes de API, com páginas de 100 e 25 itens. Percorre todos os IDs/meses, preserva cada página cifrada, verifica recorte, sequência, repetição, links e prova de término. Falhas não interrompem as demais competências nem fabricam um zero.
- O link `self`, quando fornecido, deve identificar a mesma página/competência solicitada; uma resposta vazia de outro recorte é retida, mesmo sem registros para validar a identidade pelo conteúdo.
- Para página terminal cheia sem prova, exige uma página seguinte vazia preservada. O comportamento observado de `next` redundante depois da última página cheia só é aceito quando a última página declarada corresponde exatamente à anterior e sua sucessora é vazia. Página vazia em outra posição, recorte alterado ou dados depois de uma falsa indicação de término retêm o caso.
- Mantém a regra de união aprovada no piloto: somente TELEFONIA e COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA podem ficar apenas no anual; somente PASSAGEM AÉREA - SIGEPA pode ficar apenas na API. Novas exceções não são aceitas automaticamente.
- Compara ocorrências por identidade oficial/competência/documento/categoria/centavos, preservando multiplicidade; confere número, emissão e lote dos pares. Linhas integralmente idênticas sem evidência que distinga suas ocorrências continuam retidas, sem deduplicação automática. O incremento seguinte acrescenta [corroboração restrita de trechos SIGEPA](camara-expense-equations.md).
- Usa normalização estrita por padrão: negativos e campos desconhecidos são preservados. O incremento seguinte explica parcelas corroboradas e grupos de documentos divididos segundo um [contrato próprio](camara-expense-equations.md), sem alterar os líquidos originais. Equação não explicada continua retida. Não subtrai restituição novamente nem soma valores de face de documentos para substituir o líquido.
- Montantes são inteiros em centavos, com acumulação independente em `BigInt` e limites de precisão. Sem total geral quando qualquer competência estiver retida ou sem fonte completa.

Originais anuais/API são cifrados antes de gravar. Relatórios incluem apenas registros normalizados permitidos. O scan guarda hashes dos CPFs de fornecedores e parlamentares encontrados nos originais, incluindo linhas fora da seleção; a saída não contém esses identificadores. Colunas CSV duplicadas são recusadas.

## Estados de cobertura

| Estado financeiro | Significado |
| --- | --- |
| `complete` | Fontes estáveis, registros normalizados e união conciliada para a competência capturada |
| `no-expenses-confirmed` | Dois passes completos da API e dois anuais estáveis não contêm registros no recorte |
| `held-review` | Fonte mudou, ocorrência ambígua, problema financeiro ou união sem regra aprovada |
| `source-failure` | Não foi possível provar leitura completa de algum passe da API |

O estado financeiro é separado de exercício, partido e UF. Uma pessoa com exercício desconhecido pode ter uma competência financeiramente vazia nas fontes capturadas; isso não confirma seu mandato. “Sem despesas” descreve essas fontes e esse recorte, não salários, emendas, gabinete ou todo o gasto público relacionado à pessoa.

Relatórios sempre têm `status: review-required` e `publicationEligible: false`. Aprovar a aritmética do relatório não libera os casos retidos.

## Auditoria independente e retomada

`expense-intermediate-audit.ts` relê os originais cifrados. Não chama paginação, normalizadores, digest de estabilidade ou união de produção. Reimplementa leitura, decimais, projeção pública, pareamento e estados; confere valores, evidência por posição, multiplicidade, cobertura temporal e a totalidade das competências contra a entrada fixada. Também verifica scan de identificadores e referências sem uso.

O relatório completo tem hash de evidência; `contentSha256` identifica o conteúdo lógico, ignorando relógio, métricas e ordem concorrente da lista de fontes. Retomar a mesma captura não duplica registros ou muda a versão lógica. Isso não substitui as versões de publicação do banco, que serão integradas depois da aprovação de cobertura.

Adicionar `--offline` ao comando de coleta reaproveita os originais sem rede. Em uma retomada normal, recursos já preservados também são imutáveis; capturas faltantes podem ser completadas. Para verificar atualização, iniciar outro `--run`. A primeira medição operacional fica em `run.json/firstAttempt`, mesmo após reprocessamentos.

## Execução inicial observada em 08/11/2026

Execução `expenses-2025-intermediate-20261108`: 16 pessoas, janeiro–dezembro de 2025, 192 competências.

| Resultado | Contagem |
| --- | --- |
| Competências conciliadas | 137 |
| Sem despesas nas fontes capturadas | 32 |
| Retidas para revisão | 23 |
| Falhas de fonte após revisão da prova de término | 0 |
| Registros normalizados nas competências conciliadas | 11.812 |
| Originais cifrados | 924 |
| Total geral elegível | Não disponível |

Das 23 retenções, 13 têm ocorrências integralmente idênticas e 10 têm divergências na normalização financeira. Investigar esses grupos não autoriza concluir duplicação indevida, erro da Câmara ou irregularidade do parlamentar.

Primeira captura: 924 requisições, zero retries, 28.505.130 bytes de originais, 187.722 ms, pico de RSS de 400.160 KiB no processo. A amostra inclui pessoas com muitas linhas; não extrapolar o tempo linearmente para a Câmara inteira nem concluir que o job completo cabe no limite de 60 minutos. Reprocessamento real sem rede: 924 acertos de cache, zero requisições e mesmo `contentSha256`.

O `batch.json` privado tem cerca de 13,6 MB. Não serve como arquivo inicial da interface: ultrapassa o limite público atual de 10 MiB e inclui evidências detalhadas. Resumos estáticos e carregamento de detalhes por pessoa/período continuam obrigatórios antes da expansão do site.

## Pendências e próxima revisão

1. O [incremento de equações e trechos](camara-expense-equations.md) reduziu as 23 retenções a três. O [relatório analítico SIGEPA](camara-cota-portal.md), conferido em dois passes com todas as linhas e total mensal, corroborou as quatro repetições restantes. Resultado: 160 competências conciliadas, 32 sem despesas nas fontes capturadas, 13.827 registros; total candidato de R$ 7.068.295,62 para as 16 pessoas, publicação desativada. Os seis HTML adicionais ficam cifrados com os originais.
2. As dez competências antes retidas por equação foram explicadas por parcelas ou grupos de documentos divididos, com evidência entre fontes e regra auditada. Casos novos, restituições e equações fora dessas regras continuam exigindo revisão; nenhum valor é alterado para fechar a conta.
3. Fixtures de novas capturas demonstram retificação e retirada exclusiva da API com anual inalterado, retirada em ambas as fontes e retenção quando só um lado retira uma categoria que exige par. Um anual inteiro vazio é recusado. A coleta intermediária não usa o atalho anual `--if-changed` do piloto. Ainda faltam relatório de diferenças entre versões, política de revisão/aprovação e conferência SQL de publicação; os testes de coleta não substituem essa integração.
4. Concluir o domínio próprio de pessoas/cobertura, os resumos para o frontend e a leitura sob demanda, mantendo a referência de versão em cada publicação de despesas.
5. Só ampliar para todo o universo após revisão dos casos da carga intermediária. O aviso de amostra e a publicação atual continuam válidos.

Arquivos ignorados pelo Git em `data/private/expense-intermediate/<run>/`: `input.json`, `run.json`, `batch.json`, `audit.json`, originais cifrados em dois passes e relatórios por hash. Testes e logs em `output/qa/expense-intermediate-tests.log`, `output/qa/expense-intermediate-resume.log`.
