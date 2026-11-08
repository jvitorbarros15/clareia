# Relatório analítico oficial — corroboração de ocorrências SIGEPA

**Estado atual:** [a unidade de soma continua sem confirmação oficial](precision-review-2026-11-08.md). O portal permanece como evidência de concordância; as competências com repetições estão novamente retidas. Os resultados numéricos de fechamento ao fim deste arquivo são históricos e não autorizam publicação ou expansão.

Complementa a [carga intermediária](camara-expense-intermediate.md) e as [regras de equações e trechos](camara-expense-equations.md). Consulta somente de leitura, sem autenticação, na [busca oficial da cota](https://www.camara.leg.br/cota-parlamentar/).

## Quando consultar e como identificar a pessoa

O conector é acionado por `--portal`, somente quando restam linhas API integralmente iguais, todas SIGEPA, que a regra de trechos anuais não explica. A API precisa estar completa e estável nos dois passes; o anual também precisa estar estável. Não resolve repetições em outras categorias.

O parâmetro `nuDeputadoId` pertence ao portal e não é o `ideCadastro` usado pela API. A ligação vem exclusivamente das linhas anuais que já contêm o ID Câmara: um único `nuDeputadoId` positivo, com legislatura correspondente, igual nos dois anuais. Falta ou divergência deixa o caso indisponível. Não há ligação por nome. A distinção dos identificadores está na [documentação oficial CEAP](https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html).

GET permitido: `https://www.camara.leg.br/cota-parlamentar/analitico`, uma pessoa e uma competência `M/AAAA`, `despesa=998`. Os seis filtros de hóspede, passageiro, fornecedor, CNPJ/CPF, documento e UF precisam estar presentes e vazios. Parâmetros extras, repetidos, outro domínio, fragmento, credenciais ou outro recorte são recusados. Não é necessário enviar o formulário POST da busca.

## Contrato do HTML e conferência

Originais são cifrados antes de gravar, em dois passes distintos. `parse5` interpreta o HTML sem executar scripts ou buscar recursos. Limites: 12 MB, 100 mil nós e profundidade 200. Os cabeçalhos precisam corresponder exatamente aos dez rótulos oficiais; deve haver uma única tabela `tabela-2`, sem tabela aninhada.

Cada linha tem oito células, índice contínuo `analitico0…N`, um link de detalhe oficial e os seguintes campos conferidos: fornecedor por hash do identificador, documento fiscal por hash, número por hash, emissão, face, deduções e reembolso. O link deve repetir pessoa interna, competência, categoria, fornecedor e número exibidos. Documento fiscal aceita ID numérico ou UUID, formatos observados na fonte; não se presume que todo documento seja numérico. Nomes, CPF, passageiros e trechos não são copiados para a evidência normalizada.

- Valores em reais viram centavos inteiros; parênteses indicam negativos e são preservados. A soma assinada de todas as linhas precisa fechar exatamente com o único rodapé `totalFinalAnalitico`.
- Deduções em branco permanecem desconhecidas. Para comparar com uma API que informa glosa zero, é necessário que a face seja igual ao líquido; não se preenche o campo ausente da fonte com zero.
- Os dois relatórios devem ter o mesmo multiconjunto de linhas e total, ignorando apenas a ordem. Conferimos **todo o SIGEPA do mês**, incluindo estornos, e não apenas as linhas repetidas.
- O multiconjunto completo precisa coincidir um a um com a API em documento fiscal, número, fornecedor, emissão, face, deduções compatíveis e líquido, além da quantidade e do total. Total igual com linhas diferentes não basta.
- HTML ausente ou fora do contrato resulta em `unavailable`; passes diferentes, em `changed`; desacordo com a API, em `mismatch`. Nenhum desses estados libera a competência.

`matched` confirma somente que o portal apresenta o mesmo multiconjunto que a API. A política `camara.ceap.sigepa-preserve-hold.v2` mantém essas competências em `held-review` com motivo `sigepa-unit-unconfirmed`, sem registros normalizados ou total aprovado. Os originais repetidos continuam cifrados e preservados. O mecanismo anterior de gerar IDs/ordinais para normalizá-los não é mais usado para liberação. Não se soma portal + API nem se deduplica para criar um total alternativo.

O relatório analítico e a API são serviços da mesma Câmara e podem compartilhar o mesmo sistema de origem. Sua concordância não prova duas transações bancárias distintas, legalidade, cobertura externa ou ausência de erro na origem. A página de detalhe não serve como chave de ocorrência: várias linhas podem apontar para o mesmo documento e exibir apenas um desdobramento. A publicação deve explicar esse limite.

## Auditoria e retomada

`cota-portal-audit.ts` reimplementa ligação de IDs, leitura da tabela, moeda, projeção, comparação de multiconjuntos e totais; compartilha apenas tipos, hash e navegação sintática do DOM. A auditoria da carga confere as evidências, os valores, as referências utilizadas e a retenção. São duas implementações das mesmas regras do Clareia, não validação independente da metodologia ou confirmação institucional da unidade de contagem. Alterar o ledger do relatório não autoriza a soma.

```sh
npm run collect:expenses:intermediate -- --local --selection-run legacy-20261108 --run expenses-2025-intermediate-20261108 --workers 2 --portal
npm run verify:expenses:intermediate -- --local --run expenses-2025-intermediate-20261108
```

Uma vez ativado, `--portal` permanece ativo no manifesto das retomadas, inclusive com `--offline` sem repetir a opção. Originais existentes são imutáveis; para atualizar as fontes, usar novo `--run`. Relatórios anteriores permanecem preservados por hash. Não há acesso ao banco ativo, geração do site ou aprovação automática.

## Histórico real anterior à retenção semântica — superado para liberação

| ID Câmara / competência | ID interno do portal | Linhas SIGEPA conferidas | Reembolso líquido SIGEPA |
| --- | --- | --- | --- |
| 66385 / agosto de 2025 | 3692 | 40 | R$ 19.002,16 |
| 220553 / setembro de 2025 | 3677 | 14 | R$ 3.991,52 |
| 178929 / setembro de 2025 | 3043 | 3 | R$ 3.141,04 |

As três competências passaram na conferência, incluindo quatro grupos de repetição com oito linhas preservadas. Seis novos originais HTML cifrados, além dos 924 originais anteriores; 28.832.692 bytes ao todo. A seleção continua com 16 pessoas, não o universo nacional.

Resultado da carga: 160 competências conciliadas, 32 sem despesas nas fontes capturadas, nenhuma retenção ou falha financeira; 13.827 registros e total candidato de R$ 7.068.295,62. Auditoria independente aprovada, `publicationEligible=false`. Esse total descreve apenas esta seleção e estas fontes. Não virou ranking nem dado servido pela interface.

Typecheck e 183 testes passaram. Retomada real sem `--portal`, usando somente `--offline`: zero requisições, 930 originais reaproveitados, mesma versão lógica `0fc4912d137e36d27ba495e1c0f5edf9d4b1ab31bcb8866e0c98b186116b2594` e nova auditoria aprovada. Os testes incluem total igual com linhas divergentes, UUID, HTML inválido, troca de identidade, glosa ausente, adulteração de evidências/ordinais e atualização ou retirada exclusiva da API com anual inalterado.

Ainda faltam integração/versionamento SQL, publicação de pessoas/cobertura, política de revisão entre versões, resumos e detalhes sob demanda, expansão ao universo histórico e auditoria de publicação. Conferência aritmética desta amostra não conclui a etapa 2.
