# Descoberta do universo histórico da Câmara

Implementação inicial de descoberta de identidades. Não publica exercício, filiações, despesas ou rankings. O plano de execução permanece fora do Git.

## Executar

```sh
npm run discover:people -- --local --run descoberta-2025-2026
```

O escopo está em `config/people-discovery.json`: legislatura, início, fim e IDs da amostra de contrato. A data de corte é explícita; ajustar exige uma nova execução, sem chamar ano parcial de completo.

`--local` cria/reutiliza uma chave de desenvolvimento em `data/private/people-discovery/local-vault-key`. Sem essa opção, a chave deve vir de `CLAREIA_VAULT_KEY`, no formato já usado pelo vault. A chave nunca é impressa. Não copiar a chave junto com os originais para hospedagem ou relatórios. Esta ferramenta não envia dados ao R2.

Originais de todos os recursos, incluindo cadastros e anuais, são cifrados com AES-GCM **antes** da gravação. URLs, hashes, tamanho e data ficam em metadados separados. Capturas e chave ficam na árvore privada ignorada pelo Git, sem tocar no banco ativo ou em `dist/`.

Para retomar, repetir o mesmo `--run` e o mesmo escopo. Capturas da execução são imutáveis e conferidas por hash. Uma coleta nova exige outro ID; retomar não significa consultar uma fonte atualizada. Há exclusão de execução concorrente. Se houver queda abrupta, verificar que não há processo usando a execução antes de remover manualmente seu `running.lock`; não há tomada automática de lock.

Saída em `data/private/people-discovery/<run>/`:

- `originals/`: respostas cifradas e metadados.
- `discovery.json`: conjuntos de IDs, multiplicidades, competências financeiras e pendências; só campos permitidos dos históricos amostrados.
- `audit.json`: conferência independente dos conjuntos, paginação e índices anuais, hash do relatório e scan de identificadores pessoais conhecidos. Não aprova semântica temporal nem valores financeiros.
- `reports/`: versões dos relatórios por hash, além do resultado mais recente.
- `run.json`: estado e cobertura da execução. Em falha, `failure.json` registra a fase sem copiar corpos da fonte ou erros de parser que possam conter dados pessoais.

## Contrato observado

Fonte: [OpenAPI oficial](https://dadosabertos.camara.leg.br/api/v2/api-docs), preservado por execução.

1. `/deputados`: filtros `dataInicio`, `dataFim`, `idLegislatura`; paginação por `pagina`/`itens`, com links `next`/`last`. A ferramenta coleta listas de intervalo, legislatura e combinação separadamente.
2. `/deputados/{id}`: a identidade retornada deve ser a solicitada. O corpo bruto é privado; campos adicionais como CPF não entram no relatório.
3. `/deputados/{id}/historico`: o contrato consultado não declara paginação. Preservar `dataHora`, legislatura, situação, condição, partido, UF e descrição. Se houver `next`/`last` ou o OpenAPI passar a declarar paginação, parar para revisar o contrato.
4. `/cotas/Ano-AAAA.csv.zip`: exigir o CSV do ano esperado e colunas `ideCadastro`, `numAno`, `numMes`, `codLegislatura`. Ler IDs e competências sem calcular valores. Linha com ID inválido/ausente gera pendência com posição, sem nome de fornecedor ou identificador pessoal.

Os meses das fronteiras do intervalo são inclusos na descoberta financeira, pois a competência é mensal. Isso não prova exercício durante todos os dias do mês. Eventos e fontes permanecem com datas originais; nenhuma atribuição histórica é derivada neste incremento.

## Resultados observados em 07/11/2026

Escopo 01/01/2025–07/11/2026, legislatura 57:

| Consulta | IDs distintos |
| --- | --- |
| Apenas intervalo | 605 |
| Apenas legislatura | 648 |
| Intervalo e legislatura combinados | 648 |
| Com registros no anual de 2025 | 562 |
| Com registros no anual de 2026 no recorte | 565 |

Esses resultados são datados, não constantes ou garantias de exercício. A combinação observada não produziu o mesmo conjunto da consulta só por intervalo; não tratá-la automaticamente como interseção. O conjunto de candidatos preserva a união das listas e dos IDs financeiros; a inclusão final no universo do período depende do histórico individual.

A lista histórica repete IDs com atributos partidários diferentes. A ferramenta preserva todas as linhas cifradas e registra a multiplicidade, mas conta cada identidade oficial uma vez. Isso é projeção de identidade, não deduplicação de despesas nem atribuição partidária.

Nos anuais capturados, 937 linhas de 2025 e 562 de 2026 não tinham ID pessoal válido. Elas ficam pendentes de classificação, sem ligação por nome e sem atribuição de dinheiro a pessoas. Não são divergências de legislatura. Todos os IDs financeiros válidos apareceram na lista por intervalo nessa captura.

Os três históricos amostrados vieram fora de ordem cronológica. No ID 204534, há um evento de legislatura 58 datado em 2023; foi sinalizado, sem correção inventada. No ID 160976, a troca PL → PSD aparece em 13/11/2025. O mês de novembro exigirá tratamento de ambiguidade conforme a regra de competência quando o resolvedor temporal for implementado.

## Limites da conferência

A auditoria relê os originais da própria execução, confirma seus hashes e calcula os conjuntos e índices sem chamar o parser, paginador ou comparador de produção. Confere também contagens e multiplicidades por pessoa/competência e a presença das páginas necessárias. O teste negativo altera os resultados para comprovar a detecção de divergência.

Uma captura por recurso não garante estabilidade da fonte. Esta ferramenta de descoberta não coleta todos os históricos individuais nem confirma a semântica de vigência de `dataHora`. A coleta posterior em dois passes e a resolução mensal estão no [contrato de históricos](camara-people-history.md). Um relatório com auditoria de descoberta aprovada continua com estado `discovery-only`, não se torna publicação do domínio pessoas e não libera ranking nacional.

## Verificação

```sh
npm run typecheck
node --import tsx --test tests/people-discovery.test.ts
npm test
```

Os testes incluem mais de 513 identidades, multiplicidade de cadastros históricos, mudança de recorte na paginação, páginas faltantes, vazios inesperados, IDs financeiros ausentes, criptografia, retomada, adulteração e vazamento de identificador conhecido em relatório.
