/* Textos das páginas Sobre, Correções, Metodologia, Dados abertos e Apoie. Lido pelo navegador e por src/prerender.ts (via vm), para que o texto exista em um só lugar. */
(() => {
  'use strict';
  const CONTACT_EMAIL = '';
  const POLICY = 'Respondemos em até 5 dias úteis. Toda correção vira uma nova versão dos dados, com registro público do que mudou e quando.';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : esc(value);
  const contact = (email = CONTACT_EMAIL) => email ? `<p>Escreva para <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : '<p>Canal de correções em configuração.</p>';
  const corrections = (list = []) => list.length ? `<table class="doc-table"><thead><tr><th scope="col">Data</th><th scope="col">O que mudou</th></tr></thead><tbody>${list.map(e => `<tr><td><time datetime="${esc(e.date)}">${dateBR(e.date)}</time></td><td><strong>${esc(e.title)}</strong>. ${esc(e.detail)}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhuma correção registrada até agora.</p>';
  const RAYS = '<svg class="doc-rays" viewBox="322 88 140 150" aria-hidden="true" focusable="false"><path pathLength="1" d="m330 149 12-53"/><path pathLength="1" d="m376 170 34-42"/><path pathLength="1" d="m404 209 48-19"/></svg>';
  const NAV = [['sobre', 'Sobre'], ['correcoes', 'Correções'], ['metodologia', 'Metodologia'], ['dados-abertos', 'Dados abertos'], ['apoie', 'Apoie'], ['api', 'API']];
  const layout = (name, eyebrow, title, lede, inner, toc = '') => `<div class="doc"><div class="doc-side"><nav class="doc-nav" aria-label="Páginas do projeto">${NAV.map(([key, label]) => `<a href="/${key}"${key === name ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>${toc}</div><article class="doc-main"><header class="doc-head">${RAYS}<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="doc-lede">${lede}</p></header>${inner}</article></div>`;
  const sections = html => { const items = []; const out = html.replace(/<h3>(.*?)<\/h3>/g, (_, text) => { const id = `s${items.length + 1}`; items.push(`<li><a href="#${id}">${text}</a></li>`); return `<h2 id="${id}">${text}</h2>`; }); return { html: out, toc: `<nav class="doc-toc" aria-label="Nesta página"><p class="eyebrow">Nesta página</p><ol>${items.join('')}</ol></nav>` }; };

  const somamos = union => `<h3>O que somamos</h3><p>O valor líquido publicado pela Câmara, por competência financeira: o campo <code>vlrLiquido</code> do arquivo anual CEAP${union ? ' e, nos registros que só a API traz, o <code>valorLiquido</code> da API' : ''}. Salário, gabinete e emendas não entram nesta conta. Quando a fonte traz mais de um lançamento com o mesmo documento e valor, somamos todos, como a Câmara, e marcamos cada um como possível duplicidade.</p><p>Há uma exceção, em duas categorias. O complemento de auxílio-moradia é pago com a cota, segundo a Câmara; a fonte traz o líquido com sinal negativo, e nós o somamos como gasto. O mesmo vale para uma passagem aérea de missão oficial com o mesmo formato. Esses registros ficam marcados e guardam o valor original da fonte. Desde novembro de 2026 a API da Câmara também traz o auxílio-moradia e a telefonia, mas devolve o líquido com o sinal oposto ao do arquivo anual em muitas linhas, não só nessa. Quando a linha da API e a do arquivo anual são o mesmo documento, com o líquido exatamente oposto, pareamos as duas e mantemos o valor do arquivo anual. Quando a API e o arquivo anual trazem o mesmo documento com diferença de até 5 centavos, usamos o valor do arquivo anual. Quando a própria linha do arquivo anual traz o valor do documento menos a glosa diferente do líquido em até 5 centavos, publicamos o líquido do arquivo anual.</p><p>A Câmara mudou a API em novembro de 2026, e por isso refizemos a conferência. O que não fecha com a regra acima fica retido para revisão, e o mês aparece como em revisão.</p>`;
  const conferimos = extra => `<h3>O que conferimos</h3><p>Duas capturas de cada fonte, identidade pelo ID oficial e contas em centavos, reconciliadas com uma segunda soma e com o banco.${extra}</p><p>Suplente convocado conta como fora do cargo até a posse, quando a posse ou outro evento vem em até 30 dias; sem isso, o mês fica sem confirmação. Se a convocação e o exercício caem no mesmo minuto, vale o exercício.</p><p>Evento do histórico datado fora da legislatura é ignorado; o resto do histórico continua valendo.</p>`;
  const senado = `<h3>Senado</h3><p>As despesas dos senadores vêm da API de dados abertos do Senado Federal (CEAPS), com valores em centavos conferidos contra a fonte oficial. Lançamentos sem tipo de despesa informado ficam fora dos totais e aparecem apenas na contagem de revisão. Para 2026, o recorte é parcial e inclui apenas os meses já fechados. O % do teto dos senadores é calculado por assento: titular e suplentes somam os gastos contra um único teto mensal da UF, e só entram os meses com teto conhecido (de março de 2023 a dezembro de 2025). Os meses de fevereiro de 2024 a fevereiro de 2025 usam teto calculado pela Clareia a partir do ATC 2/2023. Janeiro e fevereiro de 2023 e todo o ano de 2026 ficam sem %.</p><p>O gasto mensal de cada senador divide o total publicado pelo número de meses com exercício completo ou parcial no ano. Quem não tem mês de exercício no recorte fica sem média mensal e fora do ranking por mês.</p>`;
  const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const yearSentence = (y, defaultYear) => {
    const months = [...y.months].sort((a, b) => a - b), last = months.at(-1);
    const status = !y.partial ? 'completo' : `publicado de ${MONTH_NAMES[months[0] - 1]} a ${MONTH_NAMES[last - 1]}${last < 12 ? `, porque ${MONTH_NAMES[last]} ainda não fechou` : ''}`;
    return `O ano de ${y.year} está ${status}${String(y.year) === String(defaultYear) ? ' e é o que o site abre primeiro' : ''}.`;
  };
  const anos = (years, defaultYear) => `<h3>Anos publicados</h3><p>${[...years].sort((a, b) => a.year - b.year).map(y => yearSentence(y, defaultYear)).join(' ')} Os valores abrem no total do período; para comparar anos de tamanhos diferentes, use "Por mês".</p><p>O seletor de ano troca o ano em todo o site. Os links de 2025 não mudam. Os links de 2026 trazem <code>?ano=2026</code> no final, e quem abre o link vê o mesmo ano.</p><p>Em 2026 ainda não mostramos a porcentagem do teto. Os limites da cota mudaram pelo Ato da Mesa 244, de 20/02/2026, com atualização pelo IPCA. Ainda não conferimos o anexo do ato nem a data de início, e por isso o site mostra "limite de 2026 em conferência".</p>`;
  const naoConcluimos = `<div class="doc-callout"><h3>O que não concluímos</h3><p>Gasto maior não demonstra irregularidade. O recorte não mede qualidade do mandato nem faz nova subtração de restituições. Fornecedores com CNPJ aparecem pela razão social, que pode ser o nome de um empresário individual. Pessoa física sem CNPJ aparece como 'Fornecedor pessoa física'. Nomes de fornecedores sem CNPJ válido que não parecem de empresa não são exibidos, para proteger possíveis pessoas físicas.</p></div>`;
  const privacidade = `<h3>Privacidade</h3><p>Contamos visitas e quantas vezes cada página foi vista, inclusive as páginas de deputados, com o Cloudflare Web Analytics, sem cookies e sem identificar quem visita. Não sabemos quem viu qual página.</p>`;

  const PIX_KEY = 'jvitorbarros15@gmail.com';
  const apoieBody = () => { const s = sections(`<h3>Por que eu faço isso</h3><p>Os gastos da cota parlamentar sempre foram públicos. Estão no site da Câmara, em arquivos que pouca gente consegue abrir e quase ninguém tem tempo de conferir. Eu queria que qualquer pessoa, em qualquer lugar do Brasil, pudesse procurar o próprio deputado e entender em poucos minutos quanto ele gastou e com o quê.</p><p>O Clareia não tem lado. Mostra o mesmo número para todo mundo, calculado com a mesma regra. Todo valor tem a página "Como chegamos nisso?", com a soma, os registros e o link para a fonte oficial. Se você quiser refazer a conta, os arquivos estão em <a href="/dados-abertos">Dados abertos</a>, em CSV, cada um com seu código SHA-256.</p><p>Uma coisa que eu repito sempre: o Clareia não é auditoria. Gastar mais não quer dizer gastar errado. O site mostra o que foi declarado à Câmara, e a conclusão fica com você.</p><h3>Para onde vai o dinheiro</h3><p>O custo maior é tempo: coletar os dados, conferir cada mês em duas fontes da Câmara e corrigir quando a própria Câmara erra. Isso aconteceu em novembro de 2026, quando a API dela passou a mostrar despesas com o sinal trocado e eu precisei refazer a conferência de três anos. Também quero pagar um domínio próprio e, quando fizer sentido, um servidor para a API pública.</p><p>Com apoio, os próximos passos são as despesas completas de 2023 a 2026, as emendas parlamentares, o custo dos gabinetes e, depois, os senadores.</p><h3>O que a doação não faz</h3><p>Doar não muda nenhum número, ranking ou texto do site. Quem doa não ganha acesso antes, não pode pedir destaque para ninguém e não pode pedir que algo saia do ar. Se um dia isso mudar, vai estar escrito aqui.</p><h3>Como apoiar</h3><div class="doc-callout pix"><p>Pix (chave e-mail):</p><p class="pix-row"><code id="pix-key" class="pix-key">${PIX_KEY}</code><button type="button" class="outline-button pix-copy" data-action="copy-pix">Copiar chave</button></p></div><p>Qualquer valor ajuda. O site continua sem anúncios, sem cookies e sem cadastro.</p>`); return layout('apoie', 'Apoie', 'Apoie o Clareia', 'O Clareia é feito por uma pessoa, sem dinheiro de partido nem de político. Se ele te ajudou a entender alguma coisa sobre quem te representa, você pode ajudar a mantê-lo no ar.', s.html, s.toc); };

  const num = n => Number(n).toLocaleString('pt-BR');
  const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MiB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KiB`;
  const code = text => `<code>${esc(text)}</code>`;
  const fieldTable = rows => `<table class="doc-table"><thead><tr><th scope="col">Campo</th><th scope="col">Tipo</th><th scope="col">O que significa</th></tr></thead><tbody>${rows.map(([name, type, text]) => `<tr><td>${code(name)}</td><td>${type}</td><td>${text}</td></tr>`).join('')}</tbody></table>`;

  const RECORD_FIELDS = [
    ['id', 'texto', 'Identificador público da ocorrência (hash). Não é o número do documento.'],
    ['personId', 'número', 'ID oficial do deputado na Câmara.'],
    ['year', 'número', 'Ano da competência.'],
    ['month', 'número', 'Mês da competência, de 1 a 12. É o mês usado em todos os totais do site.'],
    ['date', 'texto ou nulo', 'Data e hora do documento, no formato AAAA-MM-DDThh:mm:ss, sem fuso. Pode faltar e pode cair em mês diferente da competência.'],
    ['category', 'texto', 'Categoria da cota, como a Câmara a escreve.'],
    ['supplier', 'texto', 'Nome do fornecedor como o site o publica. Pode ser "Fornecedor pessoa física" ou "Nome não exibido pelo Clareia".'],
    ['supplierLabel', 'texto, opcional', 'Nome de exibição usado nas páginas do site quando difere de <code>supplier</code> (reúne grafias do mesmo CNPJ).'],
    ['supplierKey', 'texto, opcional', 'Identificador do fornecedor com CNPJ verificado (um hash, não o CNPJ). Ausente quando o fornecedor não foi verificado.'],
    ['supplierVerified', 'verdadeiro ou falso', 'Se o CNPJ do fornecedor foi verificado.'],
    ['documentId', 'texto', 'Identificador do documento na Câmara. "Não informado" quando falta.'],
    ['documentNumber', 'texto', 'Número impresso no documento.'],
    ['cents', 'inteiro', 'Valor líquido em centavos de real. Negativo é ajuste. É o valor somado nos totais.'],
    ['documentCents', 'inteiro ou nulo', 'Valor do documento, em centavos.'],
    ['disallowedCents', 'inteiro ou nulo', 'Valor glosado (não aceito) pela Câmara, em centavos.'],
    ['origin', 'texto', '<code>both</code>: está no arquivo anual e na API da Câmara; <code>annual</code>: só no arquivo anual; <code>api</code>: só na API.'],
    ['source', 'objeto', 'De onde veio o registro. Os campos estão abaixo.'],
    ['source.url', 'texto', 'Endereço do arquivo da Câmara de onde o registro foi lido.'],
    ['source.row', 'número', 'Linha do registro nesse arquivo.'],
    ['source.sha256', 'texto, opcional', 'SHA-256 do arquivo de origem. Ausente em fornecedor não verificado.'],
    ['source.fetchedAt', 'texto', 'Quando o arquivo foi baixado.'],
    ['receipt', 'texto ou nulo', 'Link do recibo ou da nota na Câmara.'],
    ['lot', 'texto', 'Lote de coleta em que o registro entrou.'],
    ['duplicateFlag', 'texto, opcional', 'O texto <code>possible</code> quando a fonte repete documento e valor: possível duplicidade. Não é verdadeiro ou falso.'],
    ['sourceCents', 'inteiro, opcional', 'Valor original da fonte, antes da correção de sinal. Vem junto com <code>note</code>.'],
    ['note', 'texto, opcional', 'Explicação de um tratamento aplicado ao registro, como "sinal corrigido conforme a página da Câmara".'],
    ['financialBasis', 'texto, opcional', 'Marca registros em que o líquido não é o valor do documento menos a glosa, mas foi conferido: <code>reported-installment</code> (parcela informada pela fonte) ou <code>balanced-document-split</code> (documento dividido em lançamentos cuja soma fecha).']
  ];
  const CSV_FIELDS = [
    ['id_ocorrencia', 'texto', 'Igual a <code>id</code>.'],
    ['id_deputado', 'número', 'Igual a <code>personId</code>.'],
    ['ano', 'número', 'Igual a <code>year</code>.'],
    ['mes', 'número', 'Igual a <code>month</code>: a competência.'],
    ['data_documento', 'texto ou vazio', 'Igual a <code>date</code>: data do documento. Vazia em parte dos registros, e pode cair em outro mês que a competência.'],
    ['categoria', 'texto', 'Igual a <code>category</code>.'],
    ['fornecedor', 'texto', 'Igual a <code>supplier</code>.'],
    ['documento', 'texto', 'Igual a <code>documentId</code>.'],
    ['valor_centavos', 'inteiro', 'Igual a <code>cents</code>.'],
    ['origem', 'texto', 'Igual a <code>source.url</code>.'],
    ['sha256_origem', 'texto', 'Igual a <code>source.sha256</code>. Vazio em fornecedor não verificado.'],
    ['posicao_origem', 'número', 'Igual a <code>source.row</code>.'],
    ['fonte_do_registro', 'texto', 'Tradução de <code>origin</code>: "arquivo anual e API", "só no arquivo anual" ou "só na API".'],
    ['sinal_corrigido', 'texto', '"sim" quando o sinal do valor foi corrigido (há <code>sourceCents</code>); vazio nos demais.'],
    ['possivel_duplicidade', 'texto', '"sim" quando <code>duplicateFlag</code> é <code>possible</code>; vazio nos demais.']
  ];
  const SUMMARY_FIELDS = [
    ['publicationId, scope, totalCents, records', 'vários', 'Identificador da publicação, recorte (ano, meses, deputados), soma líquida em centavos e número de registros.'],
    ['categories', 'lista de textos', 'Categorias da cota.'],
    ['people[].id, name, photo', 'número, texto', 'ID oficial, nome e foto do deputado.'],
    ['people[].cents, records', 'inteiro, número', 'Soma líquida e número de registros do deputado, sem os meses retidos.'],
    ['people[].categories[]', 'lista', 'Por categoria: <code>category</code>, <code>cents</code> e <code>records</code>.'],
    ['people[].months[].month', 'número', 'Mês da competência.'],
    ['people[].months[].cents, records', 'inteiro, número', 'Soma líquida em centavos e número de registros do mês. Com <code>held: true</code>, <code>cents: 0</code> não é gasto zero.'],
    ['people[].months[].held', 'verdadeiro ou falso', 'Mês retido para revisão: fica fora dos totais.'],
    ['people[].months[].exercise', 'texto', 'Exercício do mandato no mês: <code>full</code>, <code>partial</code>, <code>outside</code> ou <code>unknown</code>.'],
    ['people[].months[].exerciseReview', 'verdadeiro ou falso', 'Exercício do mandato em revisão no mês (divergência entre as fontes oficiais ou mês sem cruzamento). Um mês em disputa nunca é tratado como fora do mandato. Só o mês marcado como fora do mandato, sem despesa, deixa o teto não confirmado; um mês cheio e sem cruzamento, com UF confirmada, continua contando.'],
    ['people[].months[].party, uf', 'texto', 'Partido e UF do deputado no mês, com <code>partyStatus</code> e <code>ufStatus</code> dizendo se são únicos, mudaram, estão em revisão ou não se aplicam. A UF de um mês pode estar confirmada enquanto o partido ainda está em revisão.'],
    ['people[].bills, votes', 'objeto', 'Projetos e votações do deputado, quando publicados.'],
    ['people[].exercisedMonths', 'número', 'Meses do recorte que contam como exercício: todos, menos os marcados como fora do mandato sem despesa e sem exercício em revisão.'],
    ['people[].exerciseReviewMonths', 'lista de números', 'Meses (1 a 12) marcados como fora do mandato sem despesa, mas com exercício em revisão; enquanto houver algum, o deputado fica fora dos rankings e comparações.'],
    ['people[].noExercise', 'verdadeiro ou falso', 'Sem exercício de mandato confirmado no recorte: o deputado não aparece com R$ 0,00.'],
    ['people[].heldMonths', 'lista de números', 'Meses (1 a 12) retidos para revisão, fora dos totais.'],
    ['people[].comparable', 'verdadeiro ou falso', 'Entra nos rankings e comparações: tem exercício confirmado, nenhum mês retido, nenhum mês em <code>exerciseReviewMonths</code> e pelo menos <code>minMonths</code> meses de exercício.'],
    ['people[].party', 'texto', 'Partido exibido no site: o dos meses publicados (vários separados por " / "), "Partido em revisão", "Partido indisponível" ou, sem cobertura aprovada, o atual do cadastro. Pode ser nulo.'],
    ['people[].partyNote', 'texto', 'Como o partido foi obtido quando não vem mês a mês (eventos da legislatura). Nulo nos demais casos.'],
    ['people[].partyInReview', 'verdadeiro ou falso', 'O partido está em revisão: algum mês tem dúvida ou conflito.'],
    ['people[].lastConfirmedParty', 'texto', 'Partido do último mês com partido único confirmado. Pode ser nulo.'],
    ['minMonths', 'número', 'Mínimo de meses de exercício para entrar nos rankings (6, ou o total de meses do recorte se for menor).'],
    ['ceiling', 'objeto', 'Teto mensal da cota por UF, em centavos, com o ato da Mesa que o define.']
  ];
  const INDEX_FIELDS = [
    ['snapshotId', 'texto', 'Identificador da versão dos dados de despesas.'],
    ['collectedAt, publishedAt', 'texto', 'Quando os dados foram coletados e quando a versão foi publicada.'],
    ['scope', 'objeto', 'Recorte: <code>year</code>, <code>months</code>, <code>ids</code> (deputados) e <code>legislature</code>.'],
    ['people[]', 'lista', 'Cada deputado: <code>id</code>, <code>name</code>, <code>party</code>, <code>uf</code>, <code>photo</code>, <code>sourceUrl</code> e <code>profileFetchedAt</code>.'],
    ['people[].social[]', 'lista, opcional', 'Redes sociais que o deputado informou à Câmara, na ordem da fonte: <code>network</code> (Instagram, Facebook, X, YouTube, TikTok, Threads, LinkedIn ou Flickr) e <code>url</code>. Só aparece quando há ao menos uma; links de outros sites ficam de fora.'],
    ['withoutData', 'lista de números', 'Deputados do recorte sem despesas publicadas.'],
    ['validation.totalCents, recordCount', 'inteiro, número', 'Soma líquida e número de registros que a validação aprovou.'],
    ['validation.independentTotalCents', 'texto', 'Segunda soma, feita por outro caminho, que precisa ser igual a <code>totalCents</code>.'],
    ['validation.heldCompetences[]', 'lista', 'Meses retidos: <code>personId</code>, <code>month</code> e <code>reasons</code>.'],
    ['validation.signFix', 'objeto', '<code>count</code> registros de sinal corrigido e a diferença que isso causa, <code>deltaCents</code>.'],
    ['validation.apiSignFix', 'objeto', 'Só aparece quando há mês corrigido: <code>count</code> ocorrências em que a API trouxe o líquido com sinal invertido (com ou sem glosa) e o valor foi tomado do arquivo anual, que confirmou documento e glosa.'],
    ['validation.duplicatePolicy', 'texto', 'Como linhas repetidas são tratadas.'],
    ['audit', 'objeto', 'Resultado das conferências: <code>status</code>, <code>failures</code> e os lotes conferidos, com o hash de cada relatório.']
  ];
  const SUPPLIER_FIELDS = [
    ['categories', 'lista de textos', 'Mesma lista de <code>summary.json</code>.'],
    ['suppliers', 'lista de textos', 'Nomes de exibição dos fornecedores, em ordem alfabética.'],
    ['people', 'objeto', 'Para cada ID de deputado, uma lista de linhas <code>[mês, categoria, fornecedor, centavos, registros]</code>, em que categoria e fornecedor são posições nas listas acima.']
  ];

  const fileRow = (f, base) => `<tr><td><a href="${esc(base)}/${esc(f.path)}" download>${esc(f.name)}</a><code class="doc-sha">${esc(f.sha256)}</code></td><td class="doc-num">${f.records === null ? '—' : num(f.records)}</td><td class="doc-num">${size(f.bytes)}</td></tr>`;
  const fileTable = (files, base) => `<table class="doc-table"><thead><tr><th scope="col">Arquivo e SHA-256</th><th scope="col" class="doc-num">Registros</th><th scope="col" class="doc-num">Tamanho</th></tr></thead><tbody>${files.map(f => fileRow(f, base)).join('')}</tbody></table>`;

  const downloads = (m, base) => {
    const zip = m.files.find(f => f.kind === 'zip'), months = m.files.filter(f => f.kind === 'month'), json = m.files.filter(f => f.kind === 'json');
    const total = months.reduce((n, f) => n + f.bytes, 0), records = months.reduce((n, f) => n + f.records, 0);
    return `<h3>Arquivos para baixar</h3><p>Todos os ${num(records)} registros de despesas desta publicação, um arquivo CSV por mês de competência (${size(total)} no total). São os mesmos registros das páginas dos deputados, já sem CPFs. Cada arquivo traz o tamanho e o SHA-256 para você conferir o que baixou.</p>${zip ? `<h4>Todos os meses em um arquivo</h4>${fileTable([zip], base)}` : ''}<h4>Despesas, um CSV por mês</h4>${fileTable(months, base)}<h4>Resumos e versão</h4>${fileTable(json, base)}<p>Os CSV usam ponto e vírgula como separador, UTF-8 com BOM e valores em centavos. Para conferir, rode <code>sha256sum arquivo</code> (Linux e macOS) ou <code>certutil -hashfile arquivo SHA256</code> (Windows) e compare com o código acima.</p><p>Os arquivos ficam dentro da pasta desta publicação e mudam de endereço a cada nova publicação, então um link antigo continua apontando para os mesmos bytes.</p>`;
  };

  const cuidados = q => {
    const held = q.heldMonths ? `${num(q.heldMonths)} meses de ${num(q.heldPeople)} deputados estão retidos para revisão. No <code>summary.json</code> eles aparecem com <code>cents: 0</code> e <code>held: true</code>. Isso <strong>não é gasto zero</strong>: o valor ainda não foi publicado. Nunca some esses meses como zero.` : 'Nesta publicação nenhum mês está retido. Se um mês aparecer com <code>held: true</code> no <code>summary.json</code>, o <code>cents: 0</code> dele <strong>não é gasto zero</strong>: nunca some esse mês como zero.';
    const dup = q.possibleDuplicates ? `${num(q.possibleDuplicates)} registros têm <code>duplicateFlag</code>. O campo é o texto <code>possible</code> (possível duplicidade), não verdadeiro ou falso, e esses registros <strong>entram nos totais</strong>, como a Câmara os conta.` : 'O campo <code>duplicateFlag</code> é o texto <code>possible</code> (possível duplicidade), não verdadeiro ou falso. Nenhum registro desta publicação tem a marca; quando houver, ele entra nos totais, como a Câmara conta.';
    return `<h3>Cuidados ao usar</h3><ul class="doc-quirks"><li><strong>Sem data.</strong> ${num(q.noDate)} registros não têm data (<code>date</code> é nulo). Use <code>year</code> e <code>month</code>.</li><li><strong>Data e competência diferentes.</strong> ${num(q.monthDiffers)} registros têm data em um mês diferente do mês da despesa (a competência). O campo <code>month</code> é a competência e é o que entra em todos os totais. Não refaça os totais pela data.</li><li><strong>Fornecedor não verificado.</strong> <code>source.sha256</code> e <code>supplierKey</code> não existem nos ${num(q.unverifiedSupplier)} registros de fornecedor não verificado (<code>supplierVerified</code> falso).</li><li><strong>Possível duplicidade.</strong> ${dup}</li><li><strong>Meses retidos.</strong> ${held}</li><li><strong>Valores negativos.</strong> ${num(q.negative)} registros têm valor negativo: são ajustes, como estornos. O complemento de auxílio-moradia segue o sinal da página do deputado na Câmara; veja a <a href="/metodologia">metodologia</a>.</li><li><strong>Nomes não exibidos.</strong> ${num(q.withheldNames)} registros mostram "Nome não exibido pelo Clareia" e ${num(q.individualSuppliers)} mostram "Fornecedor pessoa física", para proteger possíveis pessoas físicas. CPFs nunca são publicados.</li></ul>`;
  };

  const dictionary = `<h3>Dicionário de dados</h3><p>Valores em dinheiro são inteiros em centavos de real. Campos marcados como opcionais só existem em alguns registros.</p><h4>despesas.json, um registro por despesa</h4><p>Há uma lista por deputado, em <code>deputados/&lt;id&gt;/despesas.json</code>. Os CSV mensais trazem as colunas abaixo.</p>${fieldTable(RECORD_FIELDS)}<h4>Colunas dos CSV</h4>${fieldTable(CSV_FIELDS)}<h4>summary.json</h4>${fieldTable(SUMMARY_FIELDS)}<h4>index.json</h4>${fieldTable(INDEX_FIELDS)}<h4>fornecedores.json</h4>${fieldTable(SUPPLIER_FIELDS)}`;

  const citation = (m, base, extra) => {
    const id = extra?.folderId ?? String(base).split('/').pop(), pub = m.publishedAt ? dateBR(String(m.publishedAt).slice(0, 10)) : '';
    return `<h3>Fonte e como citar</h3><p>Os dados vêm dos dados abertos da Câmara dos Deputados: a cota parlamentar (CEAP) do arquivo <a href="https://www.camara.leg.br/cotas/Ano-${esc(m.year)}.csv.zip">Ano-${esc(m.year)}.csv.zip</a>, reunida com a API de dados abertos da Câmara. O Clareia os reorganiza e retira identificadores pessoais. Veja a <a href="/metodologia">metodologia</a> para saber como somamos e conferimos.</p><p>Para citar: <em>Clareia, publicação ${esc(id)}${pub ? `, de ${pub}` : ''}. Dados: Câmara dos Deputados, dados abertos.</em></p>`;
  };

  const otherYears = extra => extra?.others?.length ? `<p class="doc-year-links">Esta é a publicação de ${esc(extra.year)}${extra.partialLabel ? ` (${esc(extra.partialLabel)})` : ''}. ${extra.others.map(o => `<a href="/dados-abertos?ano=${esc(o.year)}">Dados de ${esc(o.year)}${o.partial ? ' (parcial)' : ''}</a>`).join(' · ')}</p>` : '';

  const openDataBody = (m, base, extra) => {
    const lede = 'Baixe as despesas da cota parlamentar em CSV, confira cada arquivo pelo SHA-256 e veja o que cada campo significa.';
    if (!m) return layout('dados-abertos', 'Dados abertos', 'Dados abertos', lede, '<p>Os arquivos desta publicação não estão disponíveis agora. Nenhum valor foi alterado.</p>');
    const s = sections(`${otherYears(extra)}${downloads(m, base)}${cuidados(m.quirks)}${dictionary}${citation(m, base, extra)}`);
    return layout('dados-abertos', 'Dados abertos', 'Dados abertos', lede, s.html, s.toc);
  };

  const spy = () => {
    const links = [...document.querySelectorAll('.doc-toc a')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const heads = links.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
    const mark = id => links.forEach(a => { if (a.hash === '#' + id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    const seen = new Set();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id); });
      const first = heads.find(h => seen.has(h.id));
      if (first) mark(first.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    heads.forEach(h => io.observe(h));
  };

  // Without the observer or with reduced motion every tick is drawn at once; the hidden start state exists only under .doc-js.
  const reveal = () => {
    const doc = document.querySelector('.doc'), items = [...document.querySelectorAll('.doc-card,.doc-steps li,.doc-callout')];
    if (!doc || !items.length || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    doc.classList.add('doc-js');
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
    items.forEach(el => io.observe(el));
  };

  window.ClareiaPages = {
    spy,
    reveal,
    CONTACT_EMAIL,
    POLICY,
    esc,
    layout,
    sections,
    pages: {
      sobre: {
        title: 'Sobre — Clareia',
        description: 'O que é o Clareia, de onde vêm os dados, o que o site não faz e quem o mantém.',
        body: () => layout('sobre', 'Sobre o projeto', 'Sobre o Clareia', 'Despesas da cota parlamentar dos deputados federais, com dados oficiais da Câmara.', `<div class="doc-cards"><section class="p-panel doc-card"><h2>O que é</h2><p>O Clareia mostra as despesas da cota parlamentar (CEAP) dos deputados federais, com dados oficiais da Câmara dos Deputados. Todo número tem a página "Como chegamos nisso?", com a soma, os registros e a fonte.</p></section><section class="p-panel doc-card"><h2>O que o Clareia não é</h2><p>Não é uma auditoria. Gasto maior não significa irregularidade. Os números mostram o que foi declarado à Câmara, e não se uma despesa era adequada.</p></section><section class="p-panel doc-card"><h2>Quem faz</h2><p>O Projeto Clareia é independente. Não tem vínculo com políticos ou partidos e não exibe anúncios.</p></section><section class="p-panel doc-card"><h2>Cookies e cadastro</h2><p>O site não usa cookies e não pede cadastro. Veja a <a href="/metodologia">metodologia</a> para o detalhe da medição.</p></section></div><div class="doc-callout"><h2>Erros</h2><p>Se um dado estiver errado, veja <a href="/correcoes">como pedir uma correção</a>.</p></div>`)
      },
      correcoes: {
        title: 'Correções — Clareia',
        description: 'Como pedir a correção de um dado do Clareia e o registro público das correções feitas.',
        body: (list, email) => layout('correcoes', 'Correções', 'Correções', 'Como pedir a correção de um dado e o registro público do que foi corrigido.', `<ol class="doc-steps"><li><span>1</span><strong>Envie</strong><p>Veja abaixo o que enviar.</p></li><li><span>2</span><strong>Respondemos</strong><p>Em até 5 dias úteis.</p></li><li><span>3</span><strong>Nova versão dos dados</strong><p>Com registro público do que mudou e quando.</p></li></ol><h2>Como pedir uma correção</h2>${contact(email)}<h2>O que enviar</h2><ul><li>O deputado, com nome ou ID da Câmara.</li><li>O número ou o texto como aparece no site, com o link da página.</li><li>A fonte oficial que comprova o dado, como o registro na Câmara ou o arquivo CEAP.</li></ul><div class="doc-callout doc-commit"><h2>Nosso compromisso</h2><p>${POLICY}</p></div><h2>Registro de correções</h2>${corrections(list)}`)
      },
      apoie: {
        title: 'Apoie o Clareia',
        description: 'O Clareia é feito por uma pessoa, sem dinheiro de partido nem de político. Veja por que existe, para onde vai o dinheiro e como apoiar por Pix.',
        body: apoieBody
      },
      'dados-abertos': {
        title: 'Dados abertos — Clareia',
        description: 'Baixe as despesas da cota parlamentar em CSV, com tamanho e SHA-256 de cada arquivo, e consulte o dicionário de dados.',
        body: openDataBody
      },
      metodologia: {
        title: 'Metodologia — Clareia',
        description: 'Como o Clareia soma as despesas, o que confere e o que ainda não concluímos.',
        somamos,
        conferimos,
        senado,
        anos,
        naoConcluimos,
        privacidade
      }
    }
  };
})();
