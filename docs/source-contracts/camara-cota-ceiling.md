# Limite mensal da cota parlamentar por UF

Fonte para o denominador de "% do teto da cota usado". Estado: **coletor e auditor existem para 2024 e 2025; nada é publicado nem entra no ranking**. O relatório sai com `publicationEligible=false` até o dono aprovar a definição abaixo.

```sh
npm run collect:cota-ceiling -- --year 2025 --run ceiling-2025-AAAAMMDD [--offline]
```

Saída privada em `data/private/cota-ceiling/<run>/cota-ceiling-2025.json` (27 UFs x 12 meses = 324 linhas, valor em centavos inteiros, ato e URL em cada linha) e `audit.json`. Dois passes de captura com `curl` (o `fetch` do Node é interrompido pelo portal); os atos mudando entre passes recusam a execução.

## Fontes (todas oficiais, leitura sem autenticação)

| Papel | URL |
| --- | --- |
| Anexo Único vigente no texto atualizado do Ato da Mesa nº 43/2009 (tabela lida pelo coletor) | https://www2.camara.leg.br/legin/int/atomes/2009/atodamesa-43-21-maio-2009-588364-normaatualizada-cd-mesa.html |
| Ato da Mesa nº 270, de 19/1/2023: art. 4º troca a tabela, art. 7º fixa a vigência em 1º/2/2023 | https://www2.camara.leg.br/legin/int/atomes/2023/atodamesa-270-19-janeiro-2023-793708-publicacaooriginal-166895-cd-mesa.html |
| Anexo I do Ato 270 (PDF digitalizado, usado só para conferência manual; os 27 valores batem com o texto atualizado) | https://www2.camara.leg.br/legin/int/atomes/2023/atodamesa-270-19-janeiro-2023-793708-anexo-cd-mesa.pdf |
| Ato da Mesa nº 244, de 20/2/2026: recomposição pelo IPCA "entre fevereiro de 2023 e dezembro de 2025", em vigor na publicação | https://www2.camara.leg.br/legin/int/atomes/2026/atodamesa-244-20-fevereiro-2026-798720-publicacaooriginal-178157-cd-mesa.html |

O Ato 244 diz que a atualização acumula o IPCA "desde o último reajuste" (justificação), com base no parágrafo único do art. 16 do Ato 43 (acrescido pelo Ato 196/2025). Isso confirma que **entre 1º/2/2023 e 20/2/2026 o limite foi o do Anexo do Ato 270**. Não há tabela no Ato 244.

Não existe arquivo de dados abertos com o limite: a documentação CEAP de `dadosabertos.camara.leg.br` não o traz e a API de despesas só devolve gastos. A fonte é, portanto, o texto dos atos, não um conjunto de dados.

## Campos e regras de vigência

- Unidade: **limite mensal por deputado**, por UF (de representação). Não é anual.
- Vigência do Anexo do Ato 270: de **1º/2/2023** até a véspera do Ato 244 (**20/2/2026**). Meses de 2024 e 2025 estão inteiros nesse intervalo. O coletor recusa outros anos.
- 2025: todos os meses usam os valores abaixo. Nenhum ato posterior a 2023 altera a tabela antes de 2026 (confirmado pelo texto do Ato 244; não encontrei ato intermediário, mas não varri todo o Diário da Câmara).
- O texto atualizado do Ato 43 ainda mostra o anexo de 2023 mesmo depois do Ato 244 (não foi consolidado). O coletor falha se esse texto mudar (frases do ato e da vigência são conferidas); nesse caso, revisar à mão.

### Limite mensal por UF em 2025 (todos os meses)

| UF | R$ | UF | R$ | UF | R$ |
| --- | --- | --- | --- | --- | --- |
| AC | 50.426,26 | MA | 47.945,49 | RJ | 41.553,77 |
| AL | 46.737,90 | MG | 41.886,51 | RN | 48.525,79 |
| AM | 49.363,92 | MS | 46.336,64 | RO | 49.466,29 |
| AP | 49.168,58 | MT | 45.221,83 | RR | 51.406,33 |
| BA | 44.804,65 | PA | 48.021,25 | RS | 46.669,70 |
| CE | 48.245,57 | PB | 47.826,36 | SC | 45.671,58 |
| DF | 36.582,46 | PE | 47.470,60 | SE | 45.933,06 |
| ES | 43.217,71 | PI | 46.765,57 | SP | 42.837,33 |
| GO | 41.300,86 | PR | 44.665,66 | TO | 45.297,41 |

## Valores de 2026 (não coletados, só registro)

O portal da Câmara (`/transparencia/gastos-parlamentares`, "valor mensal atual da cota por UF") e a página "Exercícios do mandato" (`especial.camara.leg.br/posse2027/exercicios-do-mandato/`) mostram valores maiores (AC 57.359,87; DF 41.612,55; RR 58.474,70). A razão sobre o Anexo de 2023 é uniforme, 1,1375 (cálculo nosso, 27/27 UFs na página do portal), compatível com o IPCA do Ato 244. Mas:
- é o mesmo mapa com `?ano=2025` e sem ano: o portal mostra o valor "atual", não o do ano pedido; **não serve para 2025**;
- as duas páginas oficiais divergem em RO (52.267,09 na página de exercícios; 56.267,90 no portal, que é o coerente com 1,1375): a tabela de 2026 só tem texto oficial em tela, sem ato com tabela, e não foi confirmada;
- a data de efeito financeiro do Ato 244 (publicação, 20/2/2026) para janeiro e fevereiro de 2026 não está confirmada.

Antes de qualquer uso em 2026: obter o anexo do Ato 244 ou o texto atualizado do Ato 43.

## Histórico

- Antes de 2/2023: tabelas mais antigas existem (por exemplo o Ato da Mesa nº 76/2016 lista AC 44.632,46; não abri o ato) e a cadeia 2016-2023 não foi reconstruída. **Não confirmado**; não é necessário para 2025.
- 1º/2/2023 (Ato 270): tabela atual de 2025.
- 20/2/2026 (Ato 244): recomposição pelo IPCA; tabela só em tela.

## Saldo, acúmulo e efeito no "% usado"

Art. 13 do Ato 43: o saldo não usado **acumula-se ao longo do exercício financeiro** (ano civil) e **não passa para o ano seguinte**. O gasto que exceder o saldo disponível é descontado da remuneração (§2º). Consequências:
- Um mês pode legitimamente passar de 100% do limite mensal; o teto efetivo é cumulativo no ano. Por isso a definição usa a soma do período e nunca o percentual de um mês isolado.
- No ano inteiro, o máximo é 100% do limite anual cumulativo. Janeiro a dezembro somados é a leitura comparável entre deputados.
- A competência na API é a do gasto; reembolsos podem ser apresentados até 90 dias depois, então meses recentes ainda podem subir (o que o projeto já trata como retenção/parcial).

## Casos especiais que mudam o teto pessoal

Todos vêm do texto atualizado do Ato 43 (versão de 2026; a redação de 2025 de cada item **não foi verificada**, e o Ato 246/2026 mudou as alíneas dos líderes e o inciso VIII).
- **Adicionais por cargo (art. 1º §1º):** R$ 1.353,04 por mês (líder de partido/bloco/maioria/minoria/governo/oposição, vice-líder de partido ou bloco, presidente ou vice de comissão permanente, representante de partido com menos de 1/100 da Casa); R$ 902,02 (vice-líder da maioria/minoria/governo/oposição); R$ 5.075,62 (suplente de secretário da Mesa). Não se acumulam (§2º). O projeto **não tem lista de ocupantes desses cargos por mês**: sem ela o denominador desses deputados fica menor que o real em no máximo esses valores, e isso não pode ser estimado.
- **Missão do Parlamento do Mercosul (§3º do art. 1º):** adicional de 20% da menor cota mensal por viagem, creditado após lista da Mesa. Sem dado no projeto.
- **Trechos aéreos extras (art. 2º §3º, desde 1º/2/2023):** até quatro trechos ida e volta por mês até DF, "além da cota" do anexo. Esses gastos aparecem como passagem aérea na API e **não podem ser separados do restante**, então o numerador pode incluir despesa que não consome o limite do anexo. Não confirmado se o dado distingue.
- **Complemento do auxílio-moradia (até R$ 4.148,80):** compensado na cota; o art. 1º §5º do Ato 43 (texto do Ato 59/2015) fala em redução do limite. Efeito no dado da API não confirmado.
- **Limites internos por categoria** (combustível, locação de veículo etc.): não alteram o teto total.

## Mandato parcial, suplente, afastamento

- Art. 11: a cota de quem assume ou se afasta é **proporcional ao período de efetivo exercício no mês, contando o dia de assunção e o de afastamento**. A base do cálculo (30 dias ou dias reais do mês) **não é dita no texto**: não confirmado.
- Se a assunção e o afastamento caem no mesmo dia, o art. 11 §1º dá a parcela do dia a quem registrou presença; é um caso que o dado público não resolve.
- Licenciado nos casos do art. 11 §2º sem suplente convocado mantém a cota; com suplente convocado, o suplente recebe a proporcional e o titular não.
- Suplente em exercício tem o limite da UF de representação, proporcional aos dias. Usar a UF do mandato, não a de nascimento ou domicílio.
- Art. 12: o direito de uso vai só até o efetivo exercício, incluindo o dia da assunção e o do afastamento.

## Definição proposta de "% do teto da cota usado"

Para um deputado e um período (um ano, por exemplo):

> soma das despesas CEAP publicadas nos meses de exercício completo ÷ soma dos limites mensais da UF de representação nesses mesmos meses, vezes 100.

Regras:
1. **Meses de exercício completo** apenas, o mesmo critério de "mês de exercício" já usado (não `outside`, ou com despesa), mas o mês parcial (assunção ou afastamento no meio) **fica fora dos dois lados** enquanto a Câmara não confirmar a base da proporcionalidade do art. 11. A quantidade de meses excluídos aparece junto.
2. **Mês retido** (`held-review`) sai do numerador e do denominador.
3. O limite usado é o base do Anexo, na data do mês (2025: tabela acima). Sem limite confirmado para o mês, o resultado é "não confirmado", não zero nem estimativa.
4. Um deputado com mês de UF diferente usa o limite da UF de cada mês.
5. Comparável: mantém a regra atual (pelo menos 6 meses, nenhum retido); a mesma regra vale para o ranking por percentual.
6. Mostrar sempre o percentual ao lado do valor absoluto e da frase: "Pode passar de 100% em meses isolados; o saldo acumula no ano. Adicionais por cargo e missões não entram no limite usado."
7. Nunca ligar a projetos, votos ou presença, e não rotular como irregularidade.

## O que está confirmado e o que não está

Confirmado: valores de 2025 por UF; vigência 1º/2/2023 a 19/2/2026; limite mensal (não anual); acúmulo só dentro do exercício; proporcionalidade por dias no mês de entrada ou saída; valores dos adicionais no texto atualizado de 2026.

Não confirmado: base de dias do art. 11; redação de 2025 dos adicionais por cargo e quem os ocupou mês a mês; separação dos trechos aéreos extras no dado da API; a tabela de 2026 e sua data financeira; história anterior a 2023.

## Auditoria

`cota-ceiling-audit.ts` é uma segunda implementação (sem parser HTML, só texto achatado e padrão): relê o hash dos três originais, as frases dos atos, extrai o anexo de novo, exige as 27 UFs, o DF como menor valor, 324 linhas sem duplicata, valores iguais ao anexo, ato, vigência e URLs fixos, e meses dentro da vigência. Não valida a metodologia nem confirma a unidade de contagem; confirma só que o relatório reflete os atos capturados.
