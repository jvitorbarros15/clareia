# Histórico individual e competências mensais

Incremento posterior à [descoberta do universo](camara-people-discovery.md). Produz dados para revisão; nenhuma atribuição histórica é ligada ao site ou publicada automaticamente.

## Executar

Depois de uma descoberta com auditoria correspondente aprovada:

```sh
npm run collect:people -- --local --discovery-run discovery-20261107 --run history-20261107 --workers 2
npm run resolve:people -- --local --run history-20261107 --discovery-run discovery-20261107
```

Sem `--local`, a chave vem de `CLAREIA_VAULT_KEY`. O modo local reutiliza a chave privada da descoberta e exige que ela exista. Originais ficam cifrados em `data/private/people-history/<run>/pass-1/` e `pass-2/`. Nunca copiar essas pastas ou chaves para o site.

A coleta aceita de um a três trabalhadores, dois por padrão, e limita a frequência entre pessoas. Primeiro coleta o cadastro e o histórico de todos os candidatos; depois consulta novamente todos os históricos. Comparar as duas listas preserva multiplicidades e os campos usados, aceitando mudança apenas na ordem da resposta. Igualdade não prova ausência de erros na origem.

Repetir o mesmo `--run` retoma capturas imutáveis, sem consultar novamente recursos já preservados. Para verificar uma atualização, iniciar outra execução. O manifesto guarda a execução e o hash da descoberta aprovada; se a descoberta tiver uma versão mais recente, a retomada lê a versão aprovada preservada pelo hash. Uma descoberta diferente não pode sobrescrever o manifesto existente. Execuções antigas sem o campo de origem precisam de `--discovery-run` também na resolução.

O resolvedor adquire `running.lock` antes de ler manifesto e histórico, para não misturar arquivos de uma coleta concorrente. Uma queda abrupta pode deixar o lock; conferir que não há processo ativo antes de removê-lo manualmente.

Os originais são cifrados antes de gravar. O relatório usa só nome/foto cadastrais e campos permitidos dos eventos; CPF, email e outros campos não entram. Antes de gravar o relatório em texto, há scan de identificadores conhecidos e CPFs formatados. Erros de parser ou corpos da fonte não são copiados para o log.

## Contratos

- [OpenAPI da Câmara](https://dadosabertos.camara.leg.br/api/v2/api-docs): histórico descrito como mudanças no exercício parlamentar; campos e ausência de paginação verificados na coleta.
- `/legislaturas/{id}`: fornece os limites oficiais de datas. Intervalo solicitado precisa ficar dentro da legislatura contratada; datas inválidas são recusadas.
- `/referencias/deputados/codSituacao`: catálogo oficial de situações de exercício. Novos valores não são convertidos automaticamente para exercício ou afastamento.
- `/deputados/{id}`: nome/foto são atributos da consulta atual, não históricos. ID da resposta deve ser o solicitado.
- `/deputados/{id}/historico`: manter todos os eventos e a posição original; partido atual do cadastro nunca preenche lacuna histórica.

O relatório mantém `dateMeaning: reported-change-not-independently-confirmed`. `dataHora` é usada apenas como data/hora da mudança reportada, sem afirmar que corresponde à vigência jurídica, ao início exato do direito à cota ou a presença em votação. Essa semântica ainda precisa de revisão antes da publicação.

## Regras de resolução

1. Datas civis permanecem no calendário da fonte, sem conversão implícita de fuso. Formato com minuto ou segundo é validado e sua precisão original preservada. Data incompleta ou inválida não vira meia-noite por suposição.
2. Intervalos internos são `[início, fim)`, limitados ao corte contratado. Não retroprojetar a primeira situação nem extrapolar o último evento para além do corte.
3. Eventos de outras legislaturas permanecem na evidência, mas não alimentam a linha temporal da legislatura selecionada. Um evento selecionado com data fora dos limites ou inválida retém a derivação da pessoa para revisão.
4. Eventos simultâneos não são desempates por ordem de resposta. Partido, UF e exercício são avaliados separadamente; conflito ou lacuna numa dimensão não inventa valor na outra.
5. `Exercício` indica exercício reportado. Licença, afastamento, suplência, suspensão, vacância e fim do mandato são estados distintos de fora de exercício reportado. `FIM_MANDATO` é um alias explícito do estado oficial. Condição eleitoral “Suplente” não substitui situação de exercício.
6. `Convocado`, situação ausente e novos valores ficam desconhecidos. A descrição textual de “entrada” não é usada para transformar automaticamente `Convocado` em exercício.
7. A competência financeira segue ano/mês, não data da nota. Partido/UF mensais dependem dos intervalos relevantes de exercício; janela de exercício desconhecida não é descartada para fabricar uma atribuição única.
8. Mudança intramês mantém o conjunto de siglas observadas e deixa o valor mensal sem atribuição única. Não escolher primeiro/último dia nem ratear. Mudança na fronteira de meses segue a marca temporal reportada.
9. Competência sem exercício confirmado não é zero gasto. O estado financeiro continua `not-collected`; eventual registro de despesa fora do exercício abre revisão, sem descarte ou acusação.
10. Meses cortados no início/fim do escopo têm `partialScope`. “Full” significa a janela observada naquele mês, não necessariamente todo o mês de calendário. Nenhuma média por dia de exercício é calculada.

## Conferência independente

`src/people-temporal-audit.ts` lê e verifica os originais cifrados. Não chama o normalizador de históricos, o resolvedor de intervalos ou o agregador mensal de produção. Confere:

- Identidade, cadastro, origem e hashes dos recursos.
- Universo e escopo contra a descoberta aprovada de entrada; remover a mesma pessoa do histórico e da derivação não pode fabricar cobertura completa.
- Estabilidade dos campos usados entre os dois passes, com multiplicidade preservada.
- Eventos normalizados contra os campos originais e posições.
- Limites da legislatura, intervalos, valores e linhas de evidência.
- Classificação mensal de exercício, partido e UF, cobertura e meses parciais.
- Versão exata do histórico consumido, universo de pessoas e identificadores pessoais.
- Estado obrigatório de revisão e atribuição pública desativada.

O resultado automático aprovado confirma a derivação segundo essas regras. Não resolve a suficiência do histórico, não confirma vigência jurídica e não substitui a revisão independente dos casos difíceis. Não cria uma versão ativa do domínio pessoas.

## Resultados observados em 07/11/2026

Execução local `history-20261107`, descoberta `discovery-20261107`:

- 648 pessoas coletadas em dois passes; 648 históricos estáveis nos campos usados, zero falhas e zero mudanças entre passes.
- 14.904 competências pessoa/mês, de janeiro de 2025 a novembro parcial de 2026.
- Exercício: 11.445 janelas completas, 222 parciais, 2.419 fora de exercício e 818 desconhecidas, conforme a regra reportada.
- Partido: 11.513 com uma sigla, 162 com mudança, 2.419 não aplicáveis e 810 desconhecidas.
- UF: 11.667 com valor único, 2.419 não aplicáveis e 818 desconhecidas.
- Oito pessoas tinham nove eventos da legislatura selecionada com datas fora dos limites; suas derivações ficaram retidas como desconhecidas.
- Em 311 pessoas havia algum evento de legislatura posterior datado antes do corte. Esses eventos não foram reatribuídos à legislatura 57.
- Exemplo ID 160976: PL em janeiro de 2025, PL/PSD sem atribuição única em novembro e PSD em dezembro; UF SP permanece consistente.

As contagens descrevem dados preparados para revisão, não cobertura financeira aprovada ou rankings públicos. Campos e siglas são os reportados pela Câmara; mudanças de sigla não são interpretadas automaticamente como mudança de identidade jurídica de partido.

## Fonte adicional identificada na investigação

A [documentação oficial antiga](https://www2.camara.leg.br/transparencia/dados-abertos/dados-abertos-legislativo/webservices/deputados/obterDetalhesDeputado) descreve `periodosExercicio` e `filiacoesPartidarias`. Um teste de disponibilidade encontrou resposta em XML no recurso `https://www.camara.leg.br/SitCamaraWS/Deputados.asmx/ObterDetalhesDeputado` com `ideCadastro` e `numLegislatura`.

Na inspeção de três pessoas, surgiram períodos explícitos que podem ajudar nas lacunas. Para o ID 160976, a data da troca coincide em 13/11/2025, mas o horário legado observado é 09:11:00 e o histórico v2 informa 09:00. Para o ID 74095, há períodos explícitos no legado onde a sequência v2 inclui `CONVOCADO` por longo intervalo.

Essa sondagem levou ao [conector e cruzamento para revisão](camara-people-legacy.md), implementado no incremento seguinte. Ele preserva XML cifrados em dois passes e audita as comparações. Não substitui eventos nem preenche lacunas; datas de fronteira, fins abertos e classificações não contratadas permanecem limitados explicitamente.

## Arquivos e verificações

Na pasta privada da execução: `history.json`, `temporal.json`, `temporal-audit.json`, `run.json`, originais cifrados e relatórios por hash em `reports/`.

```sh
npm run typecheck
node --import tsx --test tests/people-history.test.ts tests/people-temporal.test.ts
npm test
```

Os testes negativos alteram eventos, partido mensal, linhas de evidência e cobertura para exigir falha da auditoria. Incluem remover uma pessoa dos dois relatórios ao mesmo tempo, auditoria ausente da descoberta arquivada e leitura com execução concorrente bloqueada. Outros casos cobrem datas impossíveis, histórico ausente, mudança intramês, fronteira de mês, licença, suplência, retorno, estados desconhecidos, precisão insuficiente, identificador pessoal em texto e retomada com outro escopo.
