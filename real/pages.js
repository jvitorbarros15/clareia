/* Textos das páginas Sobre, Correções e Metodologia. Lido pelo navegador e por src/prerender.ts (via vm), para que o texto exista em um só lugar. */
(() => {
  'use strict';
  const CONTACT_EMAIL = '';
  const POLICY = 'Respondemos em até 5 dias úteis. Toda correção vira uma nova versão dos dados, com registro público do que mudou e quando.';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : esc(value);
  const contact = (email = CONTACT_EMAIL) => email ? `<p>Escreva para <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : '<p>Canal de correções em configuração.</p>';
  const corrections = (list = []) => list.length ? `<table class="doc-table"><thead><tr><th scope="col">Data</th><th scope="col">O que mudou</th></tr></thead><tbody>${list.map(e => `<tr><td><time datetime="${esc(e.date)}">${dateBR(e.date)}</time></td><td><strong>${esc(e.title)}</strong>. ${esc(e.detail)}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhuma correção registrada até agora.</p>';
  const RAYS = '<svg class="doc-rays" viewBox="322 88 140 150" aria-hidden="true" focusable="false"><path pathLength="1" d="m330 149 12-53"/><path pathLength="1" d="m376 170 34-42"/><path pathLength="1" d="m404 209 48-19"/></svg>';
  const NAV = [['sobre', 'Sobre'], ['correcoes', 'Correções'], ['metodologia', 'Metodologia']];
  const layout = (name, eyebrow, title, lede, inner, toc = '') => `<div class="doc"><div class="doc-side"><nav class="doc-nav" aria-label="Páginas do projeto">${NAV.map(([key, label]) => `<a href="/${key}"${key === name ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>${toc}</div><article class="doc-main"><header class="doc-head">${RAYS}<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="doc-lede">${lede}</p></header>${inner}</article></div>`;
  const sections = html => { const items = []; const out = html.replace(/<h3>(.*?)<\/h3>/g, (_, text) => { const id = `s${items.length + 1}`; items.push(`<li><a href="#${id}">${text}</a></li>`); return `<h2 id="${id}">${text}</h2>`; }); return { html: out, toc: `<nav class="doc-toc" aria-label="Nesta página"><p class="eyebrow">Nesta página</p><ol>${items.join('')}</ol></nav>` }; };

  const somamos = union => `<h3>O que somamos</h3><p>O valor líquido publicado pela Câmara, por competência financeira: o campo <code>vlrLiquido</code> do arquivo anual CEAP${union ? ' e, nos registros que só a API traz, o <code>valorLiquido</code> da API' : ''}. Salário, gabinete e emendas não entram nesta conta.</p>`;
  const conferimos = extra => `<h3>O que conferimos</h3><p>Duas capturas de cada fonte, identidade pelo ID oficial e contas em centavos, reconciliadas com uma segunda soma e com o banco.${extra}</p>`;
  const naoConcluimos = `<div class="doc-callout"><h3>O que não concluímos</h3><p>Gasto maior não demonstra irregularidade. O recorte não mede qualidade do mandato nem faz nova subtração de restituições. Fornecedores com CNPJ aparecem pela razão social, que pode ser o nome de um empresário individual. Pessoa física sem CNPJ aparece como 'Fornecedor pessoa física'.</p></div>`;
  const privacidade = `<h3>Privacidade</h3><p>Contamos visitas e quantas vezes cada página foi vista, inclusive as páginas de deputados, com o Cloudflare Web Analytics, sem cookies e sem identificar quem visita. Não sabemos quem viu qual página.</p>`;

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
