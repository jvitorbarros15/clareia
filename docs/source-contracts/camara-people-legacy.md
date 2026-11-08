# Cruzamento do histórico v2 com os períodos oficiais em XML

Este incremento prepara a revisão da etapa 1 e a seleção da carga intermediária de despesas. Não preenche lacunas do histórico v2 nem ativa atribuições de partido, UF ou exercício no site.

## Fontes e limites de interpretação

A [documentação oficial de ObterDetalhesDeputado](https://www2.camara.leg.br/transparencia/dados-abertos/dados-abertos-legislativo/webservices/deputados/obterDetalhesDeputado) descreve períodos de exercício e filiações por pessoa/legislatura. O GET utilizado é `https://www.camara.leg.br/SitCamaraWS/Deputados.asmx/ObterDetalhesDeputado?ideCadastro=ID&numLegislatura=57`. Apenas esse endereço HTTPS com exatamente dois parâmetros inteiros positivos está autorizado pelo conector.

O [contrato de período](https://www2.camara.leg.br/transparencia/dados-abertos/dados-abertos-legislativo/webservices/deputados/periodoExercicio) descreve datas de posse e término. Não define hora nem inclusão do dia final. A descrição da UF na tabela está incorreta (“Sigla do Partido”); o conector valida o valor contra as 27 UFs e preserva o nome do campo. A [documentação de filiação](https://www2.camara.leg.br/transparencia/dados-abertos/dados-abertos-legislativo/webservices/deputados/filiacaoPartidaria) distingue partidos anterior/posterior e data de filiação, sem resolver diferenças de horário com a v2.

Regras conservadoras da comparação:

- Usar somente o interior dos períodos para identificar sobreposição positiva com a competência. Dias de início/fim permanecem fronteiras não confirmadas. Não converter a precisão diária em um instante conhecido.
- Fim vazio permanece explicitamente aberto. A comparação registra `openEnd`; não declara exercício jurídico nem direito à cota.
- `Titular` e `Suplente` permitem comparar o período reportado como exercício. `Efetivado`, vazio e valores novos permanecem como texto na projeção, com `unconfirmed-exercise-kind`; competências afetadas ficam desconhecidas. Não classificar uma pessoa como falha de coleta só por esse valor.
- Não encontrar um período no XML produz `no-listed-period`, nunca ausência de mandato ou despesa zero.
- `corroborating-unknown` indica período reportado onde a v2 derivou exercício desconhecido. `potential-conflict` indica período reportado onde a v2 derivou fora de exercício. Nenhum dos dois altera automaticamente a derivação.
- Filiações são comparadas por dia e par anterior/posterior, com correspondência um a um e multiplicidades preservadas. Histórico v2 retido ou com data inválida não produz comparação nem filiação “só no legado”: recebe `partyComparisonStatus: unavailable`. Horários divergentes, precisão de minuto e transições sem correspondência têm estados próprios. Não desempatar pela ordem da resposta ou por partido cadastral atual.

## Executar e retomar

```sh
npm ci
npm run collect:people:legacy -- --local --discovery-run discovery-20261107 --history-run history-20261107 --run legacy-20261108 --workers 2
npm run verify:people:legacy -- --local --run legacy-20261108
```

É necessária uma descoberta auditada e um histórico com derivação temporal auditada. A execução guarda cópias das entradas e seus hashes sob lock, mantendo a referência da descoberta aprovada. Uma retomada usa essas cópias, mesmo que a pasta corrente do histórico tenha mudado; outra origem não sobrescreve a execução.

Dois passes separados guardam cada XML cifrado antes de escrever em disco. O relatório contém somente identidade oficial, períodos e filiações permitidos. O parser `fast-xml-parser` está fixado em `5.12.0`, com validação sintática, limite de tamanho, rejeição de DTD/entidades customizadas e erros sem corpos de resposta. As classificações novas são preservadas como incerteza; campos estruturais inesperados retêm a pessoa para revisão. Há scan de CPF antes da gravação dos relatórios.

Repetir o mesmo `--run` reutiliza originais imutáveis e verifica seus hashes; não representa atualização da fonte. Para reprocessar sem qualquer rede, acrescentar `--offline` ao comando de coleta. Originais faltantes em modo offline resultam em falha explícita; para uma nova captura usar outro nome de execução.

Arquivos em `data/private/people-legacy/<run>/` (ignorados pelo Git): entradas fixadas, `run.json`, `legacy.json`, `crosscheck.json`, `crosscheck-audit.json`, `intermediate-proposal.json`, versões por hash e pastas cifradas `pass-1/`, `pass-2/`. Chave local compartilhada com a descoberta; nunca copiar para a publicação.

## Auditoria e proposta intermediária

`people-legacy-audit.ts` compartilha apenas a fronteira de sintaxe XML. Relê os originais, projeta campos, converte datas e recalcula estabilidade/comparações por implementação separada; não chama os normalizadores ou comparadores de produção. Confere universo contra a descoberta, hashes de todas as entradas, multiplicidade, referências, estados e evidência mensal. Originais adulterados, pessoa removida de ambos os relatórios, resultado alterado ou atribuição pública ativada impedem aprovação.

Uma auditoria aprovada significa que o relatório descreve fielmente a comparação, inclusive suas pendências. Não libera publicação nem torna as duas fontes concordantes.

A proposta intermediária escolhe deterministicamente até 20 pessoas (16 na execução inicial). Conserva os IDs do piloto e seleciona casos de suplência, troca intramês, transição de exercício, divergência entre fontes, datas anômalas e pessoa/mês ausente no índice anual; completa com pessoas de maior volume de linhas anuais para medir paginação. Ausência no anual nunca é tratada como zero da API. Critérios sem candidato ficam em `unmetCriteria`. O resultado é sempre `proposed-not-approved`, com revisão pendente.

## Execução observada em 08/11/2026

O corte de entrada continua 01/01/2025–07/11/2026, legislatura 57. O dia da consulta não amplia esse corte.

- 648 pessoas, 1.296 XML cifrados, campos usados estáveis nos dois passes para todas; zero falhas e zero mudanças.
- 14.904 competências cruzadas. 243 têm período reportado que ajuda a investigar exercício desconhecido na v2; 18 têm possível conflito; 409 ficam indisponíveis para comparação conservadora por classificação de exercício não confirmada; 14.234 têm os demais estados, sem resolução automática.
- Nas 22 pessoas com classificação `Efetivado` ou vazia, a captura continua íntegra. As limitações são de interpretação e não viram ausência de dados ou zero financeiro.
- Filiações no corte, após a revisão de elegibilidade: 159 correspondências com mesmo dia/par, mas horário diferente; quatro transições apenas na v2; quatro apenas no legado. Oito pessoas ficam sem comparação partidária por histórico v2 retido. Isso não prova oito mudanças reais adicionais: exige revisão da cadeia histórica.
- Proposta intermediária com 16 pessoas e todos os critérios de seleção cobertos. O critério “ausente no anual” é alvo de teste, sem confirmação de despesa zero.
- Auditoria independente aprovada; `publicAttributionEnabled=false` em todos os relatórios. A publicação ativa continua com o piloto financeiro anterior.

Para concluir a etapa 1, ainda faltam a decisão documentada sobre suficiência das fontes e casos difíceis, a publicação própria de pessoas/cobertura e a revisão da seleção intermediária. Depois vêm a generalização do coletor financeiro e sua carga intermediária anual, conforme o roteiro local.
