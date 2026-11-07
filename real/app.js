(() => {
  'use strict';
  const $=s=>document.querySelector(s);
  const money=n=>n===null?'Não informado':(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pct=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:1});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The Câmara publishes ideDocumento 0 for internal phone charges (ramal, celular funcional, linha direta): an identifier placeholder, not an amount.
  const noDocument=r=>String(r.documentId)==='0';
  const docLabel=r=>noDocument(r)?'Sem documento fiscal (código 0 na fonte)':`Documento ${esc(r.documentId)}`;
  const months=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const lower=s=>s.toLocaleLowerCase('pt-BR');
  const PALETTE=['#1d7a6e','#a8741a','#5d6470','#2f5d8a','#8a4f7d','#6b8f3a','#b5543c','#3f7f9a','#7a6a3a','#4b4b8f','#8c8c8c','#a0522d'];
  const params=new URLSearchParams(location.search);params.delete('snapshot');let data,index,base,requestId=0,trigger,totals=[];const files=new Map();
  const date=s=>new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
  const portrait=p=>p.photo?`<img src="${base}/portraits/${p.id}.jpg" alt="Retrato oficial de ${esc(p.name)}" loading="lazy">`:`<span class="initials" aria-label="${esc(p.name)} — sem retrato">${esc(p.name.split(' ').map(w=>w[0]).join('').slice(0,2))}</span>`;
  const period=f=>`${months[f.from]}${f.from!==f.to?' a '+lower(months[f.to]):''} de ${data.scope.year}`;
  let toastTimer;
  function toast(text){const t=$('#toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;t.textContent='';},3500);}
  function show(title,body){trigger=document.activeElement;$('#detail-title').textContent=title;$('#dialog-content').innerHTML=body;$('#detail').showModal();}
  $('#toast').hidden=true;
  $('#close').addEventListener('click',()=>$('#detail').close());$('#detail').addEventListener('close',()=>trigger?.focus());
  function set(values){for(const [key,value]of Object.entries(values)){if(value===null)params.delete(key);else params.set(key,String(value));}load();}
  const json=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Versão indisponível. Nenhum valor foi estimado.');return r.json();};
  async function personRecords(id){
    if(!files.has(id)){const r=await fetch(`${base}/deputados/${id}/despesas.json`);if(r.status===404)files.set(id,null);else if(r.ok)files.set(id,await r.json());else throw Error('Versão indisponível. Nenhum valor foi estimado.');}
    return files.get(id);
  }
  const filtered=()=>['from','to','category','supplier'].some(k=>params.has(k));
  async function load(){
    const id=++requestId;$('#content').setAttribute('aria-busy','true');$('#notice').textContent='Conferindo o recorte…';
    try{
      if(!index){
        const manifest=await json('/manifest.json');base='/'+manifest.base;index=await json(base+'/index.json');
        // Card totals use the same view function as the detail, over the whole published period of each person.
        totals=await Promise.all(index.scope.ids.map(async pid=>{const v=ClareiaView.personView(index,await personRecords(pid),new URLSearchParams({person:String(pid)}));return {id:pid,cents:v?v.totalCents:null};}));
      }
      const person=Number(params.get('person')||index.scope.ids[0]);
      if(!index.scope.ids.includes(person))throw Error('Este deputado não está nesta versão.');
      const records=await personRecords(person);if(id!==requestId)return;
      const result=ClareiaView.personView(index,records,params);
      if(!result)throw Error('Dados indisponíveis para este deputado nesta versão.');
      data={...result,externalReconciliation:index.audit};params.set('person',String(data.person.id));history.replaceState(null,'','/?'+params);
      render();
      $('#notice').innerHTML=`<span class="status-dot"></span> Dados oficiais · verificações automáticas concluídas <span class="checked">Versão de ${esc(date(data.publishedAt))}</span>`;
    }catch(error){if(id!==requestId)return;$('#notice').textContent=error.message;$('#content').innerHTML='<div class="empty"><h2>Este recorte não está disponível.</h2><p>Nenhum valor foi estimado. Confira a coleta ou volte ao recorte publicado.</p><a href="/">Abrir versão atual →</a></div>';for(const s of ['#people','#controls','#editorial-feature','#hero-portrait'])$(s).innerHTML='';}
    finally{if(id===requestId)$('#content').setAttribute('aria-busy','false');}
  }
  const originLabel=r=>r.origin==='api'?`Só na API (ausente do arquivo anual capturado em ${date(data.collectedAt)})`:r.origin==='annual'?'Só no arquivo anual':'Arquivo anual e API';
  let csvUrl;
  function csvHref(){
    if(csvUrl)URL.revokeObjectURL(csvUrl);csvUrl=null;
    if(!filtered())return `${base}/deputados/${data.person.id}/despesas.csv`;
    csvUrl=URL.createObjectURL(new Blob([ClareiaView.csv(data.records)],{type:'text/csv;charset=utf-8'}));return csvUrl;
  }
  function hero(d){
    const f=d.filters,first=d.person.name.split(' ')[0];
    $('#hero-portrait').innerHTML=`<span class="photo">${portrait(d.person)}</span>`;
    $('#editorial-feature').innerHTML=`<p class="eyebrow">Destaque · dados oficiais</p><strong class="feature-value" id="total">${money(d.totalCents)}</strong><p>foi o valor líquido da cota parlamentar de ${esc(d.person.name)} em ${esc(lower(period(f)))}${f.category?`, em ${esc(lower(f.category))}`:''}${f.supplier?', com o fornecedor selecionado':''}.</p><button class="text-button" data-action="evidence">Como chegamos nisso? →</button><div class="feature-switch" role="group" aria-label="Escolha quem aparece no destaque"><span>Destacar</span>${d.people.map(p=>`<button type="button" data-feature="${p.id}" aria-pressed="${p.id===d.person.id}"><span class="avatar"><span class="photo">${portrait(p)}</span></span><span>${esc(p.name.split(' ')[0])}</span></button>`).join('')}</div>`;
    $('#scope-note').textContent=`${d.people.length} deputados · ${months[d.scope.months[0]]}–${lower(months[d.scope.months.at(-1)])} de ${d.scope.year}. Amostra técnica com dados oficiais; não é ranking nacional. Destaque atual: ${first}.`;
  }
  function cards(d){
    const order=[...totals].sort((a,b)=>(b.cents??0)-(a.cents??0)),span=`${months[d.scope.months[0]]}–${lower(months[d.scope.months.at(-1)])} ${d.scope.year}`;
    $('#people').innerHTML=order.map((t,i)=>{const p=d.people.find(x=>x.id===t.id);return `<article class="rank-card editorial-card person ${p.id===d.person.id?'selected':''}"><button class="portrait-button" data-person="${p.id}" aria-pressed="${p.id===d.person.id}" aria-label="Ver os gastos de ${esc(p.name)}"><span class="photo">${portrait(p)}</span><span class="rank-number">${String(i+1).padStart(2,'0')}</span></button><div class="card-info"><h3 class="person-name">${esc(p.name)}</h3><p class="editorial-person-context">Deputado(a) federal · ID Câmara ${p.id}</p><button class="value-button" data-card="${p.id}" aria-label="${esc(p.name)}: ${money(t.cents)}. Ver os gastos">${money(t.cents)}</button><p class="card-caption">Cota parlamentar · valor líquido · ${span}</p></div></article>`;}).join('');
  }
  function controls(d){
    const f=d.filters,options=value=>d.scope.months.map(m=>`<option value="${m}" ${m===value?'selected':''}>${months[m]}</option>`).join('');
    $('#controls').innerHTML=`<div class="editorial-controls real-controls"><div class="selects"><label class="select-label">De<select id="from">${options(f.from)}</select></label><label class="select-label">Até<select id="to">${options(f.to)}</select></label><span class="real-year">${d.scope.year}</span></div><div class="real-actions"><button class="text-button" data-action="reset">Limpar recorte ↺</button><a class="outline-button" id="csv" href="${esc(csvHref())}" download="clareia-${esc(d.snapshotId.slice(0,12))}.csv">Baixar CSV ↓</a><button class="outline-button" data-action="share">Compartilhar ↗</button></div></div>`;
  }
  function spending(d){
    const f=d.filters,abs=d.categories.reduce((n,c)=>n+Math.abs(c.cents),0),color=i=>PALETTE[i%PALETTE.length];
    let start=0;const stops=d.categories.map((c,i)=>{const end=start+(abs?Math.abs(c.cents)/abs*100:0),s=`${f.category&&f.category!==c.category?'var(--line)':color(i)} ${start}% ${end}%`;start=end;return s;}).join(',');
    const maxMonth=Math.max(1,...d.months.map(m=>Math.abs(m.cents)));
    const suppliers=[...d.suppliers].sort((a,b)=>b.cents-a.cents);
    return `<section class="p-section" id="despesas"><div class="p-section-intro"><div><p class="p-kicker">Siga o dinheiro</p><h2>Gastos por categoria</h2><p class="p-description">${esc(d.person.name)} · ${esc(lower(period(f)))}. Cada categoria leva aos fornecedores e aos registros que a compõem.</p></div><span class="p-badge">Cota parlamentar</span></div>
      <div class="spending-grid"><div class="p-panel donut-panel"><div class="donut-caption"><span>Composição das despesas</span></div><div class="donut-shell"><div class="spend-donut" style="background:${abs?'conic-gradient('+stops+')':'var(--line)'}"><div class="donut-hole"><span>${esc(period(f))}</span><strong>${money(d.totalCents)}</strong><small>${d.recordCount} lançamentos</small></div></div></div>
      <div class="donut-legend"><button class="all-category" data-category="" aria-pressed="${!f.category}"><span><i style="background:var(--ink)"></i>Todas as categorias</span><strong>${money(d.categories.reduce((n,c)=>n+c.cents,0))}</strong><small></small></button>${d.categories.map((c,i)=>`<button class="category ${f.category&&f.category!==c.category?'category-muted':''}" data-category="${esc(c.category)}" aria-pressed="${c.category===f.category}" style="--cat:${color(i)}"><span><i></i>${esc(lower(c.category))}</span><strong>${money(c.cents)}</strong><small>${abs?pct(Math.abs(c.cents)/abs*100):'0'}%${c.cents<0?' · ajuste':''}</small></button>`).join('')}</div><p class="p-small">A fatia de cada categoria usa o valor absoluto; valores negativos são créditos ou ajustes registrados na origem.</p></div>
      <div class="spend-details"><div class="range-heading"><h3>Ao longo dos meses</h3><output>${esc(period(f))}</output></div><div class="p-mini-bars real-months">${d.months.map(m=>`<button data-month="${m.month}" class="included" aria-label="${months[m.month]}: ${money(m.cents)}; explorar mês"><span style="height:${Math.max(4,Math.round(Math.abs(m.cents)/maxMonth*140))}px;${m.cents<0?'background:var(--danger,#b5543c)':''}"></span><small>${months[m.month].slice(0,3)}</small><b>${money(m.cents)}</b></button>`).join('')}</div><p class="p-small">Clique no mês para abrir seu recorte.</p>
      <h3 class="supplier-heading">Quem aparece nos registros?</h3><p class="p-small">${f.category?esc(lower(f.category)):'Todas as categorias'} · ${suppliers.length} grupos/ocorrências</p><div class="supplier-list">${suppliers.map((s,i)=>`<button class="supplier ${f.supplier===s.key?'active':''}" data-supplier="${s.key}" aria-pressed="${f.supplier===s.key}"><span class="supplier-index">${String(i+1).padStart(2,'0')}</span><span>${esc(s.name)}<small>${s.count} registro(s) · ${s.verified?'agrupado pelo CNPJ informado':'ocorrência sem agrupamento de identidade'}</small></span><b>${money(s.cents)}</b>→</button>`).join('')||'<p class="p-small">Sem registros nesta seleção.</p>'}</div>${f.supplier?'<button class="p-link" data-action="clear-supplier">Ver todos os fornecedores ←</button>':''}<p class="p-small">CNPJs têm os dígitos conferidos; isso não valida a empresa ou a despesa. Fornecedor pessoa física aparece sem nome. Identificador ausente ou inválido: registros ficam separados.</p></div></div></section>`;
  }
  function recordsSection(d){
    return `<section class="p-section" id="records"><div class="p-section-intro"><div><p class="p-kicker">Confira na origem</p><h2>A conta, registro por registro</h2><p class="p-description">Abra um item para ver os valores, o endereço da fonte e o comprovante, quando informado. ${d.recordCount} registros no recorte.</p></div></div><div class="table-scroll"><table class="data-table real-records"><caption class="sr-only">Registros de ${esc(d.person.name)}</caption><thead><tr><th>Competência / documento</th><th>Fornecedor e categoria</th><th class="amount">Valor líquido</th><th>Detalhes</th></tr></thead><tbody>${d.records.map(r=>`<tr><td>${months[r.month]} / ${r.year}<small>${docLabel(r)}</small></td><td>${esc(r.supplier)}<small>${esc(lower(r.category))}</small>${r.origin?`<small>${originLabel(r)}</small>`:''}</td><td class="amount">${money(r.cents)}</td><td><button class="p-link" data-record="${r.id}" aria-label="Ver registro: ${docLabel(r)}">Conferir →</button></td></tr>`).join('')||'<tr><td colspan="4">Nenhum registro neste recorte. Isso não afirma ausência de despesas fora da cobertura.</td></tr>'}</tbody><tfoot><tr><th colspan="2">Total do recorte</th><td class="amount">${money(d.totalCents)}</td><td>${d.recordCount} itens</td></tr></tfoot></table></div></section>`;
  }
  function render(){
    const d=data;
    hero(d);cards(d);controls(d);
    $('#content').innerHTML=spending(d)+recordsSection(d);
    const compare=d.validation.apiComparison;
    if(compare?.paired!==undefined)$('#content').insertAdjacentHTML('afterbegin',`<div class="api-discrepancy"><b>De onde vêm estes registros?</b> Combinamos as duas fontes oficiais da Câmara, porque nenhuma delas está completa sozinha: ${compare.paired} registros (${money(compare.originCents.both)}) estão nas duas, ${compare.missingInApi} (${money(compare.originCents.annual)}) só no arquivo anual e ${compare.extraInApi} (${money(compare.originCents.api)}) só na API. Cada registro indica a sua fonte. <a href="#method">Entenda o recorte ↓</a></div>`);
    else if(compare?.missingInApi)$('#content').insertAdjacentHTML('afterbegin',`<div class="api-discrepancy"><b>Por que usamos o arquivo anual?</b> Nos três deputados e dois meses do piloto, o arquivo contém ${compare.annualRecords} lançamentos; a API retornou ${compare.apiRecords}. Os ${compare.missingInApi} adicionais estão incluídos aqui. ${compare.netDifferenceCents===0?'As somas líquidas coincidem.':`A soma líquida do arquivo é ${money(Math.abs(compare.netDifferenceCents))} ${compare.netDifferenceCents<0?'menor':'maior'} que a da API.`} <a href="#method">Entenda o recorte ↓</a></div>`);
    const audit=d.externalReconciliation;
    $('#provenance').innerHTML=`${audit?`<p><b>Releitura independente do arquivo anual: ${audit.status==='passed'?'sem divergências':'divergência encontrada'}</b> · mesmo CSV desta versão, lido por um parser separado; não é a comparação com a API · ${audit.selected} linhas · ${audit.groupsCompared} grupos pessoa/mês/categoria · ${date(audit.checkedAt)} (Brasília).</p>`:''}<dl><dt>Versão</dt><dd><code>${d.snapshotId}</code></dd><dt>Métrica</dt><dd><code>${esc(d.metric)}</code></dd><dt>Registros coletados nesta versão</dt><dd>${date(d.collectedAt)} (Brasília)</dd><dt>Versão publicada</dt><dd>${date(d.publishedAt)} (Brasília)</dd></dl><ul>${d.validation.limitations.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`;
  }
  document.addEventListener('change',e=>{if(e.target.id==='from'||e.target.id==='to'){const month=Number(e.target.value);let from=data.filters.from,to=data.filters.to;if(e.target.id==='from'){from=month;to=Math.max(to,from);}else{to=month;from=Math.min(from,to);}set({from,to,supplier:null,category:null});}});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||!data)return;
    const pick=b.dataset.person||b.dataset.feature||b.dataset.card;
    if(pick){set({person:pick,category:null,supplier:null});if(!b.dataset.feature)$('#hero').scrollIntoView({block:'start'});return;}
    if(b.dataset.month){set({from:b.dataset.month,to:b.dataset.month,category:null,supplier:null});return;}
    if('category'in b.dataset){set({category:b.dataset.category||null,supplier:null});return;}
    if(b.dataset.supplier){set({supplier:b.dataset.supplier});return;}
    if(b.dataset.record){const r=data.records.find(r=>r.id===b.dataset.record),api=r.origin==='api';show('O registro por trás do valor',`<p class="records-note">${esc(data.person.name)} · ${months[r.month]} / ${r.year}</p><h3>${esc(r.supplier)}</h3><p>${esc(r.category)}</p>${r.origin?`<p class="small">Fonte: ${originLabel(r)}</p>`:''}${r.documentCents!==null&&r.disallowedCents!==null&&r.documentCents-r.disallowedCents===r.cents?`<div class="formula"><span>Documento <b>${money(r.documentCents)}</b></span><span>− Glosa <b>${money(r.disallowedCents)}</b></span><span>= Líquido <b>${money(r.cents)}</b></span></div>`:`<div class="formula" data-equation="none"><span>Valor do documento <b>${money(r.documentCents)}</b></span><span>Glosa <b>${money(r.disallowedCents)}</b></span><span>Valor líquido <b>${money(r.cents)}</b></span></div><p class="small">A fonte não informa todos os campos da conta documento − glosa. O valor líquido é o publicado pela Câmara, sem recálculo.${r.cents<0?' Valor negativo: ajuste registrado na origem.':''}</p>`}<p>${docLabel(r)} · número ${esc(r.documentNumber)}<br>${noDocument(r)?'<span class="small">Cobrança interna de telefonia da Câmara. O "0" é o identificador de documento publicado na fonte, não um valor: o valor do lançamento é o líquido acima.</span><br>':''}Emissão informada: ${esc(r.date||'Não informada')}</p><div class="action-row"><a class="outline-button primary" href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${api?'Abrir consulta oficial da API':'Baixar arquivo oficial'} ↗</a>${r.receipt?`<a class="outline-button" href="${esc(r.receipt)}" target="_blank" rel="noopener noreferrer">Comprovante informado ↗</a>`:'<span class="small">Comprovante não informado na fonte.</span>'}</div><p class="small">O link do comprovante foi informado pela Câmara; sua disponibilidade e autenticidade não foram auditadas pelo Clareia.</p><details><summary>Rastreabilidade deste item</summary><dl><dt>Coleta</dt><dd>${date(r.source.fetchedAt)} (Brasília)</dd><dt>${api?'Posição na página da API (base zero)':'Posição no CSV, sem cabeçalho (base zero)'}</dt><dd>${r.source.row}</dd><dt>${api?'SHA-256 da página preservada':'SHA-256 do CSV preservado'}</dt><dd><code>${r.source.sha256}</code></dd><dt>ID desta ocorrência</dt><dd><code>${r.id}</code></dd></dl></details>`);return;}
    switch(b.dataset.action){
      case'reset':set({from:null,to:null,category:null,supplier:null});break;
      case'clear-supplier':set({supplier:null});break;
      case'share':try{await navigator.clipboard.writeText(location.href);toast('Link copiado com os filtros.');}catch{show('Copie esta investigação',`<input aria-label="Link desta investigação" readonly value="${esc(location.href)}">`);}break;
      case'evidence':{const union=data.validation.sourceKind==='annual-api-union';show('Como chegamos nisso?',`<p class="records-note">${esc(data.person.name)} · ${months[data.filters.from]} a ${months[data.filters.to]} / ${data.scope.year}</p><div class="calculation-result">${money(data.totalCents)}<small>Soma exata dos lançamentos do recorte</small></div><p>Soma de <b>${data.recordCount} lançamentos</b> ${union?'do arquivo anual e da API da Câmara':'do arquivo anual'}, após os filtros de pessoa, competência, categoria e fornecedor. Cada valor foi convertido em centavos antes da soma.</p><ol><li>Identidade ligada ao ID oficial da Câmara ${data.person.id}.</li><li>${union?'Duas capturas de cada fonte comparadas':'Duas capturas do arquivo anual comparadas'}, com todas as linhas selecionadas pelo ID e competência.</li><li>Documento − glosa conferido onde ambos são informados; total líquido reconciliado com cálculo independente e SQL.</li></ol><p><b>Limite:</b> verificações automáticas não são auditoria do gasto. ${union?'Nenhuma das duas fontes está completa sozinha; cada registro indica a sua.':'O arquivo anual contém registros que a API não retornou neste recorte.'} Revisão humana ampla ainda pende.</p><a class="p-link" href="${esc($('#csv').getAttribute('href'))}" download="clareia-${esc(data.snapshotId.slice(0,12))}.csv">Baixar os registros deste cálculo ↓</a><p class="small">Versão ${data.snapshotId.slice(0,12)} · ${esc(data.metric)}</p>`);break;}
    }
  });
  load();
})();
