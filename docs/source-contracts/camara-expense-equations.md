# Parcelas, documentos divididos e projeções SIGEPA

Continuação da [carga intermediária](camara-expense-intermediate.md). Todas as regras abaixo explicam registros já existentes e preservam seus valores líquidos originais. Nenhuma altera um valor, rateia dinheiro, deduplica uma ocorrência ou aprova a legitimidade de uma despesa.

## Evidências oficiais e interpretação

A [documentação oficial da CEAP](https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html) distingue valor de face, líquido, parcela, competência, trecho e restituição. Também esclarece que o identificador do documento pode aparecer em mais de um registro e não identifica sozinho uma ocorrência.

O texto geral sobre líquido e glosa não descreve todos os desdobramentos observados nos originais. As regras de conferência abaixo são decisões explícitas do Clareia, baseadas nos campos e na consistência entre as capturas; não representam uma afirmação de que a Câmara documentou cada combinação ou que o documento foi legalmente auditado.

Os normalizadores antigos continuam estritos por padrão. A carga intermediária só recebe uma exceção à equação quando o resolvedor e o auditor conseguem correlacionar as duas fontes com as condições contratadas. O registro recebe `financialBasis`; o relatório guarda a versão da regra e as referências das evidências.

## Parcela reportada e corroborada

`reported-installment` exige:

1. Identidade Câmara, ano, competência, documento não vazio/não zero, categoria, número, emissão, lote, face, glosa, líquido e parcela coincidentes no anual e na API.
2. Exatamente uma ocorrência correspondente em cada fonte. Multiplicidade ambígua não produz autorização.
3. Parcela inteira positiva nas duas fontes. Face/glosa/líquido conhecidos e não negativos; líquido inferior ao disponível do documento depois da glosa.
4. Estabilidade dos anuais e dos dois passes da API antes da resolução.

O líquido é o informado no registro. Não completar o documento com saldo inventado, presumir pagamento futuro, levar valor para outro mês ou recalcular restituição.

## Documento dividido que fecha em centavos

`balanced-document-split` só se aplica em um escopo anual completo. Exige um grupo por ID Câmara/ano/documento com pelo menos duas ocorrências, todas presentes uma a uma nas duas fontes, sem quantidades ambíguas, membros inválidos ou valores desconhecidos. Há um único valor de face e uma única glosa; os líquidos não negativos somam exatamente face menos glosa em `BigInt`.

As competências e categorias de cada ocorrência ficam como a fonte informou. Um documento de R$ 100 com líquidos de R$ 40 em janeiro e R$ 60 em fevereiro permanece 40/60; o sistema não cobra R$ 100 em cada mês nem inventa essa divisão. O fechamento do grupo é evidência de consistência, não uma nova fórmula para criar valores.

O relatório guarda os identificadores das linhas de todo o grupo. Uma linha cujo caso já é explicado por parcela continua identificada como parcela. Uma fonte sem contraparte, um grupo que não fecha, um mês de API incompleto ou um ano parcial impedem a explicação por grupo.

## Linhas iguais na API com trechos distintos no anual

A projeção SIGEPA da API não inclui todos os campos do anual. Para um grupo de N linhas API integralmente iguais, a regra `camara.ceap.sigepa-annual-routes.v1` exige:

- Categoria exatamente PASSAGEM AÉREA - SIGEPA, documento utilizável e os mesmos campos financeiros/cadastrais de correlação nas duas fontes.
- Exatamente N linhas no anual, com referências diferentes, iguais em todos os campos exceto `txtTrecho`.
- N trechos preenchidos e distintos, ignorando somente diferenças de espaço e caixa. Mudança cosmética não distingue ocorrência.
- As N posições da API preservadas, com mesmo multiconjunto nos passes de 100/25 itens; sem duplicação de referência.

Os N registros são preservados e pareados com os N do anual. Não viram N+N e não são reduzidos a um. Os identificadores normalizados vêm das linhas anuais distintas. Nomes de passageiros e trechos não são copiados para o relatório: ele registra quantidade e referências por hash.

Se o anual não trouxer esses N trechos, a quantidade divergir, outro campo anual diferir ou a categoria for outra, esta regra não explica a repetição. Ela continua retida, salvo corroboração pelo [contrato separado do relatório SIGEPA](camara-cota-portal.md). Isso não prova cobrança indevida nem autoriza apagar a linha.

## Implementação e auditoria

`expense-equations.ts` deriva as permissões a partir dos originais preservados. As permissões se vinculam a tipo de fonte, ID oficial, URL, hash e posição da linha. `expense-equations-audit.ts` implementa separadamente projeção, decimais, correlação, equações e distinção de trechos; compartilha tipos e infraestrutura de hash, sem chamar o resolvedor de produção.

A auditoria financeira relê todos os originais, recalcula as permissões/decisões e confere os registros e suas bases. Alterar a base de um registro, uma referência, o número de trechos ou a quantidade causa falha. Nenhum ledger fornecido pelo relatório autoriza sozinho uma exceção.

Mesmos comandos da carga intermediária. Para reprocessar sem rede:

```sh
npm run collect:expenses:intermediate -- --local --selection-run legacy-20261108 --run expenses-2025-intermediate-20261108 --workers 2 --offline
npm run verify:expenses:intermediate -- --local --run expenses-2025-intermediate-20261108
```

O relatório ganha nova versão de conteúdo; os relatórios anteriores ficam preservados por hash. Isso é revisão de regra sobre originais fixados, não atualização silenciosa da origem nem mudança na publicação ativa.

## Resultado observado em 08/11/2026

- Sete documentos com parcelas corroboradas e três grupos fechados de documentos divididos explicam as dez competências antes retidas por normalização financeira. Um desses grupos passa por uma competência que também tinha repetição SIGEPA.
- Dez decisões de multiplicidade explicam repetições API com trechos anuais distintos, sem remover ocorrências.
- Carga intermediária: 157 competências conciliadas, 32 sem despesas nas fontes capturadas, três retidas; 13.498 registros normalizados nas competências conciliadas.
- Pendências: ID 66385 em agosto/2025, ID 220553 em setembro/2025 e ID 178929 em setembro/2025. São quatro grupos de linhas SIGEPA idênticas sem contraparte anual suficiente para a regra de trechos. Continuam sem valor aprovado nessa competência.
- Reprocessamento sem rede, 924 capturas reaproveitadas. Auditoria independente aprovada; total geral continua indisponível e `publicationEligible=false`.
- Typecheck e 173 testes aprovados, incluindo grupos que não fecham, fonte única, outra pessoa, parcelas divergentes, contagens diferentes, diferença cosmética de trecho, adulteração das evidências e preservação de competência/centavos.

Esse foi o resultado anterior à corroboração adicional. O [incremento do relatório analítico oficial](camara-cota-portal.md) conferiu os três casos restantes em dois passes, preservando também os estornos. O resultado seguinte é de 160 competências conciliadas e 32 sem despesas nas fontes capturadas; a publicação permanece desativada.
