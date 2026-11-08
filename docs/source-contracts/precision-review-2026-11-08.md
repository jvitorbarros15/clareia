# Correção após revisão externa — 08/11/2026

Esta revisão substitui as conclusões anteriores de fechamento da amostra. As etapas 1 e 2 continuam abertas. Não houve expansão do site, publicação SQL nova ou coleta nacional.

## Erro confirmado na regra de parcelas

O teste de documento de R$ 100 com duas parcelas de R$ 60 reproduziu o erro no coletor e no verificador separado: ambos autorizavam os R$ 120. Compartilhavam a mesma omissão de regra. As aprovações anteriores não constituíam validação independente da metodologia.

A regra `camara.ceap.correlated-net.v2` agora exige:

- Todos os membros observados do documento correlacionados um a um entre as fontes, com orçamento conhecido e consistente. Membro inválido, sem par, orçamento divergente ou negativo que exigiria interpretação de estorno retém o grupo.
- Soma dos líquidos de todas as ocorrências observadas, incluindo membros que não são parcelas, calculada **uma vez**, em `BigInt`, limitada a face menos glosa.
- Grupo acima do limite retido em todas as competências afetadas, inclusive quando cada parcela passa isoladamente pela equação estrita. Duas parcelas integrais de R$ 100 também não podem contornar o teto de um documento de R$ 100.
- Evidência `documentBudget` com teto, soma observada e referências de todos os membros; `equationHolds` e motivo explícito para grupos retidos. O relatório fornecido não autoriza sozinho a exceção.

É uma condição conservadora do Clareia, não uma afirmação de que toda semântica de parcelamento está confirmada pela Câmara. O limite é verificado no escopo capturado e pelo identificador de documento observado; não comprova que não existam parcelas fora desse escopo ou outros identificadores para a mesma comprovação. Essa dúvida foi incluída no rascunho de pedido à Câmara.

## Rechecagem dos sete documentos reais

Os sete continuam dentro do limite; nenhuma permissão mudou após a correção. Cada um tem **uma ocorrência** no recorte anual capturado, portanto essa amostra real não exercita múltiplas parcelas do mesmo documento. Os testes de regressão cobrem esse caso separadamente. A glosa observada é zero nos sete.

| ID Câmara | Hash do grupo (prefixo) | Face | Soma líquida observada |
| --- | --- | --- | --- |
| 160976 | `ddbba79cfcdb` | R$ 19.000,00 | R$ 18.543,70 |
| 163321 | `e602da285363` | R$ 329,03 | R$ 140,08 |
| 178857 | `f3bccf4ae8a9` | R$ 57,20 | R$ 41,23 |
| 178929 | `b3341f0f582e` | R$ 3.800,00 | R$ 3.199,23 |
| 204534 | `9534bd334cc8` | R$ 2.500,00 | R$ 311,55 |
| 73531 | `c6fbf1a83340` | R$ 5.000,00 | R$ 1.667,97 |
| 74065 | `70142d663b1b` | R$ 26.000,00 | R$ 21.324,30 |

Originais cifrados foram reprocessados sem rede. `output/qa/installment-real-review.json` registra versões de antes/depois e referências completas por hash. Nenhuma linha foi apagada, rateada ou corrigida para fechar a conta.

## SIGEPA: concordância não confirma unidade de soma

Trechos anuais distintos ou concordância com o portal oficial demonstram como a fonte apresenta as linhas. Não comprovam se cada valor é um débito distinto ou um total de bilhete repetido por trecho. A [documentação oficial](https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html) não esclarece suficientemente essa combinação para resolvermos a dúvida.

Por isso, `camara.ceap.sigepa-preserve-hold.v2` conserva os originais e as conferências de trechos/portal, mas mantém competências com essas repetições em `held-review`, motivo `sigepa-unit-unconfirmed`, sem registros normalizados nem total aprovado. `matched` no portal é concordância entre fontes, nunca autorização para somar. Não deduplicamos para fabricar um total alternativo.

São 14 grupos conhecidos em 13 competências: dez grupos corroborados por trechos anuais e quatro grupos em três competências corroborados no portal. “Três casos SIGEPA” era uma descrição imprecisa desses quatro últimos grupos. Confirmação oficial da unidade de contagem é requisito antes de liberar esses recortes ou ampliar ao universo nacional. O pedido foi apenas redigido; não enviado.

## Estado atual e limites da verificação

A amostra passa a **147 competências conciliadas segundo as regras implementadas, 32 sem despesas nas fontes capturadas e 13 retidas**, com 12.466 registros normalizados nas competências conciliadas. Total geral indisponível, `publicationEligible=false`. Os números anteriores de 160 competências/13.827 registros e R$ 7.068.295,62 ficam como histórico de regra superada, sem validade para liberação.

O verificador usa outra implementação para reler originais, centavos, cobertura e regras. Isso pode detectar divergências entre implementações e adulteração, mas **não constitui revisão independente das regras**, confirmação oficial da semântica ou prova de ausência de erro comum. O bug de parcelas mostrou esse limite concretamente. O texto do relatório agora explicita isso.

Versões antigas de equação/multiplicidade são recusadas na nova conferência, mesmo com hash lógico recalculado. Relatórios anteriores permanecem preservados; precisam de reprocessamento e nova revisão para qualquer uso futuro. A correção não declara as regras restantes cientificamente ou institucionalmente validadas.

A etapa 1 ainda depende da revisão histórica e do domínio próprio de pessoas/cobertura. A etapa 2 tem coleta experimental intermediária; não passou pelo gate de publicação nem corrige partido/UF da época no site. Não vamos apresentar as duas etapas como concluídas ou ampliar o universo enquanto essas condições estiverem pendentes.

Verificações após a correção: typecheck e 197 testes passaram; originais reais reprocessados sem rede e nova releitura aprovada sob as regras v2. A comparação real da versão consigo mesma mantém as 13 competências como não comparáveis e não fabrica um delta geral zero. Logs: `output/qa/installment-overflow-reproduction.log` (falhas antes da correção), `precision-full-tests.log`, `precision-real-audit.log`, `installment-final-review.log`, `precision-self-comparison.log` e `precision-summary.json`. “Aprovada” aqui confirma a execução conforme as regras e retenções descritas, com o limite metodológico acima.
