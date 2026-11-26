# Despesas dos senadores (CEAPS), mandatos e teto por UF

Contrato das fontes oficiais do Senado para o [#56](https://github.com/jvitorbarros15/clareia/issues/56) (passo [#177](https://github.com/jvitorbarros15/clareia/issues/177)). **Estado: contrato e amostra; não há coletor, parser nem publicação.** Tudo abaixo foi lido em 26/11/2026 com `curl`, sem autenticação. Cada afirmação traz uma etiqueta:

- **observado**: visto por nós em arquivo ou resposta reais;
- **relatado**: lido em texto oficial ou de terceiros, não reproduzido nos dados;
- **NÃO VERIFICADO**: não consegui confirmar; não vale como regra.

Decisões do dono (26/11/2026), já valem para este contrato:

- **Fonte de registro: só a API de despesas** (`adm.senado.gov.br/adm-dadosabertos`, que serve 2008 a 2026). O pipeline **nunca baixa o CSV legado**; ele aparece aqui só como referência de comparação.
- **Anos coletados: 2023 a 2026**, os mesmos dos deputados.
- Os originais da API são guardados **cifrados**, porque trazem nome de pessoa física, cinco dígitos do CPF na máscara, **CPFs completos em texto livre** (`fornecedor`, `documento`, `detalhamento`; quirk 28) e nomes de passageiros.
- "% do teto": ver "Regras do '% do teto' para senadores" no fim da seção do teto.

Senadores têm ranking próprio e nunca são somados ou ordenados junto com deputados (#56). A CEAPS não é a cota da Câmara: o teto, o calendário e os campos são outros, e não se reaproveita a [definição de "% do teto" dos deputados](camara-cota-ceiling.md) sem decisão do dono.

## Fontes (leitura sem autenticação)

| Papel | URL | Resposta em 26/11/2026 |
| --- | --- | --- |
| CSV anual legado, um por ano, 2008 a 2026 (**referência; o pipeline não baixa**) | `https://www.senado.leg.br/transparencia/LAI/verba/despesa_ceaps_AAAA.csv` (o mesmo caminho em `www.senado.gov.br` responde 301 para `www.senado.leg.br`) | 200 para 2008-2026; 404 para 2006 e 2007; aceita `Range` (206) |
| **Fonte de registro:** API de dados abertos administrativos, JSON, 2008 a 2026 (200/206 em todos os 19 anos) | `https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/AAAA` | 200, `application/json;charset=UTF-8`; aceita `Range` (206) |
| Mesma API, CSV | `https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/AAAA/csv` | 200, `text/csv;charset=UTF-8` |
| Especificação OpenAPI da API acima (versão 2.3.6) | `https://adm.senado.gov.br/adm-dadosabertos/v3/api-docs` | 200 |
| Catálogo, grupo "Senadores" (descreve o conjunto CEAPS: "Sistema Cotas", atualização diária) | `https://www12.senado.leg.br/dados-abertos/conjuntos?portal=Administrativo&grupo=senadores` | 200 |
| API legislativa (mandatos, suplentes, exercício) | `https://legis.senado.leg.br/dadosabertos/` (OpenAPI 4.1.3.120 em `/dadosabertos/v3/api-docs`) | 200 |
| Ato do Primeiro-Secretário nº 5/2014 (texto compilado) | `https://www12.senado.leg.br/transparencia/leg/pdf/normas/APS-5-2014-compilado.pdf` | 200, PDF |
| Ato da Comissão Diretora nº 2/2023 (tabela do teto de 2023) | `https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14380751` | 200 |
| Ato do Presidente nº 8/2025 (tabela do teto de 2025) | `https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14383699` | 200 |
| Anexo do Ato do Presidente nº 8/2025 (PDF com a tabela) | `https://www.senado.leg.br/transparencia/SECRH/BASF/Anexo/A_01_2025_1761064.PDF` | 200, PDF |
| Tabela anterior a 2023, sem data no arquivo | `https://www12.senado.leg.br/transparencia/leg/pdf/CotaExercicioAtivParlamSenadores.pdf` | 200, PDF |

A página de transparência `https://www12.senado.leg.br/transparencia/dados-abertos-transparencia/dados-abertos-ceaps` responde 200, mas com a tela de login do portal (redirecionamento para `require_login`) **[observado]**. A página de catálogo acima aponta, para a CEAPS, só a documentação Swagger da API (CSV e Web Service), não o caminho `LAI/verba` **[observado]**; o caminho `LAI/verba` existe e é o usado pelos arquivos de todos os anos, mas o catálogo não o anuncia.

Os dois formatos (CSV legado e API) trazem as mesmas linhas: em 2019, 2024 e 2025 os conjuntos de `COD_DOCUMENTO` e `id` são idênticos (21.634, 21.453 e 23.866 registros) **[observado]**. Divergências: quirks 5, 13 e 17.

## CSV legado: formato

Referência apenas: o pipeline não baixa o CSV legado. **[observado]** em todos os 19 arquivos:

- Codificação **Windows-1252**, não UTF-8 e não ISO-8859-1 estrito: nenhum arquivo é UTF-8 válido, todos decodificam como cp1252, e há bytes na faixa `0x80`-`0x9F` em 2011-2020 e 2022-2026 (nos de 2008-2010 e 2021 não há). Em 2025 são 64 ocorrências, todas `0x96` (travessão), que em ISO-8859-1 seria caractere de controle.
- Separador `;`, todos os campos entre aspas duplas, fim de linha CRLF, sem BOM.
- **Linha 1 não é o cabeçalho:** `"ULTIMA ATUALIZACAO";"26/11/2026 02:02"` (2 campos). O cabeçalho está na linha 2.
- Cabeçalho (linha 2), 11 colunas: `"ANO";"MES";"SENADOR";"TIPO_DESPESA";"CNPJ_CPF";"FORNECEDOR";"DOCUMENTO";"DATA";"DETALHAMENTO";"VALOR_REEMBOLSADO";"COD_DOCUMENTO"`. Não se repete no meio do arquivo (0 linhas iguais ao cabeçalho em todos os anos).
- Carimbo da linha 1: 2008-2019 mostram `06/08/2021 02:0x` (arquivos que não mudam desde 2021); 2020-2026 mostram `26/11/2026 02:0x` (regerados à noite).

| Ano | Bytes | Registros | Ano | Bytes | Registros |
| --- | --- | --- | --- | --- | --- |
| 2008 | 437.714 | 2.449 | 2018 | 6.951.876 | 24.492 |
| 2009 | 3.370.591 | 16.480 | 2019 | 5.896.424 | 21.634 |
| 2010 | 3.771.610 | 18.235 | 2020 | 3.728.121 | 14.088 |
| 2011 | 5.578.887 | 25.574 | 2021 | 4.552.873 | 16.827 |
| 2012 | 6.740.856 | 30.175 | 2022 | 4.466.861 | 16.804 |
| 2013 | 7.830.956 | 29.376 | 2023 | 4.761.603 | 18.822 |
| 2014 | 6.272.586 | 22.002 | 2024 | 5.260.569 | 21.453 |
| 2015 | 7.466.156 | 26.056 | 2025 | 5.768.682 | 23.866 |
| 2016 | 7.611.002 | 26.768 | 2026 | 4.165.262 (meses 1 a 11; o 11 é parcial, 355 linhas) | 17.388 |
| 2017 | 7.610.055 | 27.023 | | | |

Registros contados com leitor CSV (campos entre aspas podem ter quebra de linha), não por linhas do arquivo. Nesses arquivos, as quebras de linha dentro de campos viram espaço. No CSV legado de 2025, o registro 2268296 é uma linha só; na API ele tem `\r\n` dentro do campo.

## API de despesas: formato

**Fonte de registro.** A API serve 2008 a 2026 (resposta 200/206 para os 19 anos em 26/11/2026); o formato abaixo foi lido em 2018, 2019, 2024 e 2025 **[observado]**. JSON: array de objetos, UTF-8, 23.866 objetos em 2025. Chaves (as 13 estão em todos os objetos):

| Chave JSON | Coluna no CSV da API | Tipo | Equivalente no CSV legado |
| --- | --- | --- | --- |
| `id` | `ID` | inteiro | `COD_DOCUMENTO` (idêntico nas 23.866 linhas de 2025) |
| `tipoDocumento` | `TIPO_DOCUMENTO` | texto | **só existe na API** |
| `ano` | `ANO` | inteiro | `ANO` |
| `mes` | `MÊS` (com acento) | inteiro | `MES` |
| `codSenador` | `COD_SENADOR` | inteiro | **só existe na API** (ver "Identificador") |
| `nomeSenador` | `NOME_SENADOR` | texto | `SENADOR` |
| `tipoDespesa` | `TIPO_DESPESA` | texto ou `null` | `TIPO_DESPESA` |
| `cpfCnpj` | `CPF_CNPJ_FORNECEDOR` | texto | `CNPJ_CPF` |
| `fornecedor` | `NOME_FORNECEDOR` | texto | `FORNECEDOR` |
| `documento` | `DOCUMENTO` | texto ou `null` | `DOCUMENTO` |
| `data` | `DATA` | `AAAA-MM-DD` | `DATA` (`DD/MM/AAAA`) |
| `detalhamento` | `DETALHAMENTO` | texto ou `null` | `DETALHAMENTO` |
| `valorReembolsado` | `VALOR_REEMBOLSADO` | número JSON (`int` ou `float`) | `VALOR_REEMBOLSADO` |

O CSV da API é UTF-8, 13 colunas, `;`, sem a linha "ULTIMA ATUALIZACAO", cabeçalho na linha 1, valores com vírgula decimal e sempre duas casas (`9,99`; negativos `-9,99`; 23.866 de 23.866 em 2025) e datas ISO. Em 2025 tem 23.866 registros em 23.888 linhas físicas (21 a mais que registros e cabeçalho), ou seja, há campos com quebra de linha **[observado]**. A API é servida com `cache-control: max-age=300, public, s-maxage=57600` e `last-modified` do dia **[observado]**. `s-maxage=57600` são 16 horas: **dois passes dentro de 16 horas devolvem a mesma cópia em cache** e não provam estabilidade.

**Verificação de estabilidade** de cada coleta (por ano):

1. JSON completo: o array fecha e o texto parseia inteiro (um corte no meio recusa a coleta).
2. `id` único dentro da execução (repetido recusa a coleta).
3. `last-modified` (e o `etag`) da resposta registrados na evidência da execução.
4. Diferença do **conjunto de `id`** contra a execução anterior do mesmo ano: id que sumiu, ou id cujo conteúdo mudou, **retém a competência** (`mes`) afetada até revisão. Id novo em mês já publicado também é diferença e vai para revisão.

`tipoDocumento` em 2025 (contagem): Nota Fiscal Eletrônica 12.218; Fatura 5.138; Cupom Fiscal 2.007; Recibo 1.690; Passagem / Bilhete / Código Localizador 1.309; Boleto 848; Nota Fiscal 656 **[observado]**.

`TIPO_DESPESA` em 2025: sete rótulos mais vazio. Os sete são estáveis de 2011 a 2026; "Passagens aéreas, aquáticas e terrestres nacionais" e "Serviços de Segurança Privada" só existem a partir de 2011, e o rótulo de material de consumo termina com um espaço (1.363 linhas em 2025) **[observado]**.

## Campos que o pipeline usaria

| Campo | Tipo | Observações |
| --- | --- | --- |
| Identificador do registro | inteiro positivo (7 dígitos em 2025) | `id` da API (= `COD_DOCUMENTO` do CSV legado). Único dentro de cada ano e **nunca repetido entre os 19 anos** (0 colisões em 2008-2026) **[observado]**. É a única chave de linha; o conteúdo não é chave (ver quirk 15). |
| Ano, mês | inteiros | Competência do lançamento, não da data do documento (ver quirks). |
| Senador | texto no CSV; `codSenador` na API | Chave de ligação é o código, nunca o nome. |
| Tipo de despesa | texto ou vazio | Vazio em 76 linhas de 2025 (4 anos têm vazios: 2023-2026). **Linha sem tipo fica fora de total, ranking e % do teto** até ser explicada (quirk 26). |
| CNPJ/CPF | texto | CNPJ com máscara `99.999.999/9999-99`; CPF mascarado na API. Tratar como dado pessoal quando é CPF; **CPF mascarado não é chave de fornecedor**. |
| Fornecedor | texto | Nome do CNPJ ou da pessoa física; pode ter CPF completo no meio do nome (quirk 28). **Pessoa física é publicada com a etiqueta dos deputados, "Fornecedor pessoa física", sem nome e sem fragmento de CPF.** Passa por `redactCpf` e pela regra de nome (ver "Regras de privacidade e de nome"). |
| Documento | texto ou vazio | Não numérico (localizador de passagem como `ABC123`, `s/n`, `01-2025`). |
| Data | data | Do documento. Pode estar vazia ou com ano absurdo. |
| Detalhamento | texto livre ou vazio | Em passagens traz companhia, localizador e **nomes e matrículas de passageiros** (servidores). **Nunca publicado nem copiado para arquivo derivado**, em nenhuma categoria. |
| Valor reembolsado | decimal em reais | Vírgula decimal no CSV; centavos inteiros no pipeline. Pode ser negativo. |

## Regras de privacidade e de nome de fornecedor

Valem para todo arquivo derivado, relatório, lista de revisão e log; o original da API fica só cifrado.

1. **Redação.** `fornecedor`, `documento` e `detalhamento` passam por `redactCpf` (`src/cpf-scan.ts`) antes de qualquer arquivo derivado, relatório, lista de revisão ou log, e a saída é barrada com `scanCpfs` (contagem diferente de zero recusa a gravação).
2. **`detalhamento` nunca é publicado nem copiado para arquivo derivado, em nenhuma categoria** (nem para lista de revisão ou log). Ele só existe no original cifrado.
3. **`documento`** segue o que o pipeline dos deputados faz com `documentId` e `documentNumber`: em `src/build-site.ts` esses campos só passam por `redactExpense`/`redactCpf` e seguem no registro publicado (o CSV aberto de `src/view.ts` traz a coluna `documento`); **não há exceção para linhas de passagem** no código (a busca por "localizador", "bilhete" e "passagem" em `src/` só acha a categoria SIGEPA nas regras de repetição). Portanto o localizador de reserva do Senado em `documento` é publicado como o `documento` das outras linhas, depois de `redactCpf`.
4. **Nome do fornecedor: a mesma regra dos deputados** (`publicSupplier` e `maskPersonalId` em `src/model.ts`; no `src/build-site.ts`, o bloco que decide o nome mostrado; no `src/review-list.ts`, as seções "Nomes de fornecedor ocultados" e "Nomes mantidos pela regra de empresa", gravadas em `output/review`, que não é publicado). Os senadores a seguem assim:
   - Identificador de 11 dígitos é pessoa física: o nome é publicado como "Fornecedor pessoa física".
   - **Só um valor que bate com a máscara de CNPJ conta como empresa** (e passa em `validCnpj`, como o `supplierVerified` dos deputados). Nome de empresa verificada fica, depois de `redactCpf`: nome de microempreendedor com CPF no meio sai com `[CPF omitido]` no lugar do número.
   - **Qualquer outra forma de identificador falha fechada:** 11, 12 ou 13 dígitos sem máscara, valores de 6 e 7 dígitos (2023), CPF mascarado, vazio. O nome do fornecedor fica retido ("Nome não exibido pelo Clareia") e o caso vai para a lista de revisão. Como nos deputados, o nome só permanece se for uma das etiquetas, estiver em `config/supplier-names-public.json` ou bater com a regra de empresa (`COMPANY_NAME`: LTDA, S.A, EIRELI, EPP, HOTEL…); nesses casos ele aparece em "Nomes mantidos pela regra de empresa" e continua listado para revisão.
   - CPF mascarado não é chave de fornecedor; pessoa física não entra em agrupamento por fornecedor.

## Quirks conhecidos

**Estrutura e codificação**

1. Linha 1 do CSV legado é `"ULTIMA ATUALIZACAO"` com dois campos; o cabeçalho é a linha 2 **[observado]**. Não há linha de cabeçalho repetida **[observado]**.
2. Windows-1252 (byte `0x96` e acentos como um byte). Decodificar como UTF-8 ou ISO-8859-1 estrito estraga o texto **[observado]**.
3. Campos com quebra de linha dentro de aspas: 3 registros em 2012; 2013 tem 4 linhas físicas a mais que registros; o CSV da API de 2025 tem 21. Contar linhas físicas não é contar registros **[observado]**.
4. 2015 tem duas linhas malformadas: `DOCUMENTO` e `DATA` fundidos num só campo (`...";02/08/2015"`), o leitor CSV devolve 10 campos em vez de 11 (ids 2014675 e 2016557) **[observado]**. 2013 tem um campo `VALOR_REEMBOLSADO` com CRLF dentro **[observado]**. O parser precisa rejeitar linha com número de campos diferente de 11, não adivinhar.
5. Datas na API em formato ISO. As com ano de quatro dígitos começando em zero aparecem **um dia antes** da linha equivalente do CSV legado: 1 linha em 2019, 4 em 2024, 1 em 2025 (deslocamento típico de fuso em data de antes de 1900) **[observado]**.

**Valores**

6. Decimal com vírgula, **sem separador de milhar** (nenhum ponto em nenhum valor, 2008-2026) **[observado]**.
7. Formas legítimas de valor: `4000` (sem decimais), `218,7` (uma casa), `,03` e `,2` (sem zero antes da vírgula; 7 casos em 2025), `-30,95` e `-1966` (negativos). Nenhum parser deve exigir duas casas nem dígito antes da vírgula **[observado]**.
8. Valores negativos: 2 em 2015, 1 em 2017, depois 69 (2023), 80 (2024), 130 (2025), 58 (2026). Só 1 dos 130 de 2025 tem o positivo correspondente (mesmo senador, fornecedor, documento e valor) no mesmo arquivo; os demais são estornos sem par visível **[observado]**. Soma assinada, nunca absoluto, nunca descartar.

**Data**

9. `DATA` não é o mês do lançamento. Em 2025, 87,3% das linhas têm a data no mesmo mês de `MES`; 1.807 vêm no mês seguinte, 751 no anterior, e 169 têm o documento 2 ou mais meses depois da competência **[observado]**. A norma diz que a verba mensal pode indenizar despesas de meses anteriores ao do pedido (art. 5º, §7º, APS 5/2014, incluído pelo APS 19/2014) **[relatado]**. Qual evento `ANO`/`MES` marca (pedido, pagamento, lançamento) **não está definido em nenhum dicionário que eu tenha encontrado: NÃO VERIFICADO**.
10. Datas com ano fora do intervalo: em 2025 há linhas com ano 2001, 2005, 2020, 2022, 2023 e um ano de quatro dígitos começando em zero, além de 181 linhas com data de 2026 e 130 com data de 2024 (não examinadas uma a uma). Todas têm o formato `DD/MM/AAAA`; não há data vazia em 2010-2026 **[observado]**. Uma linha de janeiro de 2025 traz documento de `09/12/2025` (onze meses depois) **[observado]**. Nunca derivar competência da data.
11. Datas vazias: **todas** as 2.449 linhas de 2008 (arquivo começa em setembro de 2008) e 695 linhas de 2009, essas também sem CNPJ_CPF; 2008 não traz documento nem CNPJ em nenhuma linha **[observado]**. Dados de 2008 e 2009 não servem a análise por fornecedor.

**Identificação do fornecedor**

12. `CNPJ_CPF` em 2025: 23.540 CNPJ com máscara, 306 CPF com máscara (219 de aluguel, 59 de locomoção e hospedagem, 25 sem tipo, 3 de outros tipos), 20 sem máscara (14 com 13 dígitos, 6 com 12). Nos outros anos da coleta, identificadores sem máscara de CNPJ: 2023 tem 11 (4 com 13 dígitos, 5 com 12, **um de 6 dígitos e um de 7 dígitos**), 2024 tem 24 (11 com 13, 13 com 12) e 2026 tem 3 (13 dígitos); nenhum de 11 dígitos sem máscara em 2023-2026 **[observado]**. Os 20 não passam no dígito verificador de CNPJ nem com zeros à esquerda, exceto 1; **o que são não está confirmado: NÃO VERIFICADO**. Exemplos de fornecedores nesse grupo: um fornecedor de passagens aéreas e uma secretaria de fazenda estadual **[observado]**. 2010, 2011 e 2013 têm CNPJ com espaço inicial (` 99.999.999/9999-99`) **[observado]**. Normalizar por `trim` e por dígitos, guardando **só o original cifrado** e marcando o formato. **Só o valor que bate com a máscara de CNPJ conta como empresa; qualquer outra forma (11, 12, 13, 6 ou 7 dígitos, CPF mascarado) retém o nome do fornecedor e vai para a lista de revisão** (regras de privacidade). **CPF mascarado não é chave de fornecedor; pessoa física não entra em agrupamento por fornecedor.**
13. **CPF de pessoa física aparece em claro no CSV legado** (306 linhas em 2025) e **mascarado na API**, no formato do exemplo `000.***.***-00` (a máscara deixa cinco dígitos do CPF à mostra) **[observado]**. Decisão do dono: o pipeline **nunca baixa o CSV legado**. Os originais da API são guardados **cifrados**, porque trazem nome de pessoa física, cinco dígitos do CPF na máscara, CPFs completos em texto livre (quirk 28) e nomes de passageiros no `detalhamento`. O `fornecedor` dessas linhas é o nome da pessoa: na publicação ele vira **"Fornecedor pessoa física"**, sem nome e sem fragmento de CPF.
14. A API não tem outro campo de fornecedor: não há id numérico de fornecedor em nenhuma das fontes.

**Repetições e correções**

15. Na API de 2025, **46 grupos (122 linhas)** são iguais nas 12 chaves além do `id`, e há 80 casos (195 linhas) de mesmo `codSenador`, `cpfCnpj`, `documento`, `data` e `valorReembolsado` com ids diferentes **[observado]**; nesta contagem ficam de fora `documento` nulo e `documento` igual a `s/n` em qualquer caixa (`s/n`, `S/n`, `S/N`), e **entram** `s/nº`, `sn`/`SN` e `s/n 06/2025`. Como o `cpfCnpj` de pessoa física é mascarado, linhas de pessoas diferentes podem cair no mesmo caso. No CSV legado os grupos iguais em todos os campos menos `COD_DOCUMENTO` são 49 (130 linhas); na API 5 desses grupos têm linhas com `tipoDocumento` diferente, e por isso a contagem cai. Podem ser repetição legítima (duas parcelas) ou lançamento em duplicidade; **os dados não dizem qual: NÃO VERIFICADO**. Mesma questão da [conferência de repetições da Câmara](camara-cota-portal.md); não deduplicar por conteúdo sem decisão do dono (ver "Decisões para o João").
16. `DOCUMENTO` sem número tem variantes `s/n` (142 linhas em 2025), `S/N` (132), `s/nº` (18), `S/n`, `SN`, `s/n 06/2025` e vazio (1.010 linhas) **[observado]**.
17. **Correção entre fontes:** em 2019 três linhas têm valor diferente no CSV legado (carimbo 06/08/2021) e na API: `184,22` contra `92.11`, `170,72` contra `85.36`, `672,64` contra `336.32`. A API tem exatamente a metade do CSV nas três **[observado]**. Qual é a correta e quando mudou: **NÃO VERIFICADO**. O carimbo dos arquivos de 2008-2019 indica que não são regerados desde 2021 (inferência pelo carimbo, não confirmada); a API pode ter recebido correções.
18. **Correção ao longo do tempo:** os arquivos de 2020-2026 são regerados toda noite (carimbo do dia) e um registro de um ano fechado pode mudar. Não comparei dois downloads ao longo de dias, então **se registros antigos são alterados ou apagados depois de publicados: NÃO VERIFICADO**. O prazo para apresentar comprovantes do exercício anterior é o último dia útil de março do ano seguinte pelo APS 5/2014, art. 5º, §3º (texto compilado), mas a apresentação oficial da CEAPS diz **abril** (slides da SAFIN em `https://www12.senado.leg.br/institucional/documentos/seminarios/conhecendo-o-senado/pdfs/cotas-safin.pdf`) **[relatado, os dois, e divergem]**. Um ano só pode ser considerado fechado depois desse prazo.
19. Janeiro tem a menor contagem de 2025 (1.449 linhas contra 2.273 em agosto) e o mês 11 de 2026 é parcial (355 linhas) **[observado]**.

**Senador e exercício**

20. O CSV legado não tem código de senador, só o nome parlamentar em caixa alta (`ALAN RICK`, `ASTRONAUTA MARCOS PONTES`). Em 2025, 82 de 83 nomes batem com `Nome` da API legislativa depois de tirar acento e caixa; o 83º é `WEVERTON ROCHA` na CEAPS e `Weverton` na API legislativa **[observado]**. Não ligar por nome. A API de despesas já traz `codSenador`; o pipeline não usa o CSV legado.
21. Nenhum nome de senador corresponde a dois códigos em 2018, 2019, 2024 e 2025, e nenhum código tem dois nomes em 2025 **[observado]**.
22. Despesa com competência fora do exercício: 6 das 23.866 linhas de 2025, todas do mesmo senador (código 5899), mês 9, durante a licença com suplente (julho a outubro de 2025). As outras 23.860 caem em mês que toca algum período de exercício **[observado]**. A regra da norma é que o titular não tem direito à CEAPS enquanto o suplente está em exercício (APS 5/2014, art. 4º, III) **[relatado]**; o dado público não explica essas 6 linhas.
23. O teste "competência toca um exercício" é frouxo: o mesmo senador volta ao exercício em 30/10/2025 e tem 13 linhas de `MES` 10 com data anterior a 30/10 **[observado]**. A cota de quem assume é proporcional aos dias (APS 5/2014, art. 4º, §2º) **[relatado]**; o dado não separa a parte anterior à posse.
24. **Código sem mandato:** o código 5070 (Wilder Morais) aparece na CEAPS de 2018 (160 linhas) e 2019 (16 linhas), mas `senador/5070/mandatos` lista só o mandato da 57ª legislatura (2023) e os códigos não constam em nenhuma `senador/lista/legislatura/N` de 52 a 56 **[observado]**. Das 91 pessoas da CEAPS 2018 é a única sem mandato correspondente. Em 2024 e 2025 não há essa falha (todos os 88 e 83 códigos estão nas listas das legislaturas 56 e 57); 2020-2023 não foram conferidos. Causa: **NÃO VERIFICADO**.

**Fora da CEAPS e sem tipo**

25. A CEAPS não é todo o gasto do gabinete. A API `.../senadores/{codigo}/recursos-utilizados?ano=AAAA` separa "cotas" e "gastosNaoInclusos" (diárias, ressarcimento de passagens de viagens oficiais, correios, impulsionamento em mídias sociais e "Aquisição de passagens aéreas (ATC 2/2023)"). Para o código 5967 em 2025 os gastos não incluídos somam R$ 197.425,12 contra R$ 488.073,13 em cotas **[observado]**. Os quatro trechos aéreos mensais extras do ATC 2/2023, art. 1º (§5º novo do art. 1º do ATC 3/2003), ficam fora da tabela de teto **[relatado]**.
26. **Linhas sem `TIPO_DESPESA`.** Em 2025 são 76 linhas de 9 senadores, R$ 232.929,63 no total **[observado]**. O senador 5967 tem 12 delas, todas de um mesmo fornecedor pessoa jurídica, `tipoDocumento` Recibo, **R$ 3.500,00 em cada mês de 1 a 12, R$ 42.000,00 no total**. O total de "cotas" de `recursos-utilizados` para esse senador (R$ 488.073,13) é exatamente a soma das linhas **com** tipo; o total completo da API é R$ 530.073,13, e a diferença é essa soma de R$ 42.000,00 **[observado]**. Ou seja, o próprio Senado exclui essas linhas das cotas. É provável que sejam Auxílio-Moradia (a mesma resposta traz "Auxílio-Moradia: Utilizou" para esse senador), mas **NÃO VERIFICADO**. Regra: **linha sem tipo fica fora de total, ranking e % do teto até ser explicada**, e entra na lista de revisão com o total por senador e mês. Não usar `recursos-utilizados` como conferência até haver explicação oficial.

27. **Entrada de mandato sem `CodigoMandato`:** dois dos 83 senadores (5718 e 6358) trazem em `mandatos` um item sem `CodigoMandato`; no 6358 o item também não tem `DescricaoParticipacao` nem `Exercicios`, tem as duas legislaturas iguais (57ª) e vem antes do mandato real (código 602) **[observado]**. Ao ligar a pessoa a um assento, ignorar itens sem `CodigoMandato`.

**CPF em texto livre**

28. **CPF completo e válido dentro de campos de texto da API** (contagens pela regra `cpfRuns` de `src/cpf-scan.ts`; só contagens aqui). O `fornecedor` de linhas com CNPJ com máscara traz um CPF no meio do nome, com a forma de nome de microempreendedor individual: **2023 tem 93 linhas (27 fornecedores distintos), 2024 tem 138 (27), 2025 tem 121 (24) e 2026 tem 64 (18)**. `documento` traz CPF em 5 linhas de 2023, 4 de 2024, nenhuma de 2025 e 6 de 2026. `detalhamento` traz CPF em 1 linha de 2025 (nenhuma nos outros anos) **[observado]**. A API mascara só a coluna de identificador; esses CPFs estão em claro. Tratamento: "Regras de privacidade e de nome de fornecedor".

## Identificador do senador e ligação entre fontes

- Código oficial: **`CodigoParlamentar`** da API legislativa, que é o mesmo número de `codSenador` da API de despesas e o do perfil público (`https://www25.senado.leg.br/web/senadores/senador/-/perfil/5967`). Nos 83 senadores da CEAPS 2025, todos os `codSenador` existem como `CodigoParlamentar` em `senador/{codigo}/mandatos` e o nome coincide (exceto Weverton, quirk 20) **[observado]**.
- `CodigoPublicoNaLegAtual` (por exemplo 832 para o código 5967) é outro número, de uso na legislatura atual; **não** é o código das despesas **[observado]**.
- O código identifica a **pessoa**, não o assento: um titular e seus suplentes têm códigos diferentes. O vínculo com o assento está em `CodigoMandato` (mesmo valor para titular e suplentes do mesmo mandato).
- Câmara, TSE e outras bases não compartilham esse número. Ligações com outras fontes não existem nesta etapa; não ligar por nome.
- Em 2018-2019 há uma exceção: o código 5070 (quirk 24).

## Mandatos, suplentes e exercício

API legislativa, `https://legis.senado.leg.br/dadosabertos`, sem autenticação, JSON com `Accept: application/json` ou com o sufixo `.json` **[observado]**; os arquivos são UTF-8. Respostas em 26/11/2026:

| Endpoint | Para quê | Status |
| --- | --- | --- |
| `/senador/lista/atual` | 81 senadores em exercício hoje | 200 |
| `/senador/lista/legislatura/{n}` (ou `{inicio}/{fim}`) | Pessoas com mandato na legislatura, **inclusive suplentes que nunca exerceram**: 245 na 57ª, 231 a 253 nas 52ª-56ª | 200 (52 a 57) |
| `/senador/{codigo}` | Identificação, partido atual, UF atual | 200 |
| `/senador/{codigo}/mandatos` | Mandatos e **exercícios com data de início, fim e causa** | 200 |
| `/senador/{codigo}/licencas` | Licenças com datas e tipo | 200 |
| `/senador/afastados` | 44 mandatos hoje fora de exercício, **inclui suplentes cujo último exercício já terminou** (código 6366, exercício `2024-06-20` a `2024-10-17`) | 200 |
| `/senador/lista/legislatura/57/suplentes` | não existe | 404 (`application/problem+json`) |

Campos usados em `/senador/{codigo}/mandatos` (`MandatoParlamentar.Parlamentar`):

| Campo | Tipo | Observações |
| --- | --- | --- |
| `Codigo`, `Nome` | texto | Código oficial e nome parlamentar |
| `Mandatos.Mandato[]` | lista (ou objeto único) | Um por mandato; cada legislatura ocupa dois mandatos de oito anos |
| `CodigoMandato`, `UfParlamentar` | texto | UF de representação do mandato (usada no teto) |
| `PrimeiraLegislaturaDoMandato`, `SegundaLegislaturaDoMandato` | objeto | `NumeroLegislatura`, `DataInicio`, `DataFim` (as duas legislaturas do mandato) |
| `DescricaoParticipacao` | texto | `Titular`, `1º Suplente`, `2º Suplente` (o `º` vem em UTF-8) |
| `Titular` | objeto | Só quando a pessoa é suplente: `CodigoParlamentar`, `NomeParlamentar` do titular |
| `Suplentes.Suplente[]` | lista | Quando é titular: os dois suplentes |
| `Exercicios.Exercicio[]` | lista, ausente se nunca exerceu | **Períodos de efetivo exercício** |
| `Exercicio.CodigoExercicio`, `DataInicio` | texto, data | Início do período |
| `Exercicio.DataFim` | data | **Ausente quando o exercício está em curso** |
| `Exercicio.SiglaCausaAfastamento`, `DescricaoCausaAfastamento` | texto | Motivo do fim: `RET` (retorno do titular), `LCS` (licença com convocação de suplente), `TER` (término do mandato), `AFO` (afastamento do exercício), `LP ` (licença particular, **com espaço no fim**), `REN` (renúncia), `LS ` (licença saúde, **com espaço no fim**) |
| `Exercicio.DataLeitura` | data | Presente em alguns (por exemplo 2007) |
| `Partidos.Partido[]` | lista | Filiações com `DataFiliacao` e `DataDesfiliacao` |

Como o exercício de um suplente é publicado **[observado]** em 83 senadores da CEAPS 2025:

- O suplente em exercício tem **seu próprio** `Mandato` com `DescricaoParticipacao: 1º Suplente` e uma lista `Exercicios` com um item por assunção. Exemplo (código 5917): exercício `2022-12-07` a `2023-09-04` com causa `RET` (retorno do titular) e outro com `DataInicio` `2023-09-04` e sem `DataFim`.
- O titular tem os períodos complementares: o titular 4545 tem exercício `2019-02-01` a `2022-11-21` com causa `LCS` e um exercício de um dia, `2023-09-04` a `2023-09-04`, com causa `REN`. **Fim de um exercício e início do seguinte podem cair no mesmo dia** (suplente e titular, 2023-09-04), e a lista `Exercicios` não está em ordem cronológica.
- Suplente que nunca assumiu não tem `Exercicios` (por exemplo o 2º suplente de código 5918).
- Nos 83 senadores da CEAPS 2025 há 162 itens de exercício: 125 em mandatos de titular, 35 de 1º suplente e 2 de 2º suplente.
- Causa de afastamento nesses 162 itens: sem causa (em curso) 74; `RET` 25; `LCS` 24; `TER` 19; `AFO` 6; `LP ` 6; `REN` 5; `LS ` 3.
- As **licenças** (`/licencas`) têm `DataInicio`, `DataInicioPrevista`, `DataFim`, `DataFimPrevista`, `SiglaTipoAfastamento` (por exemplo `LICENCA_SAUDE_ATE_120D`), e **não substituem** `Exercicios`: o exercício é o que define quem era senador no período.
- O endpoint `/senador/afastados` e a lista por legislatura contêm pessoas sem exercício; só `Exercicios` diz quem exerceu.
- A UF é do mandato (`UfParlamentar`); uma pessoa com mais de um mandato usa a UF do mandato cujo exercício cobre o mês.

Para a CEAPS: um mês pertence ao senador se algum exercício dele toca o mês (início ≤ último dia do mês e fim ≥ primeiro dia, fim ausente = em curso). Na CEAPS 2025 isso cobre 23.860 de 23.866 linhas (quirk 22). Nada nas fontes diz quantos dias de exercício há em cada mês, e a CEAPS do suplente é proporcional aos dias (APS 5/2014, art. 4º, §2º, **[relatado]**).

## Teto mensal por UF (valor da cota)

**Não existe arquivo de dados abertos com o teto**: a API de despesas só devolve gasto e `recursos-utilizados` não traz o limite **[observado]**. A fonte é o texto dos atos, como na Câmara.

Composição (APS 5/2014, art. 2º, texto compilado) **[relatado]**: valor mensal da CEAPS = verba indenizatória (R$ 15.000,00 fixos em 2014, "mantido o valor fixado para 2005") + verba de transporte aéreo (5 trechos ida e volta capital do estado-Brasília pela tabela IATA de tarifa governamental; o Distrito Federal recebe o valor de Goiás). A apresentação da SAFIN usa a mesma divisão e diz VI de R$ 15.000,00. Essa composição é da tabela anterior a 2023; para 2025 o anexo traz só o total por UF.

Cadeia de atos **[observado nos textos oficiais]**:

1. Tabela anterior a 2023, PDF sem data, VI + VTA = total. Não é a vigente em 2025.
2. **ATC nº 2/2023** (7/2/2023, publicado em 10/2/2023; **6% a partir de 1/2/2023; ato em vigor em 1/3/2023**): atualiza em **6% desde 1/2/2023, 6% desde 1/2/2024 e 6,13% desde 1/2/2025** (art. 2º) e fixa o anexo de 2023 (a tabela anterior × 1,06: Acre 38.854,45 × 1,06 = 41.185,72). O valor de **fevereiro de 2023** não está confirmado: o reajuste é de 1/2, mas o ato só entra em vigor em 1/3. Só o anexo de 2023 é publicado; **os valores de 2024 e os de janeiro e fevereiro de 2025 não têm anexo próprio**: NÃO VERIFICADO se foram publicados em outro lugar.
3. **Ato do Presidente nº 8/2025** (28/2/2025, ad referendum da Comissão Diretora, **a ratificação não foi verificada**, publicado no Boletim Administrativo nº 9678 em 28/2/2025; **art. 3º: em vigor em 1º de março de 2025**): "O valor da CEAPS passa a vigorar na forma do Anexo". A ementa diz que altera o ATC 3/2003, mas a observação da própria norma no portal diz que houve erro material e que só reajusta os valores do anexo do ATC 2/2023. Considera o Ato da Mesa da Câmara nº 43/2009.
4. Para 2026: **não encontrei ato do Senado** que reajuste a CEAPS de 2026 (busca na base de normas e na web, não exaustiva). **NÃO VERIFICADO**. Reportagens com valores de 2026 divergem entre si (R$ 41.612,55 a R$ 58.474,70 são números da Câmara, não do Senado) e não valem como fonte.

Valor mensal por senador, em reais (as três tabelas são totais mensais por UF):

| UF | Antes de 2023 (PDF sem data) | Anexo ATC 2/2023 (6% a partir de 1/2/2023; ato em vigor em 1/3/2023) | Anexo Ato do Presidente 8/2025 (de 1/3/2025) |
| --- | --- | --- | --- |
| AC | 38.854,45 | 41.185,72 | 50.426,26 |
| AL | 35.056,20 | 37.159,57 | 46.737,90 |
| AP | 42.855,20 | 45.426,51 | 51.103,82 |
| AM | 44.276,60 | 46.933,20 | 52.798,82 |
| BA | 35.416,20 | 37.541,17 | 44.804,65 |
| CE | 38.186,60 | 40.477,80 | 48.245,57 |
| DF | 21.045,20 | 22.307,91 | 36.582,46 |
| ES | 33.176,60 | 35.167,20 | 43.217,71 |
| GO | 21.045,20 | 22.307,91 | 41.300,86 |
| MA | 37.396,60 | 39.640,40 | 47.945,49 |
| MT | 34.934,45 | 37.030,52 | 45.221,83 |
| MS | 32.905,20 | 34.879,51 | 46.336,64 |
| MG | 28.496,20 | 30.205,97 | 41.886,51 |
| PA | 40.426,20 | 42.851,77 | 48.207,30 |
| PB | 35.555,20 | 37.688,51 | 47.826,36 |
| PR | 32.586,60 | 34.541,80 | 44.665,66 |
| PE | 36.266,60 | 38.442,60 | 47.470,60 |
| PI | 38.834,45 | 41.164,52 | 46.765,57 |
| RJ | 31.816,20 | 33.725,17 | 41.553,77 |
| RN | 35.976,20 | 38.134,77 | 48.525,79 |
| RS | 35.886,60 | 38.039,80 | 46.669,70 |
| RO | 34.615,20 | 36.692,11 | 49.466,29 |
| RR | 40.724,45 | 43.167,92 | 51.406,33 |
| SC | 32.871,32 | 34.843,60 | 45.671,58 |
| SP | 30.226,20 | 32.039,77 | 42.837,33 |
| SE | 41.844,45 | 44.355,12 | 49.898,53 |
| TO | 25.215,20 | 26.728,11 | 45.297,41 |

Regra que reproduz o Anexo de 2025 (**cálculo nosso**, não dito pelo ato): para as 27 UFs, o valor de 2025 = `max(Anexo de 2023 × 1,06 × 1,0613, valor de 2025 do [teto dos deputados](camara-cota-ceiling.md))`, com **um único arredondamento ao centavo no fim, meio para cima**; não arredondar o passo de 2024 antes de aplicar 1,0613 (arredondar o passo de 2024 primeiro muda fevereiro de 2025 em 1 centavo em 9 UFs, e Sergipe daria 49.898,54 em vez do 49.898,53 oficial). Nas 27 de 27 UFs o resultado bate com o Anexo do Ato do Presidente 8/2025. O primeiro termo vence em Amapá, Amazonas, Pará e Sergipe (por exemplo 46.933,20 × 1,06 × 1,0613 = 52.798,82); nas outras 23 o valor da Câmara é o maior e coincide com o Anexo (por exemplo Acre 50.426,26, Distrito Federal 36.582,46). Por isso o salto de 2023 para 2025 não é só 6% + 6,13%.

Verificação de plausibilidade, não de validade (cálculo nosso, **sem as linhas de tipo vazio**, **com o calendário** de 2025: janeiro = Anexo de 2023 × 1,06, fevereiro = Anexo de 2023 × 1,06 × 1,0613, março a dezembro = Anexo de 2025, e **por assento (`CodigoMandato`)**: gasto de titular e suplentes somado contra 12 tetos mensais). Os 83 senadores de 2025 ocupam 80 assentos com despesa; 6 assentos passam de 100% do teto anual somado (máximo 106,9%, mediana 92,3%). No nível de assento-mês, 260 de 956 passam do teto do mês, o que é esperado porque o saldo se acumula dentro do exercício, e em 30 dos 80 assentos o gasto acumulado passa do teto acumulado em algum mês (explicações possíveis, como defasagem entre `MES` e data do documento e saldo de outro exercício, **NÃO VERIFICADAS**). Aplicado por pessoa, com a tabela de 2025 em todos os meses, o resultado antigo era 3 de 83 acima de 100% (máximo 106,4%); com a tabela anterior a 2023 seriam 61 de 83: ela **não** é a vigente em 2025. Passar de 100% no ano pode vir de saldo e comprovantes de outro exercício (APS 5/2014, art. 5º, §3º), então não é prova de erro.

Regras de uso (todas **[relatado]**, APS 5/2014 compilado, que pode ter sido alterado depois: a versão lida não mostra emendas posteriores a 2014 no texto; **NÃO VERIFICADO** se a redação de 2025 é a mesma):

- Art. 5º, §5º: o valor mensal, inclusive créditos retroativos, pode ser remanejado para meses seguintes **dentro do exercício**; §6º: sem acumulação de um exercício para o seguinte. Um mês pode passar do teto mensal e o teto efetivo é anual, como na Câmara.
- Art. 4º: não tem direito à CEAPS o senador afastado nos casos do art. 56, I da Constituição, o licenciado sem remuneração para interesses particulares, nem o senador cujo **suplente esteja em exercício**. §2º: o suplente em exercício usa a CEAPS **proporcional aos dias em efetivo exercício**, dentro do limite mensal e do saldo do titular, que pode transferir o valor, integral ou parcial, ao suplente. §3º: o suplente pode apresentar despesas feitas em nome do titular antes da posse.
- Prazo de comprovantes do ano anterior: março (norma compilada) ou abril (apresentação da SAFIN): quirk 18.
- Quatro trechos aéreos extras por mês (ATC 2/2023, art. 1º) não estão no teto da tabela e não aparecem como CEAPS (quirk 25).

### Regras do "% do teto" para senadores (decisão do dono, 26/11/2026)

- O percentual é mostrado **onde existe tabela oficial** (2023 e, a partir de 1/3/2025, 2025).
- Onde o teto pode ser calculado pelos passos oficiais de reajuste (ATC 2/2023, art. 2º: 6% em 1/2/2024 e 6,13% em 1/2/2025), o percentual é mostrado com o rótulo **"teto calculado pela Clareia a partir do ATC 2/2023"**. Calendário (cálculo nosso, não publicado em anexo): março de 2023 a janeiro de 2024 = Anexo de 2023 (oficial); fevereiro de 2024 a janeiro de 2025 = Anexo de 2023 × 1,06; fevereiro de 2025 = Anexo de 2023 × 1,06 × 1,0613; **de março a dezembro de 2025** = Anexo do Ato do Presidente 8/2025 (oficial). Cada valor calculado tem **um único arredondamento ao centavo no fim, meio para cima; não arredondar o passo de 2024 antes de aplicar 1,0613**. Janeiro e fevereiro de 2023 ficam sem percentual até a vigência ser confirmada.
- **2026 fica sem percentual até o Senado confirmar se o Anexo de 2025 continua valendo em 2026.**
- O ranking é separado do dos deputados e **cobre só meses que têm teto**.
- O teto é **por assento (`CodigoMandato`)**, não por pessoa: o suplente usa o saldo remanescente do titular (APS 5/2014, art. 4º, §2º), então titular e suplentes do mesmo mandato dividem um único limite mensal e um único saldo anual.
- Linhas sem `TIPO_DESPESA` ficam fora do numerador (quirk 26).

O denominador precisa, além disso, da UF do **mandato** de cada mês, do exercício do mês (quirks 22 e 23) e da tabela vigente no mês. Mês sem teto não entra no ranking nem no percentual, nunca vale zero.

## Decisões para o João

Só os itens ainda abertos:

1. **Linhas repetidas.** Se aplicamos a regra da Câmara (publicar todas as linhas e marcar `duplicateFlag: 'possible'`, com a competência na lista de revisão) ou se retemos a competência. Hoje, na API de 2025, são 46 grupos (122 linhas) iguais em todas as chaves além do `id`.
2. **Significado de `ANO`/`MES` e quando um ano conta como fechado.** Os dados mostram que o mês não é o da data do documento (quirk 9) e o prazo de comprovantes é março (APS 5/2014) ou abril (SAFIN). Falta dizer qual evento `ANO`/`MES` marca e a partir de quando um ano deixa de mudar.
3. **As 6 linhas de 2025 em mês de licença com suplente** (senador 5899, mês 9, quirk 22): publicar, reter ou mandar para a lista de revisão. Proposta: lista de revisão.
4. **Ano em que o assento trocou de mãos:** mostrar o % do assento com as pessoas listadas, ou não mostrar % individual.

## O que está confirmado e o que não está

Confirmado: existência e formato da API (e dos arquivos legados) de 2008 a 2026; equivalência de registros entre CSV legado e API em 2019, 2024 e 2025; `COD_DOCUMENTO` = `id`, único entre anos; `codSenador` = `CodigoParlamentar`; estrutura de exercícios de suplentes e causas; tabelas de 2023 e 2025 e suas vigências.

Não confirmado: o evento que `ANO`/`MES` marca; se e quando registros passados são alterados; por que a API e o CSV de 2019 divergem em 3 linhas; o que são os 20 documentos sem máscara de 12 e 13 dígitos; se os 46 grupos de linhas repetidas de 2025 são duplicidade; o mandato do código 5070 em 2018; se as linhas sem tipo (R$ 3.500,00 por mês no senador 5967) são Auxílio-Moradia; o teto de **fevereiro de 2023** (reajuste de 1/2, ato em vigor em 1/3), o oficial de 2024 e de janeiro e fevereiro de 2025 (só calculáveis), e se o Anexo de 2025 continua valendo em 2026; a **ratificação** pela Comissão Diretora do Ato do Presidente 8/2025, que é ad referendum; o prazo de comprovantes (março ou abril); a redação atual do APS 5/2014; as 6 linhas de 2025 em mês de licença.

## Fixture pública

`tests/fixtures/senado/` guarda linhas reais de 2025 e mandatos reais, lidos em 26/11/2026:

- `ceaps-2025-api-sample.json` e `ceaps-2025-api-sample.csv`: 16 linhas no formato da API (JSON e CSV UTF-8 com o cabeçalho da API, valores `385,00`, nulos sem aspas). É o formato de registro do pipeline.
- `ceaps-2025-sample.csv`: as mesmas 16 linhas do CSV legado, nos bytes originais (Windows-1252, CRLF, as duas linhas de cabeçalho), só para testar a decodificação e os quirks do formato que o pipeline não baixa. O `.gitattributes` marca `tests/fixtures/senado/*.csv -text` para que o Git não reescreva o CRLF (o hash do blob confere com e sem filtros).
- `mandatos-sample.json`: lista com dois envelopes reais de `/senador/{codigo}/mandatos` (`MandatoParlamentar.Parlamentar`, com `noNamespaceSchemaLocation` e `Metadados`) para os códigos 5899 (titular com licença e retorno em 30/10/2025) e 5917 (suplente). O mandato do suplente mantém a chave `Titular`. Só `Suplentes` e `Partidos` foram removidos dos mandatos.

Cobertura: CNPJ com máscara, pessoa física (substituída), tipo de despesa vazio, documento vazio, valor negativo, `s/n`, CNPJ/identificador sem máscara de 13 dígitos (duas linhas iguais no CSV legado; na API diferem em `tipoDocumento`), data de ano de quatro dígitos começando em zero, data posterior à competência (2026 em competência 12 de 2025; um documento de dezembro em competência 1), valores `218,7`, `,03` e inteiros, a linha do senador 5899 em mês de licença (mês 9), **uma linha de empresa com o byte `0x96` (travessão) no `DETALHAMENTO` do CSV legado**, **uma linha de hotel com o campo `DETALHAMENTO` em duas linhas entre aspas** (`\r\n` dentro do campo, sem nenhum nome de pessoa; existe só nos fixtures da API, no fixture legado o mesmo campo está numa linha só) e **uma linha de empresa com número no formato de CPF dentro do `fornecedor`** (quirk 28), só com o marcador `000.000.000-00`.

Alterações em relação à fonte: os `id` são os da fonte, **exceto quatro linhas**: 9000001 e 9000002 (pessoa física), 9000003 (a linha de passagem) e 9000004 (linha **totalmente sintética**: senador, CNPJ de exemplo, valor e data inventados). Nas duas linhas de pessoa física o identificador do fornecedor virou `000.000.000-00` (`000.***.***-00` na API), o fornecedor virou "Pessoa física", e **valor, data e documento foram inventados** (a data da segunda mantém a forma de ano começando em zero, com um dia inventado), porque senador, mês, valor, data e documento juntos ainda apontavam para uma linha real da API. Na linha de passagem, o localizador real foi trocado por `ABC123` e os nomes de passageiros do `DETALHAMENTO` por `[PASSAGEIROS REMOVIDOS]`. CNPJs, valores e datas das demais linhas são os da fonte. Nenhum número de pessoa física completo está no repositório.
