(() => {
  'use strict';
  const C = window.Clareia;
  const { compact, money, number, escape: esc, icon } = C;
  const $ = s => document.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const months = window.ClareiaData.monthNames;
  const COVER = window.ClareiaData.coverage.at(-1) + 1;
  // Twelve hues far apart in tone and lightness, so neighbouring slices never look alike.
  const PALETTE = ['#1d7a6e','#c2731a','#3b5bdb','#8a4f7d','#5d6470','#7a9a2e','#b5443c','#2f8fb0','#a8741a','#6a4fb3','#9a9a9a','#d4a72c'];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { C.toast('O navegador não permitiu salvar. A seleção continua disponível nesta visita.'); } };
  const state = {
    highlightCategory: null, month: COVER, mapUF: null, mapMetric: 'total', from: 1, to: COVER, a: C.byTotal()[0].id, b: C.byTotal()[1].id, topic: 'Todos', stage: 'Todos', projectQuery: '', voter: C.byTotal()[0].id, timeline: C.byTotal()[0].id, rosterQuery: '', rosterUF:'Todos', rosterParty:'Todos',
    favorites: new Set((Array.isArray(read('clareia-favorites', [])) ? read('clareia-favorites', []) : []).filter(id => C.person(id))),
    projects: new Set((Array.isArray(read('clareia-projects', [])) ? read('clareia-projects', []) : []).filter(id => ['01', '02', '03', '04'].includes(id))),
    motion: !reduced.matches
  };
  const UF = {
    AC: ['Acre',2,2], RO:['Rondônia',4,2], AM:['Amazonas',3,1], RR:['Roraima',4,0], PA:['Pará',5,1], AP:['Amapá',6,0],
    MT:['Mato Grosso',3,3], TO:['Tocantins',6,2], MA:['Maranhão',7,1], PI:['Piauí',8,2], CE:['Ceará',9,1], RN:['Rio Grande do Norte',11,1],
    PB:['Paraíba',12,2], PE:['Pernambuco',10,2], AL:['Alagoas',11,3], SE:['Sergipe',9,3], BA:['Bahia',7,3], GO:['Goiás',5,3], DF:['Distrito Federal',6,4],
    MS:['Mato Grosso do Sul',4,4], MG:['Minas Gerais',8,4], ES:['Espírito Santo',10,4], SP:['São Paulo',7,5], RJ:['Rio de Janeiro',9,5],
    PR:['Paraná',5,5], SC:['Santa Catarina',6,6], RS:['Rio Grande do Sul',5,7]
  };
  const projects = [], votes = [];
  const color = ['var(--accent)','#c2731a','var(--chart3)'];
  const lab = C.label;
  const catText = category => category === 'Todas' ? 'todas as categorias' : lab(category);
  const scopePeople = () => C.all().filter(p => C.state.uf === 'Brasil' || p.uf === C.state.uf);
  const scopeRecords = () => scopePeople().flatMap(p => C.records(p).filter(r => r.month < state.month).map(r => ({...r,person:p.name,idPerson:p.id})));
  const badge = text => `<span class="p-badge">${text}</span>`;
  const editorial = C.model === 'editorial';
  // Every one of these opens a panel on this page, so the editorial uses a plain arrow, not the external-link mark.
  const ext = () => icon(editorial ? 'arrow' : 'external');
  const label = (n, text) => editorial ? `<p class="p-kicker">${text}</p>` : `<p class="p-kicker"><span>${n}</span> ${text}</p>`;
  const directTitle = {'Um total. Muitas histórias.':'Gastos por categoria','O Brasil, mais perto.':'Representantes por estado','Lado a lado. Sem atalhos.':'Comparar dois representantes','Ideias em movimento.':'Projetos de lei','Como decidiram?':'Votações','Um mandato tem muitas dimensões.':'O que ainda não cobrimos','Acompanhe o que muda.':'Acompanhar'};
  const intro = (n, eyebrow, title, description, extra = '') => `<div class="p-section-intro"><div>${label(n,eyebrow)}<h2>${editorial&&directTitle[title]||title}</h2><p class="p-description">${description}</p></div>${extra}</div>`;
  const peopleOptions = selected => C.all().map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${p.name} · ${p.uf}</option>`).join('');
  function followButton(id, full = false) { const on=state.favorites.has(id); return `<button class="follow-button ${on?'is-following':''}" data-p-follow="${id}" aria-pressed="${on}" aria-label="${on?'Deixar de acompanhar':'Acompanhar'} ${C.person(id).name}"><svg class="heart" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg>${full ? on?'Acompanhando':'Acompanhar':''}</button>`; }
  function scopeText() { const n=scopePeople().length; return `Amostra · ${n} ${n===1?'deputado':'deputados'}${C.state.uf==='Brasil'?'':' · '+UF[C.state.uf][0]} · ${C.span()} · ${catText(C.state.category)}`; }
  // The spending panel follows its month slider; everywhere else the period is the published coverage.
  const periodText = () => state.month>=COVER ? C.span() : `${months[window.ClareiaData.coverage[0]]}–${months[state.month-1]} ${C.state.year}`;
  function overview() {
    const people = scopePeople();
    const total = C.sum(people.flatMap(C.records));
    if (editorial) {
      const n=people.length, recs=people.flatMap(C.records).length;
      const stat=(key,value,text,format='number')=>{const final=format==='money'?compact(value):number(value);return `<button class="p-stat" data-p-summary="${key}" aria-label="${final} ${text}"><strong data-counter="${value}" data-format="${format}" aria-hidden="true">${final}</strong> <span aria-hidden="true">${text}</span></button>`;};
      return `<div class="p-overview-head"><h2 class="p-overview-title">Panorama da amostra</h2><span>${scopeText()}</span></div><p class="p-overview-sentence">Neste recorte, ${stat('people',n,n===1?'deputado':'deputados')} ${n===1?'soma':'somam'} ${stat('expenses',total,'em reembolsos','money')}, distribuídos em ${stat('records',recs,'registros')}, e ${n===1?'teve':'tiveram'} ${stat('coverage',people[0]?people[0].months:0,'meses publicados')} (${C.span()}). Projetos de lei ainda não foram coletados.</p>`;
    }
    return `<div class="p-overview-head">${editorial?'<h2 class="p-overview-title">Panorama da amostra</h2>':label('01','Panorama da amostra')}<span>${scopeText()}</span></div><div class="p-stats">${[
      ['Pessoas no recorte',people.length,'perfis para conhecer','people'],
      ['Reembolsos da cota',total,'registros que você pode conferir','expenses'],
      
      ['Registros de despesa',people.flatMap(C.records).length,'registros oficiais nesta versão','records']
    ].map(([title,value,detail,key])=>`<button class="p-stat" data-p-summary="${key}"><span class="p-stat-label">${title} ${ext()}</span><strong>${key==='expenses'?compact(value):number(value)}</strong><span class="p-stat-detail">${detail}</span></button>`).join('')}</div>`;
  }
  function donutChart(groups, total, highlighted) {
    const positiveTotal = C.shareBase(groups);
    const negativeTotal = groups.reduce((sum,g) => sum + Math.min(0,g.value), 0);
    const valid = positiveTotal > 0;
    const shareLabel = 'das despesas positivas';
    let angle = -Math.PI / 2;
    const point = (r, a) => `${100 + r * Math.cos(a)} ${100 + r * Math.sin(a)}`;
    const slices = valid ? groups.filter(g => g.value > 0).map(g => {
      const sweep = g.value / positiveTotal * Math.PI * 2, end = angle + sweep;
      const attrs = `class="donut-segment ${highlighted && highlighted !== g.name ? 'is-dimmed' : ''}" data-donut-slice data-p-highlight="${esc(g.name)}" data-label="${esc(lab(g.name))}" data-detail="${esc(money(g.value))} · ${C.share(g.value, positiveTotal)} ${shareLabel}" tabindex="-1" role="button" aria-pressed="${highlighted === g.name}" aria-label="${esc(lab(g.name))}: ${esc(money(g.value))}, ${C.share(g.value, positiveTotal)} ${shareLabel}. Selecionar categoria."`;
      const shape = sweep >= Math.PI * 2 - 1e-9
        ? `<circle ${attrs} cx="100" cy="100" r="90" fill="none" stroke="${g.color}" stroke-width="16"/>`
        : `<path ${attrs} fill="${g.color}" d="M ${point(98,angle)} A 98 98 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(98,end)} L ${point(82,end)} A 82 82 0 ${sweep > Math.PI ? 1 : 0} 0 ${point(82,angle)} Z"/>`;
      angle = end;
      return shape;
    }).join('') : '';
    const selected = groups.find(g => g.name === highlighted);
    return `<div class="donut-shell"><div class="spend-donut interactive-donut"><svg class="donut-svg" viewBox="0 0 200 200" role="group" aria-label="Composição das despesas. Selecione uma fatia ou use a legenda."><circle cx="100" cy="100" r="90" fill="none" stroke="var(--line)" stroke-width="16"/>${slices}</svg><div class="donut-hole">${selected && selected.value > 0 ? `<span>${esc(lab(selected.name))}</span><strong class="is-exact">${money(selected.value)}</strong><small>${C.share(selected.value, positiveTotal)} ${shareLabel}</small>` : `<span>${periodText()}</span><strong>${compact(total)}</strong><small>${negativeTotal < 0 ? 'reembolsos líquidos' : 'reembolsos no recorte'}</small>`}</div></div></div>${negativeTotal < 0 ? `<p class="donut-adjustment">Ajustes negativos de ${money(negativeTotal)} não entram nas fatias. As fatias somam ${money(positiveTotal)} em categorias positivas; o total líquido ao centro já desconta os ajustes.</p>` : ''}<div class="donut-readout" aria-live="polite"><strong>${selected ? esc(lab(selected.name)) : valid ? 'Explore as categorias' : 'Composição indisponível'}</strong><span>${selected ? `${money(selected.value)} · ${selected.value < 0 ? 'ajuste negativo' : `${C.share(selected.value, positiveTotal)} ${shareLabel}`}` : valid ? 'Selecione uma fatia ou uma linha da legenda.' : 'Consulte a legenda: o recorte está vazio ou contém ajustes negativos.'}</span></div>`;
  }
  function previewDonut(category) {
    const panel = $('.donut-panel');
    if (!panel) return;
    const slices = [...panel.querySelectorAll('[data-donut-slice]')];
    const legend = [...panel.querySelectorAll('.donut-legend [data-p-highlight]')];
    const selected = legend.find(s => s.getAttribute('aria-pressed') === 'true');
    const name = category || selected?.dataset.pHighlight;
    const active = slices.find(s => s.dataset.pHighlight === name) || legend.find(s => s.dataset.pHighlight === name);
    slices.forEach(s => {
      s.classList.toggle('is-preview', s.dataset.pHighlight === active?.dataset.pHighlight);
      s.classList.toggle('is-dimmed', Boolean(active && s.dataset.pHighlight !== active.dataset.pHighlight));
    });
    panel.querySelectorAll('.donut-legend [data-p-highlight]').forEach(b => b.classList.toggle('is-preview', b.dataset.pHighlight === active?.dataset.pHighlight));
    if (!slices.length && !active) return;
    panel.querySelector('.donut-readout strong').textContent = active ? active.dataset.label : 'Explore as categorias';
    panel.querySelector('.donut-readout span').textContent = active ? active.dataset.detail : 'Selecione uma fatia ou uma linha da legenda.';
  }
  function spending() {
    const entries=scopeRecords(), total=C.sum(entries);
    const groups=window.ClareiaData.categories.map((name,i)=>({name,color:PALETTE[i%PALETTE.length],value:C.sum(entries.filter(r=>r.category===name))}));
    if(editorial)groups.sort((a,b)=>b.value-a.value);
    const positiveTotal = C.shareBase(groups);
    const shareLabel = 'das despesas positivas';
    // A category excluded by the filter is not zero; say so instead of printing R$ 0.
    const out=g=>editorial&&C.state.category!=='Todas'&&g.name!==C.state.category;
    const rovingName = (groups.find(g=>g.name===state.highlightCategory&&!out(g))||groups.find(g=>!out(g)))?.name;
    const highlighted = editorial && groups.some(g=>g.name===state.highlightCategory && !out(g)) ? state.highlightCategory : null;
    const monthRows=months.map((_,i)=>scopePeople().flatMap(C.records).filter(r=>r.month===i)), monthTotals=monthRows.map(C.sum), maxMonth=Math.max(1,...monthTotals);
    const monthPart=i=>C.sum(monthRows[i].filter(r=>r.category===highlighted));
    // One row per supplier inside each category: a category total is never shown next to a single supplier's name.
    const suppliers=groups.filter(g=>!out(g)).flatMap(g=>{const rows=entries.filter(r=>r.category===g.name);return [...new Set(rows.map(r=>r.supplier))].map(name=>({name,category:g.name,value:C.sum(rows.filter(r=>r.supplier===name))})).sort((a,b)=>b.value-a.value);});
    return `${intro('02','Siga o dinheiro','Um total. Muitas histórias.','Arraste o período e veja de que é feita a conta. Cada categoria leva aos registros que a compõem.',badge('Cota parlamentar'))}
      <div class="spending-grid"><div class="p-panel donut-panel"><div class="donut-caption"><span>Composição das despesas</span><button data-p="spend-evidence" aria-label="Como calculamos as despesas">${editorial?'Como chegamos nisso? →':icon('info')}</button></div>${donutChart(groups,total,highlighted)}<div class="donut-legend">${groups.map(g=>`<button ${editorial ? `data-p-highlight="${esc(g.name)}" data-label="${esc(lab(g.name))}" data-detail="${esc(money(g.value))} · ${g.value < 0 ? 'ajuste negativo' : `${C.share(g.value, positiveTotal)} ${shareLabel}`}" aria-pressed="${highlighted===g.name}" tabindex="${g.name===rovingName?0:-1}" ${out(g)?'disabled':''}` : `data-p-category="${esc(g.name)}"`} style="--cat:${g.color}" class="${highlighted && highlighted!==g.name?'category-muted':''}"><span><i></i><span class="legend-name">${esc(lab(g.name))}${g.value<0?`<em>ajuste de ${money(g.value)}, fora das fatias</em>`:''}</span></span>${out(g)?'<strong class="is-out">fora do filtro</strong><small></small>':`<strong>${compact(g.value)}</strong><small>${g.value < 0 ? 'ajuste' : C.share(g.value, positiveTotal)}</small>`}</button>`).join('')}</div></div>
      <div class="spend-details">${COVER<3?`<div class="range-heading"><h3>Por mês · ${C.span()}</h3></div>`:`<div class="range-heading"><h3>Explore o ano</h3><output for="spend-range">Jan → ${months[state.month-1]}</output></div><label class="sr-only" for="spend-range">Último mês incluído nas despesas</label><input id="spend-range" class="month-range" type="range" min="1" max="${COVER}" value="${state.month}" aria-valuetext="Janeiro a ${months[state.month-1]} de ${C.state.year}"><div class="month-markers">${months.slice(0,COVER).map(m=>`<span>${m}</span>`).join('')}</div>`}
      <div class="p-mini-bars">${months.slice(0,COVER).map((m,i)=>{const value=monthTotals[i];return `<button data-p-month="${i+1}" class="${i<state.month?'included':''}" aria-label="Incluir até ${m}: ${money(value)} no mês${highlighted?', sendo '+money(monthPart(i))+' em '+esc(highlighted):''}"><span style="--height:${Math.max(2,value/maxMonth*100)}%;${highlighted?'background:var(--line)':''}">${highlighted?`<i class="category-bar-part" style="height:${value?monthPart(i)/value*100:0}%;background:${groups.find(g=>g.name===highlighted).color}"></i>`:''}</span><small>${m[0]}</small></button>`;}).join('')}</div>
      ${editorial?`<div class="category-focus" aria-live="polite">${highlighted?`<p><strong>${esc(lab(highlighted))}</strong>: ${compact(groups.find(g=>g.name===highlighted).value)} · ${groups.find(g=>g.name===highlighted).value<0?'ajuste negativo, fora das fatias.':`${C.share(groups.find(g=>g.name===highlighted).value, positiveTotal)} das despesas positivas (${periodText()}).`}</p><p class="p-small">A cor destaca a parcela da categoria. O total e a escala permanecem iguais.</p><button class="p-link" data-p-drill="${esc(highlighted)}">Ver fornecedores de ${esc(lab(highlighted))} →</button><button class="category-clear" data-p="clear-highlight">Limpar destaque</button>`:''}</div>`:''}<h3 class="supplier-heading">Fornecedores das despesas reembolsadas</h3><p class="p-small">Fornecedores nos registros oficiais selecionados. Fornecedor pessoa física aparece sem nome.</p><div class="supplier-list">${(state.allSuppliers?suppliers:suppliers.slice(0,8)).map((s,i)=>`<button data-p-supplier="${esc(s.name)}" data-category="${esc(s.category)}" class="${highlighted && highlighted!==s.category?'category-muted':''}" ${highlighted===s.category?'data-highlighted="true"':''}><span class="supplier-index">${String(i+1).padStart(2,'0')}</span><span>${esc(s.name)}<small>${esc(lab(s.category))}</small></span><b>${compact(s.value)}</b>${ext()}</button>`).join('')||'<p class="p-small">Sem registros neste recorte.</p>'}</div>${suppliers.length>8?`<button class="p-link" data-p="all-suppliers">${state.allSuppliers?'Mostrar só os 8 maiores':`Ver todos os ${suppliers.length} fornecedores`} →</button>`:''}<button class="p-link" data-p="spend-evidence">Como chegamos nisso? ${ext()}</button><p class="p-small">${scopeText()} · não inclui salários, gabinete ou emendas.</p></div></div>`;
  }
  // Packed hex grid: c counts half-tile steps so rows interlock; neighbours sit roughly where they are on the map.
  function tileMap() {
    const max=Math.max(1,...Object.keys(UF).map(mapValue).filter(v=>v!==null));
    // Same packed layout as before; slightly longer steps leave an even gap between tiles.
    return `<svg class="uf-map" viewBox="0 0 410 384" role="group" aria-label="Mapa esquemático das 27 unidades federativas, não geográfico">${Object.entries(UF).map(([uf,[name,c,r]])=>{
      const x=10+c*28.5,y=10+r*44, available=C.all().some(p=>p.uf===uf), value=mapValue(uf);
      return `<g role="button" tabindex="0" data-p-uf="${uf}" aria-label="${name}${available?' — '+mapFormat(value):' — sem dados nesta amostra'}" aria-pressed="${state.mapUF===uf}" class="uf-tile ${available?'has-data':''} ${available&&value/max>.55?'strong':''} ${state.mapUF===uf?'selected':''}" transform="translate(${x} ${y})"><path style="${available?'fill:var(--accent);fill-opacity:'+(.2+.8*value/max):''}" d="M0 12 25 0 50 12 50 40 25 52 0 40Z"/><text x="25" y="${available?25:31}" text-anchor="middle">${uf}</text>${available?`<text class="tile-value" x="25" y="38" text-anchor="middle">${esc(tileValue(value))}</text>`:''}<title>${name}${available?' · '+mapFormat(value):' · sem dados'}</title></g>`;
    }).join('')}</svg>`;
  }
  const tileValue=v=>compact(v).replace(/^R\$\s/,'');
  function mapValue(uf) {
    const people=C.all().filter(p=>p.uf===uf);
    if(!people.length)return null;
        const total=C.sum(people.flatMap(C.records));
    return state.mapMetric==='average'?total/people.length:total;
  }
  function mapFormat(value) {return state.mapMetric==='projects'?number(value)+' projetos':money(value);}
  function mapControls() {
    return `<div class="map-metrics"><label>Colorir por<select id="map-metric"><option value="total" ${state.mapMetric==='total'?'selected':''}>Total de reembolsos</option><option value="average" ${state.mapMetric==='average'?'selected':''}>Reembolsos por representante</option></select></label><p class="p-small">Mais intenso = maior valor nesta amostra. Ausência de dados tem preenchimento distinto. Despesas: categoria global selecionada. ${C.span()}.</p><button class="p-link" data-p="map-evidence">Como chegamos nisso? →</button></div>`;
  }
  // Hit areas for every person go first, under all visible points: a large target must never cover another person's point.
  function linkedChart() {
    const cov=window.ClareiaData.coverage, people=[...new Set([state.a,state.b])].map(C.person), start=state.from-1,end=state.to-1;
    const value=(p,i)=>i<p.months?C.sum(C.records(p).filter(r=>r.month===i)):null;
    const max=Math.max(1,...people.flatMap(p=>cov.map(i=>value(p,i))).filter(v=>v!==null));
    // The x domain is the published coverage; value labels sit in a left gutter and series names at the right end, outside the plot.
    const X0=124,X1=570,PAD=36,y=v=>215-v/max*175;
    const x=i=>cov.length<2?(X0+X1)/2:X0+PAD+cov.indexOf(i)*((X1-X0-2*PAD)/(cov.length-1));
    const ends=people.map(p=>{const vals=cov.map(i=>value(p,i)),last=vals.findLastIndex(v=>v!==null);return last<0?null:y(vals[last]);});
    if(ends.length===2&&ends[0]!==null&&ends[1]!==null&&Math.abs(ends[0]-ends[1])<22){const mid=(ends[0]+ends[1])/2,upper=ends[0]<=ends[1];ends[0]=mid+(upper?-12:12);ends[1]=mid+(upper?12:-12);}
    const band=cov.length>=3?`<rect x="${x(cov[start])-18}" y="22" width="${x(cov[end])-x(cov[start])+36}" height="196" fill="var(--accent)" opacity=".08"/>`:'';
    return `<div class="linked-chart-body${cov.length>4?' is-year':''}"><p class="records-note">${months[start]}–${months[end]} ${C.state.year} · ${catText(C.state.category)} · valores mensais absolutos. O recorte abaixo não altera os totais do período acima.</p><svg class="linked-lines" viewBox="0 0 760 255" role="group" aria-label="Comparação mensal; pontos abrem os registros">${band}${[0,.5,1].map(f=>`<line x1="${X0}" x2="${X1}" y1="${y(max*f)}" y2="${y(max*f)}" stroke="var(--line)"/><text class="y-tick" x="${X0-10}" y="${y(max*f)+5}" text-anchor="end">${compact(max*f)}</text>`).join('')}${people.flatMap(p=>cov.map(i=>{const v=value(p,i);return v===null?'':`<circle class="chart-hit" aria-hidden="true" cx="${x(i)}" cy="${y(v)}" r="22" fill="transparent"/>`;})).join('')}${people.map((p,j)=>{const vals=cov.map(i=>value(p,i));return `<path fill="none" pointer-events="none" stroke="${color[j]}" stroke-width="3" d="${vals.map((v,k)=>v===null?'':`${k?'L':'M'}${x(cov[k])} ${y(v)}`).join(' ')}"/>${ends[j]===null?'':`<text class="line-label" pointer-events="none" x="${X1+14}" y="${ends[j]+5}" text-anchor="start" style="fill:${color[j]}">${p.name.split(' ')[0]}</text>`}${vals.map((v,k)=>v===null?'':`<circle class="chart-point" role="button" tabindex="0" data-action="month" data-id="${p.id}" data-month="${cov[k]}" cx="${x(cov[k])}" cy="${y(v)}" r="5" fill="${color[j]}" opacity="${cov[k]>=start&&cov[k]<=end?1:.25}" aria-label="${p.name}, ${months[cov[k]]}: ${money(v)}. Abrir registros"><title>${p.name} · ${months[cov[k]]} · ${money(v)}</title></circle>`).join('')}`;}).join('')}${cov.map(i=>`<text class="x-label" x="${x(i)}" y="242" text-anchor="middle">${months[i]}</text>`).join('')}</svg><div class="linked-totals">${people.map((p,j)=>{const rows=C.records(p).filter(r=>r.month>=start&&r.month<=end);return `<div style="border-color:${color[j]}"><b>${p.name}</b><strong>${money(C.sum(rows))}</strong><small>${rows.length} registros no período selecionado · ${p.months} meses no recorte</small></div>`;}).join('')}</div><details><summary>Ver dados em tabela</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Mês</th>${people.map(p=>`<th>${p.name}</th>`).join('')}</tr></thead><tbody>${cov.filter(i=>i>=start&&i<=end).map(i=>`<tr><th>${months[i]}</th>${people.map(p=>`<td>${value(p,i)===null?'Fora do recorte':money(value(p,i))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details><p class="p-small">Clique em um ponto para conferir os registros. Uma variação não prova irregularidade. Fora do recorte é diferente de gasto zero.</p></div>`;
  }
  function linkedExplorer() {
    const ranges=COVER<3?'':`<div class="linked-ranges"><label>De <output id="linked-from-label">${months[state.from-1]}</output><input id="linked-from" type="range" min="1" max="${COVER}" value="${state.from}" aria-label="Mês inicial da comparação"></label><label>Até <output id="linked-to-label">${months[state.to-1]}</output><input id="linked-to" type="range" min="1" max="${COVER}" value="${state.to}" aria-label="Mês final da comparação"></label></div>`;
    return `<div class="linked-explorer"><h3>O que mudou mês a mês?</h3><p class="p-small">As duas pessoas escolhidas acima alimentam este gráfico.</p>${ranges}<div id="linked-result">${linkedChart()}</div></div>`;
  }
  function atlasDetail() {
    if(!state.mapUF)return `<p class="p-kicker">Brasil</p><h3>Escolha um estado.</h3><p class="p-small">Toque num estado do mapa, ou use a lista, para conhecer os deputados dele nesta amostra. A UF indica o estado de representação, não o local onde a despesa ocorreu.</p>`;
    const ppl=C.all().filter(p=>p.uf===state.mapUF), total=C.sum(ppl.flatMap(C.records));
    return `<p class="p-kicker">${state.mapUF} / ${UF[state.mapUF][0]}</p><h3>${ppl.length?'Conheça quem está no seu recorte.':'Ainda não há dados nesta amostra.'}</h3><p class="p-small">A UF indica o estado de representação. Não é o local onde a despesa ocorreu.</p>
      ${ppl.length?`<div class="atlas-numbers"><div><strong>${ppl.length}</strong><span>${ppl.length===1?'deputado nesta amostra':'deputados nesta amostra'}</span></div><div><strong>${mapFormat(mapValue(state.mapUF))}</strong><span>${state.mapMetric==='projects'?'projetos apresentados':state.mapMetric==='average'?'cota por representante':'cota total'} · ${C.span()}${editorial&&state.mapMetric!=='projects'?' · valor exato':''}</span></div></div><div class="atlas-people">${ppl.map(p=>`<div>${C.avatar(p)}<button data-action="profile" data-id="${p.id}"><b>${p.name}</b><small>Deputado(a) federal · ${p.uf}</small></button>${followButton(p.id)}</div>`).join('')}</div><button class="p-primary" data-p="apply-state">Explorar ${UF[state.mapUF][0]} ${icon('arrow')}</button>`:`<div class="map-empty">${icon('database')}<p>Indisponível não significa zero.</p><span>Nenhum deputado desta amostra representa este estado.</span></div>`}`;
  }
  function atlas() {
    return `${intro('03','Atlas de representantes','O Brasil, mais perto.','Escolha um estado. Descubra as pessoas por trás dos números e leve o recorte para o restante da página.',badge(`27 UFs · ${new Set(C.all().map(p=>p.uf).filter(Boolean)).size} com deputados nesta amostra`))}<div class="atlas-grid"><div class="map-canvas"><div class="map-topline"><span>BRASIL / UNIDADES FEDERATIVAS</span><button data-p="map-reset">Visão inicial ↺</button></div>${mapControls()}${tileMap()}<div class="map-key"><span><i class="filled"></i>Com amostra</span><span><i></i>Sem dados</span></div><p class="p-small">Mapa esquemático por UF, não geográfico.</p><label class="map-select">Escolher estado<select id="map-select"><option value="" ${state.mapUF?'':'selected'}>Escolha um estado</option>${Object.entries(UF).sort((a,b)=>a[1][0].localeCompare(b[1][0],'pt-BR')).map(([uf,[name]])=>`<option value="${uf}" ${state.mapUF===uf?'selected':''}>${name}</option>`).join('')}</select></label></div><div class="atlas-detail" id="atlas-detail" aria-live="polite">${atlasDetail()}</div></div>`;
  }
  function comparison() {
    const a=C.person(state.a),b=C.person(state.b), get=p=>C.sum(C.records(p))/(C.state.metric==='mensal'?p.months:1), av=get(a),bv=get(b),delta=bv?(av-bv)/bv*100:0;
    return `${intro('04','Comparação com contexto','Lado a lado. Sem atalhos.','Escolha duas pessoas e compare a mesma métrica, no mesmo período. Abra as evidências antes de tirar conclusões.')}
      <div class="compare-controls"><label>Primeiro representante<select id="compare-a">${peopleOptions(state.a)}</select></label><button class="swap-button" data-p="swap" aria-label="Inverter representantes">⇄</button><label>Segundo representante<select id="compare-b">${peopleOptions(state.b)}</select></label><div class="p-metric" role="group" aria-label="Comparação total ou por mês"><button data-p-metric="total" aria-pressed="${C.state.metric==='total'}">Total</button><button data-p-metric="mensal" aria-pressed="${C.state.metric==='mensal'}">Por mês</button></div></div>
      <div class="comparison-board"><div class="compare-person">${C.avatar(a)}<div><p>${a.months} meses no recorte</p><h3>${a.name}</h3>${followButton(a.id,true)}</div><button data-action="evidence" data-id="${a.id}" data-kind="gastos" class="compare-total">${compact(av)} →</button></div><div class="comparison-center"><span class="vs">×</span>${bv===0&&av!==0?`<strong>${compact(av)}</strong><p>a mais para ${a.name.split(' ')[0]}. ${b.name.split(' ')[0]} não tem gastos neste recorte, então não há base para uma porcentagem.</p>`:`<strong>${number(Math.abs(delta))}%</strong><p>${av===bv?'Valores iguais':`${delta>0?'a mais':'a menos'} para ${a.name.split(' ')[0]} do que para ${b.name.split(' ')[0]}`}</p>`}${editorial&&a.months!==b.months&&C.state.metric!=='mensal'?`<p class="tenure-note">Meses no recorte diferentes (${a.months} × ${b.months}). Compare por mês.</p>`:''}<button data-p="compare-evidence">Como chegamos nisso? →</button></div><div class="compare-person second">${C.avatar(b)}<div><p>${b.months} meses no recorte</p><h3>${b.name}</h3>${followButton(b.id,true)}</div><button data-action="evidence" data-id="${b.id}" data-kind="gastos" class="compare-total">${compact(bv)} →</button></div></div>
      <div class="compare-breakdown">${(()=>{const cats=window.ClareiaData.categories,val=(p,cat)=>C.sum(C.records(p).filter(r=>r.category===cat))/(C.state.metric==='mensal'?p.months:1),max=Math.max(1,...cats.flatMap(cat=>[val(a,cat),val(b,cat)]));return cats.map(cat=>{const x=val(a,cat),y=val(b,cat);return `<div class="compare-category"><span>${compact(x)}</span><div class="left-bar"><i style="width:${x/max*100}%"></i></div><b>${lab(cat)}</b><div class="right-bar"><i style="width:${y/max*100}%"></i></div><span>${compact(y)}</span></div>`;}).join('')})()}</div><div class="compare-foot"><p>${C.span()} · ${catText(C.state.category)} · ${C.state.metric==='mensal'?'média por mês no recorte':'total de reembolsos'}${a.months!==b.months?' · tempos em exercício diferentes':''}</p><button class="p-link" data-p="ask-comparison">Investigar esta comparação ${icon('arrow')}</button></div>${linkedExplorer()}`;
  }
  function directoryCards() {
    const normalize=s=>s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const ppl=C.all().filter(p=>normalize(p.name).includes(normalize(state.rosterQuery)));
    const head=editorial&&ppl.length?`<div class="directory-head" aria-hidden="true"><span>Representante</span><span>Cota ${C.state.metric==='mensal'?'por mês':'no recorte'}</span><span>Projetos${C.state.metric==='mensal'?' por mês':''}</span><span></span></div>`:'';
    return ppl.length?head+ppl.map(p=>`<article class="directory-card"><div class="directory-person">${C.avatar(p)}<div><h3>${p.name}</h3><p>${esc(C.context(p))} · ID Câmara ${p.officialId}</p></div>${followButton(p.id)}</div><div class="directory-stats"><button data-action="evidence" data-id="${p.id}" data-kind="gastos"><b>${compact(C.sum(C.records(p))/(C.state.metric==='mensal'?p.months:1))}</b><small>cota ${C.state.metric==='mensal'?'por mês':'no recorte'}</small></button><button data-action="evidence" data-id="${p.id}" data-kind="projetos"><b>${C.pending}</b><small>projetos ${C.state.metric==='mensal'?'por mês':'apresentados'}</small></button></div><div class="directory-actions"><button data-action="profile" data-id="${p.id}">Abrir perfil →</button><button data-p-add-compare="${p.id}">Comparar +</button></div></article>`).join(''):'<div class="empty-state"><b>Nenhum perfil encontrado.</b><p>A busca consulta os deputados desta versão.</p><button class="outline-button" data-p="clear-directory">Limpar filtros</button></div>';
  }
  function directory() {
    return `<div class="directory-heading"><h3>Encontre um representante</h3><span>${C.all().length} deputados · ${C.span()}</span></div><div class="directory-controls"><label><span class="sr-only">Nome do representante</span><input id="roster-query" placeholder="Buscar por nome" value="${esc(state.rosterQuery)}"></label></div><div class="directory-grid" id="directory-grid" aria-live="polite">${directoryCards()}</div>`;
  }
  function projectCards() { return ''; }

  function projectSection() {
    return `${intro('05','Além da quantidade','Ideias em movimento.','Apresentar um projeto é só o começo. Explore a proposta, a autoria e cada etapa do caminho.',badge('Próxima etapa'))}<div class="empty-state real-pending"><b>Projetos de lei ainda não foram coletados.</b><p>A próxima etapa traz PL, PLP e PEC da Câmara, separando autoria principal de coautoria e mostrando quais viraram lei. Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function voteCards() { return ''; }

  function voteSection() {
    return `${intro('06','O voto e seu contexto','Como decidiram?', 'O objeto da votação vem antes do placar. Veja a etapa, o texto em discussão e a participação de cada pessoa.',badge('Próxima etapa'))}<div class="empty-state real-pending"><b>Votações nominais ainda não foram coletadas.</b><p>A próxima etapa separa a votação do projeto da votação de requerimentos e destaques. Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function moreSection() {
    return `${intro('07','Conecte as peças','Um mandato tem muitas dimensões.','Trajetória, eleições, patrimônio declarado e emendas entram nas próximas etapas.')}<div class="empty-state real-pending"><b>Eleições, patrimônio e emendas ainda não foram coletados.</b><p>Essas camadas dependem de outras fontes oficiais (TSE e Portal da Transparência). Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function events(id) { const p=C.person(id); return [
    {date:C.span().toUpperCase(),title:'Despesas publicadas',text:`Registros oficiais da cota parlamentar de ${p.name}, conferidos registro por registro.`,action:'records',value:id},
    {date:'PRÓXIMA ETAPA',title:'Projetos e votações',text:'Ainda não coletados. Entram quando forem conferidos com a fonte oficial.',action:'profile',value:id}
  ]; }

  function timeline() {return events(state.timeline).map((e,i)=>`<button class="timeline-event p-reveal" data-p-event="${e.action}" data-value="${e.value}"><span class="timeline-dot"></span><time>${e.date}</time><div><h3>${e.title}</h3><p>${e.text}</p></div>${ext()}</button>`).join('');}
  function savedList() {
    return state.favorites.size?`<div class="saved-people">${[...state.favorites].map(id=>{const p=C.person(id);return `<div>${C.avatar(p)}<button data-action="profile" data-id="${id}"><b>${p.name}</b><small>${p.uf} · abrir perfil</small></button>${followButton(id)}</div>`;}).join('')}</div>`:`<div class="saved-empty"><span class="saved-orbit" aria-hidden="true">+</span><h3>Comece por uma pessoa.</h3><p>Salve um perfil e volte para explorar sua atividade.</p><button class="p-primary" data-p-follow="${C.byTotal()[0].id}">Acompanhar ${esc(C.byTotal()[0].name)} +</button></div>`;
  }
  function following() {
    return `${intro('08','A política continua','Acompanhe o que muda.','Construa sua própria lista de acompanhamento. Os favoritos ficam salvos apenas neste navegador.')}<div class="following-grid"><div class="timeline-panel"><div class="timeline-heading"><h3>Linha do tempo do mandato</h3><label class="sr-only" for="timeline-person">Pessoa da linha do tempo</label><select id="timeline-person">${peopleOptions(state.timeline)}</select></div><div class="timeline">${timeline()}</div><p class="p-small">Linha do tempo desta versão publicada.</p></div><aside class="saved-panel"><div class="saved-heading"><h3>Meu acompanhamento</h3><span>${state.favorites.size}</span></div><div id="saved-list">${savedList()}</div><div class="saved-projects"><span>Projetos acompanhados</span><b>${state.projects.size}</b>${state.projects.size?`<div>${[...state.projects].map(id=>`<button data-p-project="${id}">DEMO ${id} ↗</button>`).join('')}</div>`:''}</div><button class="outline-button weekly-button" data-p="brief" ${!state.favorites.size?'disabled':''}>Abrir resumo dos acompanhados ${icon('arrow')}</button><p class="p-small">Sem cadastro. Nenhum e-mail ou alerta externo é enviado.</p></aside></div>`;
  }
  function closing() {
    return `<div class="closing-top">${label('09','A sua próxima pergunta')}<h2>Curiosidade é <br>um bom começo.</h2><p>Você não precisa conhecer o vocabulário do Congresso. <br>Comece com uma pergunta. Termine nos registros.</p><div class="closing-questions">${['Quem mais gastou por mês?',`Compare ${C.byTotal()[0].name.split(' ')[0]} e ${C.byTotal()[1].name.split(' ')[0]}`,'Quem gastou menos?'].map(q=>`<button data-question="${q}">${q}${icon('arrow')}</button>`).join('')}</div></div><div class="trust-row"><div><span>01</span><h3>Fonte à vista</h3><p>Cada número tem um caminho até os registros.</p></div><div><span>02</span><h3>Contexto primeiro</h3><p>Período, cobertura e definição acompanham a comparação.</p></div><div><span>03</span><h3>Limites explícitos</h3><p>Ausência de dados nunca vira zero ou uma resposta inventada.</p></div></div><button class="p-link" data-action="methodology">Conheça a metodologia ${ext()}</button>`;
  }
  const sections = [['panorama',overview],['despesas',spending],['atlas',atlas],['pessoas',directory],['comparacao',comparison],['projetos',projectSection],['votacoes',voteSection],['dimensoes',moreSection],['acompanhar',following],['perguntar',closing]];
  function mount() {
    const main=$('#main');
    main.insertAdjacentHTML('afterbegin',`<div class="page-progress" aria-hidden="true"><i></i></div><nav class="section-dock" aria-label="Seções da página"><a href="#rankings">Rankings</a><a href="#despesas">${editorial?'Gastos':'Despesas'}</a><a href="#atlas">Mapa</a>${editorial?'':'<a href="#comparacao">Comparar</a>'}<a href="#projetos">Projetos</a><a href="#votacoes">Votações</a><a href="#acompanhar" class="follow-nav">Acompanhar <span class="follow-count" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg><span id="saved-count">${state.favorites.size||''}</span></span></a><button type="button" id="dock-filter" class="dock-filter" data-action="reset" hidden></button></nav>`);
    C.scopeChip();
    main.insertAdjacentHTML('beforeend',`<div class="full-portal">${sections.map(([id,render])=>`<section class="p-section" id="${id}">${render()}</section>`).join('')}</div>`);
    $('.footer').innerHTML=`<div class="footer-brand"><span class="logo">${C.logo}</span><p>Entenda. Confira. Acompanhe.</p></div><div class="footer-links"><a href="#despesas">Gastos por categoria</a><a href="#comparacao">Comparar</a><button data-action="methodology">Fontes e metodologia</button><button data-p="coverage">Cobertura da amostra</button><button data-p="reset-saved">Apagar favoritos locais</button></div><div class="footer-disclaimer"><span>Versão ${C.span()}</span><p>Dados oficiais da Câmara dos Deputados, ${C.span()}. Amostra técnica, não representa toda a Câmara. Busca por regras locais, sem IA conectada.</p><button data-p="top">Voltar ao topo ↑</button></div>`;
    document.body.insertAdjacentHTML('beforeend',`<button class="assistant-launcher" data-p="assistant" aria-label="${editorial?'Fazer uma pergunta na busca':'Abrir assistente de investigação'}"><span class="assistant-spark" aria-hidden="true">✳</span><span>${editorial?'Fazer uma pergunta':'Pergunte ao Clareia'}</span>${icon('arrow')}</button>`);
    document.body.dataset.motion=state.motion?'on':'off';
    watchMotion(); watchSections();
  }
  let observer;
  function watchMotion() {
    observer?.disconnect();
    document.querySelectorAll('.p-section-intro,.p-panel,.p-stat,.dossier-card,.project-card,.vote-card,.timeline-event').forEach(el=>el.classList.add('p-reveal'));
    if (!state.motion) { document.querySelectorAll('.p-reveal').forEach(el=>el.classList.add('is-visible')); return; }
    observer=new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{if(isIntersecting){target.classList.add('is-visible');if(target.matches('.p-stat'))animateCounter(target);observer.unobserve(target);}}),{threshold:.08});
    document.querySelectorAll('.p-reveal:not(.is-visible)').forEach(el=>observer.observe(el));
  }
  // The count-up is visual only: each button carries the final value in aria-label.
  function animateCounter(el) { const target=el.querySelector('[data-counter]');if(!target)return;const value=+target.dataset.counter,start=performance.now();function frame(now){if(!target.isConnected)return;const t=Math.min(1,(now-start)/700),n=Math.round(value*(1-Math.pow(1-t,3)));target.textContent=target.dataset.format==='money'?compact(n):number(n);if(t<1&&state.motion)requestAnimationFrame(frame);else target.textContent=target.dataset.format==='money'?compact(value):number(value);}requestAnimationFrame(frame); }
  // Position-based spy: the current section is the last one whose top has passed 35% of the viewport; none above the first.
  function spySections() {
    const line=innerHeight*.35; let cur=null;
    document.querySelectorAll('#rankings,.p-section').forEach(el=>{if(el.getBoundingClientRect().top<=line)cur=el.id;});
    document.querySelectorAll('.section-dock a').forEach(a=>{const on=a.hash==='#'+cur;a.classList.toggle('current',on);if(on)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
  }
  function watchSections() { spySections(); }
  function renderPart(id,render) { const el=$('#'+id); if(el)el.innerHTML=render(); }
  function updateSpending() {
    // Keep the actual range input mounted so dragging retains pointer capture.
    const temp=document.createElement('div');temp.innerHTML=spending();
    for(const selector of ['.donut-panel','.p-mini-bars','.supplier-list', ...(editorial?['.category-focus']:[])]) $('#despesas '+selector).innerHTML=temp.querySelector(selector).innerHTML;
    $('#despesas [data-p="all-suppliers"]')?.remove();$('#despesas .supplier-list').insertAdjacentHTML('afterend',temp.querySelector('[data-p="all-suppliers"]')?.outerHTML||'');
    $('#despesas output')&&($('#despesas output').textContent=`Jan → ${months[state.month-1]}`);
    $('#spend-range')?.setAttribute('aria-valuetext',`Janeiro a ${months[state.month-1]} de ${C.state.year}`);
  }
  function updateAll() { sections.forEach(([id,render])=>renderPart(id,render));watchMotion(); }
  function updateFollowCount() {
    const count = $('#saved-count'), n = state.favorites.size;
    const changed = count.textContent !== String(n || '');
    count.textContent = n || '';
    const link = count.closest('a');
    link.setAttribute('aria-label', n ? `Acompanhar: ${n} representante${n === 1 ? '' : 's'} acompanhado${n === 1 ? '' : 's'}` : 'Acompanhar representantes');
    if (changed && n && state.motion && !reduced.matches) count.parentElement.animate(
      [{ transform: 'scale(.85)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'ease-out' }
    );
  }
  function updateSaved() { renderPart('acompanhar',following);updateFollowCount();document.querySelectorAll('[data-p-follow]').forEach(b=>{const on=state.favorites.has(b.dataset.pFollow);b.setAttribute('aria-pressed',on);b.classList.toggle('is-following',on);if(b.classList.contains('follow-button')){const full=b.textContent.trim().length>2;b.innerHTML=`<svg class="heart" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg>${full?on?'Acompanhando':'Acompanhar':''}`;b.setAttribute('aria-label',`${on?'Deixar de acompanhar':'Acompanhar'} ${C.person(b.dataset.pFollow).name}`);}});watchMotion(); }
  function focusMatch(selector) { $(selector)?.focus({preventScroll:true}); }
  function expenseEvidence(category, supplier) {
    const items=scopeRecords().filter(r=>(!category||r.category===category)&&(!supplier||r.supplier===supplier)), total=C.sum(items);
    C.showDialog(category?lab(category):'Como chegamos nisso?',`<p class="dialog-subtitle">Despesas da amostra, registro por registro.</p><p class="records-note">${scopeText()} · ${state.month<COVER?' · até '+months[state.month-1]:''}${category?' · '+esc(lab(category)):''}</p>${category?`<p class="records-note">Nome na fonte: ${esc(category)}</p>`:''}<div class="calculation-result">${money(total)}<small>Soma de ${items.length} registros oficiais</small></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Pessoa / mês</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>${items.map(r=>`<tr><td>${r.person}<br><small>${months[r.month]} · ${r.id}</small></td><td>${esc(lab(r.category))}</td><td>${money(r.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Total conferido</th><td>${money(total)}</td></tr></tfoot></table></div><p class="fixture-note">Salários, gabinete e emendas não entram nesta soma.</p>`);
  }
  function supplierDetail(category) {
    const rows=scopeRecords().filter(r=>r.category===category);
    const names=[...new Set(rows.map(r=>r.supplier))];
    C.showDialog('Da categoria ao fornecedor',`<p class="records-note">${esc(lab(category))} · ${scopeText()}${state.month<COVER?' · até '+months[state.month-1]:''}</p><p class="records-note">Nome na fonte: ${esc(category)}</p><div class="calculation-result">${money(C.sum(rows))}<small>Soma dos registros da categoria selecionada</small></div><div class="supplier-list">${names.map(name=>`<button data-p-supplier="${esc(name)}" data-category="${esc(category)}"><span>${esc(name)}<small>${rows.filter(r=>r.supplier===name).length} registros oficiais</small></span><b>${money(C.sum(rows.filter(r=>r.supplier===name)))}</b>↗</button>`).join('')||'<p>Sem registros neste recorte.</p>'}</div><p class="fixture-note">Clique no fornecedor para abrir os registros. Na produção, o vínculo dependerá do identificador oficial; nomes parecidos não bastam.</p>`);
  }
  function projectDetail() {}

  function voteDetail() {}

  function dossier() { C.showDialog('Ainda não coletado','<p>Eleições, patrimônio e emendas ainda não foram coletados e conferidos.</p>'); }

  function summary(key) {
    if(key==='expenses'||key==='records'){const before=state.month;state.month=12;expenseEvidence();state.month=before;return;}
    const ppl=scopePeople();
    C.showDialog('Como chegamos nisso?',`<p class="records-note">${scopeText()} · contagem dos deputados desta versão</p><table class="data-table"><thead><tr><th>Deputado(a)</th><th>ID Câmara</th></tr></thead><tbody>${ppl.map(p=>`<tr><td>${p.name}</td><td>${p.officialId}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><td>${ppl.length}</td></tr></tfoot></table><p class="fixture-note">Não há avaliação de qualidade do mandato.</p>`);
  }
  function brief() {C.showDialog('Seu resumo de acompanhamento',`<p class="records-note">Seleção local · ${C.span()}. Nenhuma notificação foi enviada.</p>${[...state.favorites].map(id=>`<section class="brief-person"><h3>${C.person(id).name}</h3>${events(id).slice(0,2).map(e=>`<button data-p-event="${e.action}" data-value="${e.value}"><small>${e.date}</small><b>${e.title}</b><span>${e.text} ↗</span></button>`).join('')}</section>`).join('')||'<p>Acompanhe uma pessoa para montar seu resumo.</p>'}`);}
  function assistant() {C.showDialog('Sua investigação começa aqui',`<div class="assistant-intro"><span class="assistant-spark">✳</span><h3>Qual número você quer entender?</h3><p>Escolha uma pergunta ou escreva a sua. A busca consulta os registros oficiais desta versão, sem IA conectada.</p></div><form id="assistant-form"><label class="sr-only" for="assistant-query">Sua pergunta</label><textarea id="assistant-query" placeholder="Ex.: quem mais gastou por mês?" maxlength="300" required></textarea><button class="p-primary" type="submit">Investigar ${icon('arrow')}</button></form><div class="assistant-examples">${['Quem mais gastou por mês?','Quem mais gastou com passagens?','Quem gastou menos?'].map(q=>`<button data-p-ask="${q}">${q}${icon('arrow')}</button>`).join('')}</div><p class="p-small">Cobertura: ${C.all().length} deputados, despesas de ${C.span()}.</p>`);setTimeout(()=>$('#assistant-query')?.focus(),30);}
  function runAsk(q) {C.closeDialog();C.ask(q);$('#answer-slot').scrollIntoView({behavior:state.motion?'smooth':'instant',block:'center'});}
  document.addEventListener('clareia:change',updateAll);
  document.addEventListener('click',e=>{
    const hit=e.target.closest('.chart-hit');
    // Hit areas overlap, so the click goes to the visible point nearest to the pointer, whoever's area was on top.
    if(hit){const d=p=>{const r=p.getBoundingClientRect();return Math.hypot(r.x+r.width/2-e.clientX,r.y+r.height/2-e.clientY);};[...document.querySelectorAll('#linked-result .chart-point')].sort((a,b)=>d(a)-d(b))[0]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
    const b=e.target.closest('[data-p-highlight],[data-p],[data-p-follow],[data-p-uf],[data-p-category],[data-p-supplier],[data-p-drill],[data-p-month],[data-p-metric],[data-p-topic],[data-p-project],[data-p-project-save],[data-p-vote],[data-p-dossier],[data-p-event],[data-p-summary],[data-p-ask],[data-p-add-compare]');if(!b)return;
    if(b.dataset.pHighlight){const slice=b.hasAttribute('data-donut-slice');state.highlightCategory=state.highlightCategory===b.dataset.pHighlight?null:b.dataset.pHighlight;updateSpending();focusMatch(`${slice?'[data-donut-slice]':'.donut-legend button'}[data-p-highlight="${CSS.escape(b.dataset.pHighlight)}"]`);previewDonut(null);return;}
    if(b.dataset.pSupplier){expenseEvidence(b.dataset.category,b.dataset.pSupplier);return;}
    if(b.dataset.pDrill){supplierDetail(b.dataset.pDrill);return;}
    if(b.dataset.pAddCompare){state.a=b.dataset.pAddCompare;if(state.b===state.a)state.b=C.byTotal().find(p=>p.id!==state.a).id;renderPart('comparacao',comparison);if(editorial){C.toast(`${C.person(state.a).name.split(' ')[0]} entrou na comparação, ao lado de ${C.person(state.b).name.split(' ')[0]}.`);const h=$('#comparacao h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}$('#comparacao').scrollIntoView({behavior:state.motion?'smooth':'instant',block:'start'});return;}
    if(b.dataset.pFollow){const id=b.dataset.pFollow;state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);save('clareia-favorites',[...state.favorites]);updateSaved();focusMatch(`[data-p-follow="${id}"]`);C.toast(state.favorites.has(id)?'Perfil salvo neste navegador.':'Perfil removido do acompanhamento.');return;}
    if(b.dataset.pUf){state.mapUF=b.dataset.pUf;renderPart('atlas',atlas);focusMatch(`[data-p-uf="${state.mapUF}"]`);return;}
    if(b.dataset.pCategory){expenseEvidence(b.dataset.pCategory);return;}
    if(b.dataset.pMonth){state.month=+b.dataset.pMonth;renderPart('despesas',spending);focusMatch(`[data-p-month="${state.month}"]`);return;}
    if(b.dataset.pMetric){C.state.metric=b.dataset.pMetric;C.refresh();focusMatch(`[data-p-metric="${C.state.metric}"]`);return;}
    if(b.dataset.pTopic){state.topic=b.dataset.pTopic;renderPart('projetos',projectSection);watchMotion();focusMatch(`[data-p-topic="${state.topic}"]`);return;}
    if(b.dataset.pProject){projectDetail(b.dataset.pProject);return;}
    if(b.dataset.pProjectSave){const id=b.dataset.pProjectSave;state.projects.has(id)?state.projects.delete(id):state.projects.add(id);save('clareia-projects',[...state.projects]);renderPart('project-grid',projectCards);updateSaved();if($('#detail').open)projectDetail(id);focusMatch(`[data-p-project-save="${id}"]`);return;}
    if(b.dataset.pVote){voteDetail(b.dataset.pVote);return;}
    if(b.dataset.pDossier){dossier(b.dataset.pDossier);return;}
    if(b.dataset.pSummary){summary(b.dataset.pSummary);return;}
    if(b.dataset.pAsk){runAsk(b.dataset.pAsk);return;}
    if(b.dataset.pEvent){const kind=b.dataset.pEvent,id=b.dataset.value;if(kind==='vote')voteDetail(id);else if(kind==='project')projectDetail(id);else if(kind==='records')C.recordTable(C.person(id));else C.profile(id);return;}
    switch(b.dataset.p){
            case 'all-suppliers':state.allSuppliers=!state.allSuppliers;updateSpending();focusMatch('[data-p="all-suppliers"]');break;
      case 'clear-highlight':state.highlightCategory=null;updateSpending();focusMatch('.donut-legend button:not(:disabled)');break;
      case 'spend-evidence':expenseEvidence();break;
      case 'map-evidence':C.showDialog('Como calculamos o mapa?',`<p class="records-note">${C.span()} · ${state.mapMetric==='projects'?'autoria principal':catText(C.state.category)}</p><p>UF de representação, não destino da despesa. Média por representante = soma dos reembolsos dividida pelo número de perfis da UF; não ajusta tempo em exercício.</p><table class="data-table"><thead><tr><th>UF</th><th>Perfis</th><th>Valor</th></tr></thead></table><p class="fixture-note">UF de representação conforme o cadastro da Câmara. UFs sem deputados nesta amostra aparecem como indisponíveis; indisponível não significa zero.</p>`);break;
      case 'map-reset':state.mapUF=null;renderPart('atlas',atlas);break;
      case 'apply-state':{const local=C.all().filter(p=>p.uf===state.mapUF);state.a=local[0].id;state.b=(local[1]||local[0]).id;C.state.uf=state.mapUF;C.refresh();}C.toast(`Recorte aplicado: ${UF[state.mapUF][0]}.`);break;
      case 'swap':[state.a,state.b]=[state.b,state.a];renderPart('comparacao',comparison);focusMatch('[data-p="swap"]');break;
      case 'compare-evidence':C.evidence(state.a,{kind:'gastos',compare:state.b});break;
      case 'ask-comparison':runAsk(`Compare ${C.person(state.a).name} e ${C.person(state.b).name} em ${C.state.year}${C.state.metric==='mensal'?' por mês':''}${C.state.category!=='Todas'?' com '+lab(C.state.category):''}`);break;
      case 'clear-projects':state.topic='Todos';state.stage='Todos';state.projectQuery='';renderPart('projetos',projectSection);watchMotion();break;
      case 'clear-directory':state.rosterQuery='';state.rosterUF='Todos';state.rosterParty='Todos';renderPart('pessoas',directory);$('#roster-query')?.focus();break;
      case 'brief':brief();break;
      case 'assistant':if(editorial){$('#query').scrollIntoView({block:'center',behavior:state.motion?'smooth':'instant'});$('#query').focus({preventScroll:true});}else assistant();break;
      case 'top':window.scrollTo({top:0,behavior:state.motion?'smooth':'instant'});break;
      case 'coverage':C.showDialog('Cobertura desta versão',`<div class="text-content"><h3>Uma amostra pequena, declarada.</h3><p>${C.all().length} deputados, ${C.span()}, despesas da cota parlamentar com dados oficiais da Câmara. Amostra técnica, sem ranking nacional.</p><p>UF, partido, projetos, votações, eleições, patrimônio e emendas ainda não foram coletados; as seções aparecem com o aviso “ainda não coletado”.</p><p>A busca usa regras locais, sem IA conectada. Favoritos ficam só neste navegador.</p></div>`);break;
      case 'reset-saved':state.favorites.clear();state.projects.clear();save('clareia-favorites',[]);save('clareia-projects',[]);updateAll();updateFollowCount();C.toast('Favoritos locais apagados.');break;
    }
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='linked-from'||e.target.id==='linked-to'){const isFrom=e.target.id==='linked-from';state[isFrom?'from':'to']=+e.target.value;if(state.from>state.to)state[isFrom?'to':'from']=+e.target.value;$('#linked-from').value=state.from;$('#linked-to').value=state.to;$('#linked-from-label').textContent=months[state.from-1];$('#linked-to-label').textContent=months[state.to-1];$('#linked-result').innerHTML=linkedChart();}
    if(e.target.id==='spend-range'){state.month=+e.target.value;updateSpending();}
    if(e.target.id==='project-search'){state.projectQuery=e.target.value;renderPart('project-grid',projectCards);watchMotion();}
    if(e.target.id==='roster-query'){state.rosterQuery=e.target.value;renderPart('directory-grid',directoryCards);}
  });
  document.addEventListener('change',e=>{
    const id=e.target.id,val=e.target.value;
    if(id==='map-metric'){state.mapMetric=val;renderPart('atlas',atlas);focusMatch('#map-metric');}
    if(id==='map-select'){state.mapUF=val||null;renderPart('atlas',atlas);focusMatch('#map-select');}
    if(id==='compare-a'||id==='compare-b'){const k=id==='compare-a'?'a':'b',other=k==='a'?'b':'a';if(state[other]===val)state[other]=state[k];state[k]=val;renderPart('comparacao',comparison);focusMatch('#'+id);if(editorial&&id==='compare-a'){state.voter=val;state.timeline=val;renderPart('votacoes',voteSection);renderPart('acompanhar',following);watchMotion();focusMatch('#compare-a');}}
    if(id==='project-stage'){state.stage=val;renderPart('project-grid',projectCards);watchMotion();}
    if(id==='voter'){state.voter=val;renderPart('vote-grid',voteCards);watchMotion();}
    if(id==='timeline-person'){state.timeline=val;renderPart('acompanhar',following);watchMotion();focusMatch('#timeline-person');}
    if(id==='roster-uf'||id==='roster-party'){state[id==='roster-uf'?'rosterUF':'rosterParty']=val;renderPart('directory-grid',directoryCards);}
  });
  document.addEventListener('submit',e=>{if(e.target.id==='assistant-form'){e.preventDefault();const q=$('#assistant-query').value.trim();if(q)runAsk(q);}});
  document.addEventListener('keydown',e=>{if(e.target.matches('.donut-legend [data-p-highlight]')&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const rows=[...document.querySelectorAll('.donut-legend [data-p-highlight]:not(:disabled)')],next=rows[rows.indexOf(e.target)+(e.key==='ArrowDown'?1:-1)];next?.click();return;}if(e.target.matches('[data-p-uf]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!$('#detail').open){e.preventDefault();$('#query').focus();$('#query').scrollIntoView({block:'center',behavior:state.motion?'smooth':'instant'});}});
  let ticking=false;
  addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;$('.page-progress i').style.width=`${max?scrollY/max*100:0}%`;spySections();document.body.classList.toggle('past-hero',scrollY>innerHeight*.9);ticking=false;});ticking=true;}},{passive:true});
  document.addEventListener('pointermove',e=>{if(C.model!=='explorador'||!state.motion||e.pointerType==='touch')return;const card=e.target.closest('.dossier-card,.project-card');if(!card)return;const r=card.getBoundingClientRect();card.style.setProperty('--tilt-x',`${-(e.clientY-r.top-r.height/2)/r.height*3}deg`);card.style.setProperty('--tilt-y',`${(e.clientX-r.left-r.width/2)/r.width*3}deg`);});
  document.addEventListener('pointerout',e=>{const card=e.target.closest('.dossier-card,.project-card');if(card&&!card.contains(e.relatedTarget)){card.style.setProperty('--tilt-x','0deg');card.style.setProperty('--tilt-y','0deg');}});
  reduced.addEventListener('change',e=>{if(e.matches){state.motion=false;document.body.dataset.motion='off';watchMotion();}});
  // Run after the existing action handlers so outside controls still complete their action.
  document.addEventListener('click', e => {
    if (!state.highlightCategory || !(e.target instanceof Element)) return;
    if (e.target.closest('.interactive-donut,.donut-legend,.p-mini-bars')) return;
    state.highlightCategory = null;
    updateSpending();
    previewDonut(null);
  });
  const donutTarget = target => target instanceof Element ? target.closest('[data-donut-slice],.donut-legend [data-p-highlight]') : null;
  document.addEventListener('pointerover', e => {
    const target = donutTarget(e.target);
    if (target && e.pointerType !== 'touch') previewDonut(target.dataset.pHighlight);
  });
  document.addEventListener('pointerout', e => {
    if (donutTarget(e.target) && e.pointerType !== 'touch') previewDonut(donutTarget(e.relatedTarget)?.dataset.pHighlight);
  });
  document.addEventListener('focusin', e => {
    const target = donutTarget(e.target);
    if (target) previewDonut(target.dataset.pHighlight);
  });
  document.addEventListener('focusout', e => {
    if (donutTarget(e.target)) previewDonut(donutTarget(e.relatedTarget)?.dataset.pHighlight);
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('[data-donut-slice]') && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  mount();
  updateFollowCount();
})();
