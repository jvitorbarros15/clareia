/* Textos das páginas Sobre, Correções e Metodologia. Lido pelo navegador e por src/prerender.ts (via vm), para que o texto exista em um só lugar. */
(() => {
  'use strict';
  const CONTACT_EMAIL = '';
  const POLICY = 'Respondemos em até 5 dias úteis. Toda correção vira uma nova versão dos dados, com registro público do que mudou e quando.';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : esc(value);
  const contact = (email = CONTACT_EMAIL) => email ? `<p>Escreva para <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : '<p>Canal de correções em configuração.</p>';
  const corrections = (list = []) => list.length ? `<ul class="corrections">${list.map(e => `<li><time datetime="${esc(e.date)}">${dateBR(e.date)}</time> <strong>${esc(e.title)}</strong>. ${esc(e.detail)}</li>`).join('')}</ul>` : '<p>Nenhuma correção registrada até agora.</p>';

  const somamos = union => `<h3>O que somamos</h3><p>O valor líquido publicado pela Câmara, por competência financeira: o campo <code>vlrLiquido</code> do arquivo anual CEAP${union ? ' e, nos registros que só a API traz, o <code>valorLiquido</code> da API' : ''}. Salário, gabinete e emendas não entram nesta conta.</p>`;
  const conferimos = extra => `<h3>O que conferimos</h3><p>Duas capturas de cada fonte, identidade pelo ID oficial e contas em centavos, reconciliadas com uma segunda soma e com o banco.${extra}</p>`;
  const naoConcluimos = `<h3>O que não concluímos</h3><p>Gasto maior não demonstra irregularidade. O recorte não mede qualidade do mandato nem faz nova subtração de restituições. Fornecedores com CNPJ aparecem pela razão social, que pode ser o nome de um empresário individual. Pessoa física sem CNPJ aparece como 'Fornecedor pessoa física'.</p>`;
  const privacidade = `<h3>Privacidade</h3><p>Contamos visitas e páginas vistas com o Cloudflare Web Analytics, sem cookies e sem identificar quem visita. Não registramos quais deputados cada pessoa consulta.</p>`;

  window.ClareiaPages = {
    CONTACT_EMAIL,
    POLICY,
    esc,
    pages: {
      sobre: {
        title: 'Sobre — Clareia',
        description: 'O que é o Clareia, de onde vêm os dados, o que o site não faz e quem o mantém.',
        body: () => `<h1>Sobre o Clareia</h1><p>O Clareia mostra as despesas da cota parlamentar (CEAP) dos deputados federais, com dados oficiais da Câmara dos Deputados. Todo número tem a página "Como chegamos nisso?", com a soma, os registros e a fonte.</p><h3>O que o Clareia não é</h3><p>Não é uma auditoria. Gasto maior não significa irregularidade. Os números mostram o que foi declarado à Câmara, e não se uma despesa era adequada.</p><h3>Quem faz</h3><p>O Clareia é um projeto independente, o Projeto Clareia.</p><h3>Cookies e cadastro</h3><p>O site não usa cookies e não pede cadastro. Veja a <a href="/metodologia">metodologia</a> para o detalhe da medição.</p><h3>Erros</h3><p>Se um dado estiver errado, veja <a href="/correcoes">como pedir uma correção</a>.</p>`
      },
      correcoes: {
        title: 'Correções — Clareia',
        description: 'Como pedir a correção de um dado do Clareia e o registro público das correções feitas.',
        body: (list, email) => `<h1>Correções</h1><h3>Como pedir uma correção</h3>${contact(email)}<h3>O que enviar</h3><ul><li>O deputado, com nome ou ID da Câmara.</li><li>O número ou o texto como aparece no site, com o link da página.</li><li>A fonte oficial que comprova o dado, como o registro na Câmara ou o arquivo CEAP.</li></ul><h3>Nosso compromisso</h3><p>${POLICY}</p><h3>Registro de correções</h3>${corrections(list)}`
      },
      metodologia: {
        title: 'Metodologia — Clareia',
        description: 'Como o Clareia soma as despesas, o que confere e o que ainda não concluímos.',
        somamos,
        conferimos,
        naoConcluimos,
        privacidade
      }
    }
  };
})();
