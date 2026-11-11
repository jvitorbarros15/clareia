(() => {
  'use strict';
  const C = window.Clareia;
  const { compact, money, number, escape: esc, icon } = C;
  const $ = s => document.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const months = window.ClareiaData.monthNames;
  const COVERAGE = window.ClareiaData.coverage;
  const COVER = COVERAGE.at(-1) + 1;
  const FULL_MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  // Twelve hues far apart in tone and lightness, so neighbouring slices never look alike.
  const PALETTE = ['#1d7a6e','#c2731a','#3b5bdb','#8a4f7d','#5d6470','#7a9a2e','#b5443c','#2f8fb0','#a8741a','#6a4fb3','#9a9a9a','#d4a72c'];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { C.toast('O navegador não permitiu salvar. A seleção continua disponível nesta visita.'); } };
  const ROSTER_STEP=12,MAP_STEP=10;
  const state = {
    highlightCategory: null, mapLimit: MAP_STEP, rosterLimit: ROSTER_STEP, supplierLimit: 8, supplierQuery: '', month: COVER, mapUF: null, mapMetric: 'total', from: 1, to: COVERAGE.length, a: C.byTotal()[0].id, b: C.byTotal()[1].id, topic: 'Todos', stage: 'Todos', projectQuery: '', voter: C.byTotal()[0].id, timeline: C.byTotal()[0].id, rosterQuery: '', rosterUF:'Todos', rosterParty:'Todos',
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
  // catText and scopeText return HTML-safe text: every use is inside innerHTML.
  const catText = category => category === 'Todas' ? 'todas as categorias' : esc(lab(category));
  const scopePeople = () => C.all().filter(p => !p.noExercise&&(C.state.uf === 'Brasil' || p.uf === C.state.uf));
  const scopeRecords = () => scopePeople().flatMap(p => C.cells(p).filter(r => r.month < state.month).map(r => ({...r,person:p.name,idPerson:p.id})));
  const badge = text => `<span class="p-badge">${text}</span>`;
  const editorial = C.model === 'editorial';
  // Every one of these opens a panel on this page, so the editorial uses a plain arrow, not the external-link mark.
  const ext = () => icon(editorial ? 'arrow' : 'external');
  const label = (n, text) => editorial ? `<p class="p-kicker">${text}</p>` : `<p class="p-kicker"><span>${n}</span> ${text}</p>`;
  const directTitle = {'Um total. Muitas histórias.':'Gastos por categoria','O Brasil, mais perto.':'Representantes por estado','Lado a lado. Sem atalhos.':'Comparar dois representantes','Ideias em movimento.':'Projetos de lei','Como decidiram?':'Votações','Um mandato tem muitas dimensões.':'O que ainda não cobrimos','Acompanhe o que muda.':'Acompanhar'};
  const intro = (n, eyebrow, title, description, extra = '') => `<div class="p-section-intro"><div>${label(n,eyebrow)}<h2>${editorial&&directTitle[title]||title}</h2><p class="p-description">${description}</p></div>${extra}</div>`;
  const byName=(a,b)=>a.name.localeCompare(b.name,'pt-BR');
  // A search box beside each list of deputies; the list itself stays a native select.
  const personFilter=selectId=>`<div class="person-combo"><label class="sr-only" for="${selectId}-filter">Buscar deputado</label><input id="${selectId}-filter" class="person-filter" data-filter="${selectId}" type="search" autocomplete="off" placeholder="Buscar deputado" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${selectId}-options"><ul id="${selectId}-options" class="person-options" role="listbox" aria-label="Deputados encontrados" hidden></ul></div>`;
  const peopleOptions = (selected,comparing=true) => [...C.all()].sort(byName).map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${esc(p.name)} · ${esc(p.uf)}${comparing&&!C.comparable(p)?' (fora da comparação)':''}</option>`).join('');
  function followButton(id, full = false) { const on=state.favorites.has(id); return `<button class="follow-button ${on?'is-following':''}" data-p-follow="${id}" aria-pressed="${on}" aria-label="${on?'Deixar de acompanhar':'Acompanhar'} ${esc(C.person(id).name)}"><svg class="heart" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg>${full ? on?'Acompanhando':'Acompanhar':''}</button>`; }
  function scopeText(period = C.span()) { const n=scopePeople().length; return `${n}${n===1?'deputado':'deputados'}${C.state.uf==='Brasil'?'':' · '+UF[C.state.uf][0]} · ${period} · ${catText(C.state.category)}`; }
  // The spending panel follows its month slider; everywhere else the period is the published coverage.
  // The slider moves over calendar months starting at the first covered month (the published coverage is contiguous).
  const rangeText = () => `${months[COVERAGE[0]]} → ${months[state.month-1]}`;
  const rangeValueText = () => `${FULL_MONTHS[COVERAGE[0]]} a ${FULL_MONTHS[state.month-1]} de ${C.state.year}`;
  const periodText = () => {
    const first = window.ClareiaData.coverage[0];
    if (state.month >= COVER) return C.span();
    return state.month - 1 === first ? `${months[first]} ${C.state.year}` : `${months[first]}–${months[state.month-1]} ${C.state.year}`;
  };
  function overview() {
    const people = scopePeople();
    const total = C.sum(people.flatMap(C.cells));
    if (editorial) {
      const n=people.filter(p=>!p.noExercise).length, recs=C.count(people.flatMap(C.cells));
      const stat=(key,value,text,format='number')=>{const final=format==='money'?compact(value):number(value);return `<button class="p-stat" data-p-summary="${key}" aria-label="${final} ${text}"><strong data-counter="${value}" data-format="${format}" aria-hidden="true">${final}</strong> <span aria-hidden="true">${text}</span></button>`;};
      return `<div class="p-overview-head"><h2 class="p-overview-title">Panorama de ${C.state.year}</h2><span>${scopeText()}</span></div><p class="p-overview-sentence">Neste recorte, ${stat('people',n,n===1?'deputado':'deputados')} ${n===1?'soma':'somam'} ${stat('expenses',total,'em despesas','money')}, distribuídos em ${stat('records',recs,'registros')}, e ${n===1?'teve':'tiveram'} ${stat('coverage',window.ClareiaData.coverage.length,'meses publicados')} (${C.span()}).${window.ClareiaData.billsApproved?'':' Projetos de lei ainda não foram coletados.'}</p>`;
    }
    return `<div class="p-overview-head">${editorial?`<h2 class="p-overview-title">Panorama de ${C.state.year}</h2>`:label('01',`Panorama de ${C.state.year}`)}<span>${scopeText()}</span></div><div class="p-stats">${[
      ['Pessoas no recorte',people.length,'perfis para conhecer','people'],
      ['Despesas da cota',total,'registros que você pode conferir','expenses'],
      
      ['Registros de despesa',C.count(people.flatMap(C.cells)),'registros oficiais nesta versão','records']
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
    return `<div class="donut-shell"><div class="spend-donut interactive-donut"><svg class="donut-svg" viewBox="0 0 200 200" role="group" aria-label="Composição das despesas. Selecione uma fatia ou use a legenda."><circle cx="100" cy="100" r="90" fill="none" stroke="var(--line)" stroke-width="16"/>${slices}</svg><div class="donut-hole">${selected && selected.value > 0 ? `<span>${esc(lab(selected.name))}</span><strong class="is-exact">${money(selected.value)}</strong><small>${C.share(selected.value, positiveTotal)} ${shareLabel}</small>` : `<span>${periodText()}</span><strong>${compact(total)}</strong><small>valor líquido</small>`}</div></div></div>${negativeTotal < 0 ? `<p class="donut-adjustment">Ajustes negativos de ${money(negativeTotal)} não entram nas fatias. As fatias somam ${money(positiveTotal)} em categorias positivas; o total líquido ao centro já desconta os ajustes.</p>` : ''}<div class="donut-readout" aria-live="polite" data-rest-label="${valid ? 'Explore as categorias' : 'Composição indisponível'}" data-rest-detail="${valid ? 'Selecione uma fatia ou uma linha da legenda.' : 'Consulte a legenda: o recorte está vazio ou contém ajustes negativos.'}"><strong>${selected ? esc(lab(selected.name)) : valid ? 'Explore as categorias' : 'Composição indisponível'}</strong><span>${selected ? `${money(selected.value)} · ${selected.value < 0 ? 'ajuste negativo' : `${C.share(selected.value, positiveTotal)} ${shareLabel}`}` : valid ? 'Selecione uma fatia ou uma linha da legenda.' : 'Consulte a legenda: o recorte está vazio ou contém ajustes negativos.'}</span></div>`;
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
    const readout = panel.querySelector('.donut-readout');
    readout.querySelector('strong').textContent = active ? active.dataset.label : readout.dataset.restLabel;
    readout.querySelector('span').textContent = active ? active.dataset.detail : readout.dataset.restDetail;
  }
  // With many months each bar is too narrow for a full value; the exact one stays in the aria-label and the click.
  const barLabel=cents=>{const sign=cents<0?'−':'',abs=Math.abs(cents),br=(v,d)=>v.toLocaleString('pt-BR',{maximumFractionDigits:d});if(abs>=99950000)return `${sign}${br(Math.round(abs/10000000)/10,1)}<br>mi`;if(abs>=9995000)return `${sign}${br(Math.round(abs/100000),0)}<br>mil`;if(abs>=99950)return `${sign}${br(Math.round(abs/10000)/10,1)}<br>mil`;return `${sign}${br(Math.round(abs/100),0)}<br>R$`;};
  const SUPPLIER_STEP=10;
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
    const monthRows=months.map((_,i)=>scopePeople().flatMap(C.cells).filter(r=>r.month===i)), monthTotals=monthRows.map(C.sum), maxMonth=Math.max(1,...monthTotals);
    const monthPart=i=>C.sum(monthRows[i].filter(r=>r.category===highlighted));
    // One row per supplier inside each category: a category total is never shown next to a single supplier's name.
    const suppliers=groups.filter(g=>!out(g)).flatMap(g=>{const by=new Map();for(const r of entries)if(r.category===g.name)by.set(r.supplier,(by.get(r.supplier)||0)+r.amount);return [...by].map(([name,value])=>({name,category:g.name,value})).sort((a,b)=>b.value-a.value);});
    // Long lists grow ten at a time and can be searched; nothing beyond the visible rows is rendered.
    const supplierQuery=folded(state.supplierQuery).trim(),found=supplierQuery?suppliers.filter(s=>folded(s.name).includes(supplierQuery)):suppliers,shownSuppliers=found.slice(0,state.supplierLimit);
    return `${intro('02','Siga o dinheiro','Um total. Muitas histórias.','Arraste o período e veja de que é feita a conta. Cada categoria leva aos registros que a compõem.',badge('Cota parlamentar'))}
      <div class="spending-grid"><div class="p-panel donut-panel"><div class="donut-caption"><span>Composição das despesas</span><button data-p="spend-evidence" aria-label="Como calculamos as despesas">${editorial?'Como chegamos nisso? →':icon('info')}</button></div>${donutChart(groups,total,highlighted)}<div class="donut-legend">${groups.map(g=>`<button ${editorial ? `data-p-highlight="${esc(g.name)}" data-label="${esc(lab(g.name))}" data-detail="${esc(money(g.value))} · ${g.value < 0 ? 'ajuste negativo' : `${C.share(g.value, positiveTotal)} ${shareLabel}`}" aria-pressed="${highlighted===g.name}" tabindex="${g.name===rovingName?0:-1}" ${out(g)?'disabled':''}` : `data-p-category="${esc(g.name)}"`} style="--cat:${g.color}" class="${highlighted && highlighted!==g.name?'category-muted':''}"><span><i></i><span class="legend-name">${esc(lab(g.name))}${g.value<0?`<em>ajuste de ${money(g.value)}, fora das fatias</em>`:''}</span></span>${out(g)?'<strong class="is-out">fora do filtro</strong><small></small>':`<strong>${compact(g.value)}</strong><small>${g.value < 0 ? 'ajuste' : C.share(g.value, positiveTotal)}</small>`}</button>`).join('')}</div></div>
      <div class="spend-details">${COVERAGE.length<3?`<div class="range-heading"><h3>Por mês · ${periodText()}</h3></div>`:`<div class="range-heading"><h3>Explore o ano</h3><output for="spend-range">${rangeText()}</output></div><label class="sr-only" for="spend-range">Último mês incluído nas despesas</label><input id="spend-range" class="month-range" type="range" min="${COVERAGE[0]+1}" max="${COVER}" value="${state.month}" aria-valuetext="${rangeValueText()}"><div class="month-markers">${COVERAGE.map(i=>`<span>${months[i]}</span>`).join('')}</div>`}
      <div class="${COVERAGE.length>6?'many ':''}p-mini-bars" style="--cols:${COVERAGE.length}">${COVERAGE.map(i=>{const m=months[i],value=monthTotals[i];return `<button data-p-month="${i+1}" class="${i<state.month?'included':''}" aria-label="Incluir até ${m}: ${money(value)} no mês${highlighted?', sendo '+money(monthPart(i))+' em '+esc(highlighted):''}"><strong class="bar-value" aria-hidden="true" style="--height:${Math.max(2,value/maxMonth*100)}%">${COVERAGE.length>6?barLabel(value):compact(value)}</strong><span style="--height:${Math.max(2,value/maxMonth*100)}%;${highlighted?'background:var(--line)':''}">${highlighted?`<i class="category-bar-part" style="height:${value?monthPart(i)/value*100:0}%;background:${groups.find(g=>g.name===highlighted).color}"></i>`:''}</span><small aria-hidden="true">${m}</small></button>`;}).join('')}</div>
      ${editorial?`<div class="category-focus" aria-live="polite">${highlighted?`<p><strong>${esc(lab(highlighted))}</strong>: ${compact(groups.find(g=>g.name===highlighted).value)} · ${groups.find(g=>g.name===highlighted).value<0?'ajuste negativo, fora das fatias.':`${C.share(groups.find(g=>g.name===highlighted).value, positiveTotal)} das despesas positivas (${periodText()}).`}</p><p class="p-small">A cor destaca a parcela da categoria. O total e a escala permanecem iguais.</p><button class="p-link" data-p-drill="${esc(highlighted)}">Ver fornecedores de ${esc(lab(highlighted))} →</button><button class="category-clear" data-p="clear-highlight">Limpar destaque</button>`:''}</div>`:''}<h3 class="supplier-heading">Fornecedores das despesas</h3><p class="p-small">Fornecedores nos registros oficiais selecionados. Fornecedores com CNPJ aparecem pela razão social, que pode ser o nome de um empresário individual. Pessoa física sem CNPJ aparece como 'Fornecedor pessoa física'.</p><label class="activity-search supplier-search"><span class="sr-only">Buscar fornecedor</span><input id="supplier-search" type="search" autocomplete="off" placeholder="Buscar fornecedor" value="${esc(state.supplierQuery)}"></label><div class="supplier-list">${shownSuppliers.map((s,i)=>`<button data-p-supplier="${esc(s.name)}" data-category="${esc(s.category)}" class="${highlighted && highlighted!==s.category?'category-muted':''}" ${highlighted===s.category?'data-highlighted="true"':''}><span class="supplier-index">${String(i+1).padStart(2,'0')}</span><span>${esc(s.name)}<small>${esc(lab(s.category))}</small></span><b>${compact(s.value)}</b>${ext()}</button>`).join('')||`<p class="p-small">${supplierQuery?'Nenhum fornecedor encontrado para essa busca.':'Sem registros neste recorte.'}</p>`}</div><div class="supplier-more">${found.length>shownSuppliers.length?`<button class="p-link" data-p="more-suppliers">Mostrar mais ${Math.min(SUPPLIER_STEP,found.length-shownSuppliers.length)} de ${number(found.length)} fornecedores →</button>`:''}${state.supplierLimit>8&&shownSuppliers.length>8?'<button class="p-link" data-p="fewer-suppliers">Mostrar menos</button>':''}</div><button class="p-link" data-p="spend-evidence">Como chegamos nisso? ${ext()}</button><p class="p-small spend-scope">${scopeText(periodText())} · não inclui salários, gabinete ou emendas.</p></div></div>`;
  }
  // Packed hex grid: c counts half-tile steps so rows interlock; neighbours sit roughly where they are on the map.
  function tileMap() {
    // Intensity means "larger value", so only positive values are scaled, against the largest positive one.
    const max=Math.max(1,...Object.keys(UF).map(mapValue).filter(v=>v!==null&&v>0));
    // Same packed layout as before; slightly longer steps leave an even gap between tiles.
    return `<svg class="uf-map" viewBox="0 0 410 384" role="group" aria-label="Mapa esquemático das 27 unidades federativas, não geográfico">${Object.entries(UF).map(([uf,[name,c,r]])=>{
      const x=10+c*28.5,y=10+r*44, available=C.all().some(p=>!p.noExercise&&p.uf===uf), value=mapValue(uf);
      return `<g role="button" tabindex="0" data-p-uf="${uf}" aria-label="${name}${available?' — '+mapFormat(value):' — sem dados neste recorte'}" aria-pressed="${state.mapUF===uf}" class="uf-tile ${available?'has-data':''} ${available&&value<0?'negative':''} ${available&&value>0&&value/max>.55?'strong':''} ${state.mapUF===uf?'selected':''}" transform="translate(${x} ${y})"><path class="tile-hit" aria-hidden="true" d="M0 12 25 0 50 12 50 40 25 52 0 40Z"/><path style="${available&&value>=0?'fill:var(--accent);fill-opacity:'+(.2+.8*value/max):''}" d="M0 12 25 0 50 12 50 40 25 52 0 40Z"/><text x="25" y="${available?25:31}" text-anchor="middle">${uf}</text>${available?`<text class="tile-value" x="25" y="38" text-anchor="middle">${esc(tileValue(value))}</text>`:''}<title>${name}${available?' · '+mapFormat(value):' · sem dados'}</title></g>`;
    }).join('')}</svg>`;
  }
  const tileValue=v=>compact(v).replace(/R\$\s/,'');
  function mapValue(uf) {
    const people=C.all().filter(p=>!p.noExercise&&p.uf===uf);
    if(!people.length)return null;
    // A partial total is missing months, not a smaller cost: it never enters the average per representative.
    if(state.mapMetric==='average'){const comparable=people.filter(C.comparable);return comparable.length?C.sum(comparable.flatMap(C.cells))/comparable.length:null;}
    return C.sum(people.flatMap(C.cells));
  }
  function mapFormat(value) {return state.mapMetric==='projects'?number(value)+' projetos':money(value);}
  function mapControls() {
    return `<div class="map-metrics"><div class="map-metric-row"><span id="map-metric-label">Colorir por</span><div class="map-segment" role="group" aria-labelledby="map-metric-label">${[['total','Total de despesas'],['average','Por representante']].map(([value,label])=>`<button type="button" data-p="map-metric" data-value="${value}" aria-pressed="${state.mapMetric===value}">${label}</button>`).join('')}</div></div><p class="p-small">Mais intenso = maior valor neste recorte. Ausência de dados tem preenchimento distinto. ${C.state.category==='Todas'?'Todas as categorias':catText(C.state.category)}. ${C.span()}.</p><button class="p-link" data-p="map-evidence">Como chegamos nisso? →</button></div>`;
  }
  // Hit areas for every person go first, under all visible points: a large target must never cover another person's point.
  function linkedChart() {
    const cov=window.ClareiaData.coverage, people=[...new Set([state.a,state.b])].map(C.person), start=cov[state.from-1],end=cov[state.to-1];
    const value=(p,i)=>cov.includes(i)?C.sum(C.cells(p).filter(r=>r.month===i)):null;
    const seen=people.flatMap(p=>cov.map(i=>value(p,i))).filter(v=>v!==null),hi=Math.max(0,...seen),lo=Math.min(0,...seen),range=hi-lo;
    const ticks=range===0?[0]:lo<0&&hi>0?[lo,0,hi]:hi>0?[0,hi/2,hi]:[lo,lo/2,0];
    // The x domain is the published coverage; value labels sit in a left gutter and series names at the right end, outside the plot.
    const X0=124,X1=570,PAD=36,y=v=>range?215-(v-lo)/range*175:127.5;
    const x=i=>cov.length<2?(X0+X1)/2:X0+PAD+cov.indexOf(i)*((X1-X0-2*PAD)/(cov.length-1));
    const ends=people.map(p=>{const vals=cov.map(i=>value(p,i)),last=vals.findLastIndex(v=>v!==null);return last<0?null:y(vals[last]);});
    if(ends.length===2&&ends[0]!==null&&ends[1]!==null&&Math.abs(ends[0]-ends[1])<22){const mid=(ends[0]+ends[1])/2,upper=ends[0]<=ends[1];ends[0]=mid+(upper?-12:12);ends[1]=mid+(upper?12:-12);}
    const band=cov.length>=3?`<rect x="${x(start)-18}" y="22" width="${x(end)-x(start)+36}" height="196" fill="var(--accent)" opacity=".08"/>`:'';
    return `<div class="linked-chart-body${cov.length>4?' is-year':''}"><p class="records-note">${months[start]}–${months[end]} ${C.state.year} · ${catText(C.state.category)} · valores mensais absolutos. O recorte abaixo não altera os totais do período acima.</p><svg class="linked-lines" viewBox="0 -14 760 269" role="group" aria-label="Comparação mensal; pontos abrem os registros">${band}${ticks.map(v=>`<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text class="y-tick" x="${X0-10}" y="${y(v)+5}" text-anchor="end">${compact(v)}</text>`).join('')}${people.map((p,j)=>{const vals=cov.map(i=>value(p,i));return `<path fill="none" pointer-events="none" stroke="${color[j]}" stroke-width="3" d="${vals.map((v,k)=>v===null?'':`${k?'L':'M'}${x(cov[k])} ${y(v)}`).join(' ')}"/>${ends[j]===null?'':`<text class="line-label" pointer-events="none" x="${X1+14}" y="${ends[j]+5}" text-anchor="start" style="fill:${color[j]}">${esc(p.name.split(' ')[0])}</text>`}${vals.map((v,k)=>v===null?'':`<g class="chart-point" role="button" tabindex="0" data-action="month" data-id="${p.id}" data-month="${cov[k]}" data-cx="${x(cov[k])}" data-cy="${y(v)}" opacity="${cov[k]>=start&&cov[k]<=end?1:.25}" aria-label="${esc(p.name)}, ${months[cov[k]]}: ${money(v)}. Abrir registros"><title>${esc(p.name)} · ${months[cov[k]]} · ${money(v)}</title><rect class="chart-hit" x="${x(cov[k])-22}" y="${y(v)-22}" width="44" height="44" fill="transparent"/><circle class="chart-dot" cx="${x(cov[k])}" cy="${y(v)}" r="5" fill="${color[j]}"/></g>`).join('')}`;}).join('')}${cov.map(i=>`<text class="x-label" x="${x(i)}" y="242" text-anchor="middle">${months[i]}</text>`).join('')}</svg><div class="linked-totals">${people.map((p,j)=>{const rows=C.cells(p).filter(r=>r.month>=start&&r.month<=end);return `<div style="border-color:${color[j]}"><b>${esc(p.name)}</b><strong>${money(C.sum(rows))}</strong><small>${C.count(rows)} registros no período selecionado · ${p.months} meses no recorte</small></div>`;}).join('')}</div><details><summary>Ver dados em tabela</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Mês</th>${people.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${cov.filter(i=>i>=start&&i<=end).map(i=>`<tr><th>${months[i]}</th>${people.map(p=>`<td>${value(p,i)===null?'Fora do recorte':money(value(p,i))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details><p class="p-small">Clique em um ponto para conferir os registros. Uma variação não prova irregularidade. Fora do recorte é diferente de gasto zero.</p></div>`;
  }
  function linkedExplorer() {
    const ranges=COVERAGE.length<3?'':`<div class="linked-ranges"><label>De <output id="linked-from-label">${months[COVERAGE[state.from-1]]}</output><input id="linked-from" type="range" min="1" max="${COVERAGE.length}" value="${state.from}" aria-label="Mês inicial da comparação"></label><label>Até <output id="linked-to-label">${months[COVERAGE[state.to-1]]}</output><input id="linked-to" type="range" min="1" max="${COVERAGE.length}" value="${state.to}" aria-label="Mês final da comparação"></label></div>`;
    return `<div class="linked-explorer"><h3>O que mudou mês a mês?</h3><p class="p-small">As duas pessoas escolhidas acima alimentam este gráfico.</p>${ranges}<div id="linked-result">${linkedChart()}</div></div>`;
  }
  function atlasDetail() {
    if(!state.mapUF)return `<p class="p-kicker">Brasil</p><h3>Escolha um estado.</h3><p class="p-small">Toque num estado do mapa, ou use a lista, para conhecer os deputados dele neste recorte. A UF indica o estado de representação, não o local onde a despesa ocorreu.</p>`;
    const ppl=C.all().filter(p=>!p.noExercise&&p.uf===state.mapUF), total=C.sum(ppl.flatMap(C.cells));
    return `<p class="p-kicker">${state.mapUF} / ${UF[state.mapUF][0]}</p><h3>${ppl.length?'Conheça quem está no seu recorte.':'Ainda não há dados neste recorte.'}</h3><p class="p-small">A UF indica o estado de representação. Não é o local onde a despesa ocorreu.</p>
      ${ppl.length?`<div class="atlas-numbers"><div><strong>${ppl.length}</strong><span>${ppl.length===1?'deputado neste recorte':'deputados neste recorte'}</span></div><div><strong>${mapFormat(mapValue(state.mapUF))}</strong><span>${state.mapMetric==='projects'?'projetos apresentados':state.mapMetric==='average'?'cota por representante':'cota total'} · ${C.span()}${editorial&&state.mapMetric!=='projects'?' · valor exato':''}</span></div></div><div class="atlas-people">${[...ppl].sort(byName).slice(0,state.mapLimit).map(p=>`<div>${C.avatar(p)}<button data-action="profile" data-id="${p.id}"><b>${esc(p.name)}</b><small>Deputado(a) federal · ${esc(p.uf)}</small></button>${followButton(p.id)}</div>`).join('')}</div>${C.listMore(ppl.length,state.mapLimit,MAP_STEP,'map','deputados')}<button class="p-primary" data-p="apply-state">Explorar ${UF[state.mapUF][0]} ${icon('arrow')}</button>`:`<div class="map-empty">${icon('database')}<p>Indisponível não significa zero.</p><span>Nenhum deputado desta amostra representa este estado.</span></div>`}`;
  }
  function atlas() {
    return `${intro('03','Atlas de representantes','O Brasil, mais perto.','Escolha um estado. Descubra as pessoas por trás dos números e leve o recorte para o restante da página.',badge(`27 UFs · ${new Set(C.all().map(p=>p.uf).filter(Boolean)).size} com deputados neste recorte`))}<div class="atlas-grid"><div class="map-canvas"><div class="map-topline"><span>BRASIL / UNIDADES FEDERATIVAS</span><button data-p="map-reset">Visão inicial ↺</button></div>${mapControls()}${tileMap()}<div class="map-key"><span><i class="filled"></i>Com dados</span><span><i></i>Sem dados</span>${Object.keys(UF).some(uf=>mapValue(uf)<0)?'<span><i class="negative"></i>Valor líquido negativo</span>':''}</div><p class="p-small">Mapa esquemático por UF, não geográfico.</p><label class="map-select">Escolher estado<select id="map-select"><option value="" ${state.mapUF?'':'selected'}>Escolha um estado</option>${Object.entries(UF).sort((a,b)=>a[1][0].localeCompare(b[1][0],'pt-BR')).map(([uf,[name]])=>`<option value="${uf}" ${state.mapUF===uf?'selected':''}>${name}</option>`).join('')}</select></label></div><div class="atlas-detail" id="atlas-detail" aria-live="polite">${atlasDetail()}</div></div>`;
  }
  function comparison() {
    const a=C.person(state.a),b=C.person(state.b), get=p=>C.sum(C.cells(p))/(C.state.metric==='mensal'?p.months:1), av=get(a),bv=get(b),cmp=C.compareValues(av,bv),an=esc(a.name.split(' ')[0]),bn=esc(b.name.split(' ')[0]);
    const blocked=[a,b].filter(p=>!C.comparable(p));
    const head=`${intro('04','Comparação com contexto','Lado a lado. Sem atalhos.','Escolha duas pessoas e compare a mesma métrica, no mesmo período. Abra as evidências antes de tirar conclusões.')}
      <div class="compare-controls"><div class="person-pick"><label>Primeiro representante<select id="compare-a">${peopleOptions(state.a)}</select></label>${personFilter('compare-a')}</div><button class="swap-button" data-p="swap" aria-label="Inverter representantes">⇄</button><div class="person-pick"><label>Segundo representante<select id="compare-b">${peopleOptions(state.b)}</select></label>${personFilter('compare-b')}</div><div class="p-metric" role="group" aria-label="Comparação total ou por mês"><button data-p-metric="total" aria-pressed="${C.state.metric==='total'}">Total</button><button data-p-metric="mensal" aria-pressed="${C.state.metric==='mensal'}">Por mês</button></div></div>`;
    if(blocked.length)return head+`<div class="compare-blocked" role="note">${blocked.map(p=>`<p><strong>${esc(p.name)}</strong>: ${p.noExercise?`não tem exercício de mandato confirmado em ${C.state.year}, então não há gastos para comparar.`:C.exclusionNote(p)}</p>`).join('')}<button class="p-link" data-action="profile" data-id="${blocked[0].id}">Abrir o perfil de ${esc(blocked[0].name.split(' ')[0])} →</button></div>`;
    return `${head}
      <div class="comparison-board"><div class="compare-person">${C.avatar(a)}<div><p>${a.months} meses no recorte</p><h3>${esc(a.name)}</h3>${followButton(a.id,true)}</div><button data-action="evidence" data-id="${a.id}" data-kind="gastos" class="compare-total">${compact(av)} →</button></div><div class="comparison-center"><span class="vs">×</span>${cmp.equal?`<strong>${cmp.percent===null?money(0):'0%'}</strong><p>Valores iguais</p>`:cmp.percent===null?`<strong>${compact(cmp.diff)}</strong><p>${cmp.more?'a mais':'a menos'} para ${an} do que para ${bn}. ${bn} tem valor ${bv<0?'negativo':'zero'} neste recorte, então não há base para uma porcentagem.</p>`:`<strong>${number(cmp.percent)}%</strong><p>${cmp.more?'a mais':'a menos'} para ${an} do que para ${bn}</p>`}${editorial&&a.months!==b.months&&C.state.metric!=='mensal'?`<p class="tenure-note">Meses no recorte diferentes (${a.months} × ${b.months}). Compare por mês.</p>`:''}<button data-p="compare-evidence">Como chegamos nisso? →</button></div><div class="compare-person second">${C.avatar(b)}<div><p>${b.months} meses no recorte</p><h3>${esc(b.name)}</h3>${followButton(b.id,true)}</div><button data-action="evidence" data-id="${b.id}" data-kind="gastos" class="compare-total">${compact(bv)} →</button></div></div>
      <div class="compare-breakdown">${(()=>{const cats=window.ClareiaData.categories,val=(p,cat)=>C.sum(C.cells(p).filter(r=>r.category===cat))/(C.state.metric==='mensal'?p.months:1),max=Math.max(1,...cats.flatMap(cat=>[Math.abs(val(a,cat)),Math.abs(val(b,cat))]));return cats.map(cat=>{const x=val(a,cat),y=val(b,cat);return `<div class="compare-category"><span>${compact(x)}</span><div class="left-bar"><i style="width:${Math.abs(x)/max*100}%"></i></div><b>${esc(lab(cat))}</b><div class="right-bar"><i style="width:${Math.abs(y)/max*100}%"></i></div><span>${compact(y)}</span></div>`;}).join('')})()}</div><div class="compare-foot"><p>${C.span()} · ${catText(C.state.category)} · ${C.state.metric==='mensal'?'média por mês no recorte':'total de despesas'}${a.months!==b.months?' · tempos em exercício diferentes':''}</p><button class="p-link" data-p="ask-comparison">Investigar esta comparação ${icon('arrow')}</button></div>${linkedExplorer()}`;
  }
  function directoryCards() {
    const normalize=s=>s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const ppl=C.all().filter(p=>normalize(p.name).includes(normalize(state.rosterQuery))),shown=ppl.slice(0,state.rosterLimit);
    const head=editorial&&ppl.length?`<div class="directory-head" aria-hidden="true"><span>Representante</span><span>Despesas ${C.state.metric==='mensal'?'por mês':'no recorte'}</span><span>Projetos${C.state.metric==='mensal'&&!window.ClareiaData.billsApproved?' por mês':''}</span><span></span></div>`:'';
    return ppl.length?head+shown.map(p=>`<article class="directory-card"><div class="directory-person">${C.avatar(p)}<div><h3>${esc(p.name)}</h3><p>${esc(C.context(p))} · ID Câmara ${p.officialId}</p></div>${followButton(p.id)}</div><div class="directory-stats"><button data-action="evidence" data-id="${p.id}" data-kind="gastos">${p.noExercise?`<b class="no-exercise">Sem exercício confirmado em ${C.state.year}</b><small>não entra no ranking de gastos</small>`:p.heldMonths?.length&&!p.cells.length?`<b class="no-exercise">Em revisão</b><small>${p.heldMonths.length===1?'1 mês':p.heldMonths.length+' meses'} aguardando conferência</small>`:`<b>${compact(C.sum(C.cells(p))/(C.state.metric==='mensal'?p.months:1))}</b><small class="${p.heldMonths?.length||C.fewMonths(p)?'held-tag':''}">${p.heldMonths?.length?`parcial · ${p.heldMonths.length===1?'1 mês':p.heldMonths.length+' meses'} em revisão`:C.fewMonths(p)?`exerceu ${p.exercisedMonths} de ${window.ClareiaData.coverage.length} meses · fora do ranking`:`despesas ${C.state.metric==='mensal'?'por mês':'no recorte'}`}</small>`}</button><button data-action="evidence" data-id="${p.id}" data-kind="projetos"><b>${p.projects===null?C.pending:number(p.projects)}</b><small>${p.projects===null?`projetos ${C.state.metric==='mensal'?'por mês':'apresentados'}`:'projetos como proponente'}</small></button></div><div class="directory-actions"><button data-action="profile" data-id="${p.id}">Abrir perfil →</button>${C.comparable(p)?`<button data-p-add-compare="${p.id}">Comparar +</button>`:''}</div></article>`).join('')+C.listMore(ppl.length,state.rosterLimit,ROSTER_STEP,'roster','deputados'):'<div class="empty-state"><b>Nenhum perfil encontrado.</b><p>A busca consulta os deputados desta versão.</p><button class="outline-button" data-p="clear-directory">Limpar filtros</button></div>';
  }
  function directory() {
    return `<div class="directory-heading"><h3>Encontre um representante</h3><span>${C.all().length} deputados · ${C.span()}</span></div><div class="directory-controls"><label><span class="sr-only">Nome do representante</span><input id="roster-query" placeholder="Buscar por nome" value="${esc(state.rosterQuery)}"></label></div><div class="directory-grid" id="directory-grid" aria-live="polite">${directoryCards()}</div>`;
  }
  function projectCards() { return ''; }

  const activityCache=new Map();
  const activityData=id=>{if(!activityCache.has(id))activityCache.set(id,fetch(window.ClareiaData.activityUrl(id)).then(r=>{if(!r.ok)throw new Error();return r.json();}).catch(error=>{activityCache.delete(id);throw error;}));return activityCache.get(id);};
  const shortDatePlain=value=>value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'';
  const LIST_STEP=5,listState={bills:{limit:LIST_STEP,query:''},votes:{limit:LIST_STEP,query:''}};let activityShown=null;
  const folded=text=>String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const listRows=kind=>{const q=folded(listState[kind].query).trim(),all=activityShown?activityShown[kind]:[];if(!q)return all;if(kind==='votes'&&all.some(x=>folded(x.category)===q))return all.filter(x=>folded(x.category)===q);return all.filter(x=>folded(kind==='bills'?`${x.type} ${x.number}/${x.year} ${x.summary} ${x.situation||'Situação não informada'} ${x.norm?x.norm.kind+' '+x.norm.number+'/'+x.norm.year:''}`:`${shortDatePlain(x.date)} ${x.organ} ${KIND[x.kind]||'Outro'} ${x.description} ${x.matters.join(' ')}`).includes(q)||kind==='votes'&&folded(x.category)===q);};
  function renderList(kind){const box=$(`#${kind}-rows`);if(!box||!activityShown)return;const rows=listRows(kind),shown=rows.slice(0,listState[kind].limit),noun=kind==='bills'?'projeto':'voto',query=listState[kind].query.trim();box.innerHTML=`<p class="p-small activity-count">Mostrando ${number(shown.length)} de ${number(rows.length)} ${noun}${rows.length===1?'':'s'}</p><ul class="activity-list">${shown.map(kind==='bills'?billItem:voteItem).join('')||`<li class="p-small">${query?'Nada encontrado para essa busca.':`Nenhum ${noun} nesta versão.`}</li>`}</ul>${rows.length>shown.length?`<button class="outline-button activity-more" data-p="activity-more" data-kind="${kind}">Mostrar mais ${Math.min(LIST_STEP,rows.length-shown.length)}</button>`:''}`;}
  const activitySearch=kind=>`<label class="activity-search"><span class="sr-only">Buscar ${kind==='bills'?'projetos':'votações'}</span><input id="activity-search-${kind}" type="search" autocomplete="off" placeholder="${kind==='bills'?'Buscar por número ou assunto':'Buscar por assunto, tipo ou voto'}" value="${esc(listState[kind].query)}"></label>`;
  const activityPerson=()=>state.activity&&C.person(state.activity)?state.activity:C.byTotal()[0].id;
  const activitySelect=name=>`<div class="person-pick"><label class="activity-person">Deputado<select id="activity-${name}">${[...C.all()].sort(byName).map(p=>`<option value="${p.id}" ${p.id===activityPerson()?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${personFilter('activity-'+name)}</div>`;
  const KIND={merito:'Mérito',requerimento:'Requerimento',destaque:'Emenda ou destaque',outro:'Outro'};
  const shortDate=value=>value?esc(value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4)):'';
  function billItem(b){const role=b.proponent?(b.joint?'Proponente, em conjunto':'Proponente'):'Coautoria';return `<li class="activity-item"><div class="activity-meta"><b>${esc(b.type)} ${b.number}/${b.year}</b><span>${role}</span></div><p>${esc(b.summary)}</p><p class="activity-state">${b.norm?`Virou ${esc(b.norm.kind)} ${esc(b.norm.number)}/${b.norm.year}`:esc(b.situation||'Situação não informada')}${b.situationAt?` · situação em ${shortDate(b.situationAt)}`:''}</p><a class="p-link" href="https://www.camara.leg.br/propostas-legislativas/${b.id}" rel="noopener" target="_blank">Ver na Câmara ↗︎</a></li>`;}
  function voteItem(v){return `<li class="activity-item"><div class="activity-meta"><b>${shortDate(v.date)} · ${esc(v.organ)}</b><span>${KIND[v.kind]||'Outro'}</span></div>${v.matters.length?`<p class="activity-matter">${v.matters.map(esc).join(', ')}</p>`:''}<p>${esc(v.description)}</p><p class="activity-state">Voto registrado: <b>${esc(v.category)}</b></p><a class="p-link" href="https://dadosabertos.camara.leg.br/api/v2/votacoes/${encodeURIComponent(v.id)}" rel="noopener" target="_blank">Ver na fonte ↗︎</a></li>`;}
  // The sections stay in place on a change of deputy: only the finished list is swapped in, so the page never blanks.
  let activityRun=0;
  async function hydrateActivity(){
    const run=++activityRun,id=activityPerson(),person=C.person(id),official=person.officialId,info=window.ClareiaData.activitySummary(official);
    const fill=(selector,html)=>{const el=$(selector);if(el)el.innerHTML=html;};
    let data;try{data=await activityData(official);}catch{if(run!==activityRun)return;document.querySelectorAll('#bills-list,#votes-list').forEach(el=>el.removeAttribute('aria-busy'));fill('#bills-list','<p class="p-small">Lista indisponível nesta versão. Nenhum número foi estimado.</p>');fill('#votes-list','<p class="p-small">Lista indisponível nesta versão. Nenhum número foi estimado.</p>');return;}
    if(run!==activityRun)return;
    activityShown=data;
    document.querySelectorAll('#bills-list,#votes-list').forEach(el=>el.removeAttribute('aria-busy'));
    if(info?.bills){fill('#bills-list',`<div class="activity-numbers"><div><strong>${number(info.bills.proposed)}</strong><span>como proponente${info.bills.joint?`, ${number(info.bills.joint)} em conjunto`:''}</span></div><div><strong>${number(info.bills.coauthored)}</strong><span>em coautoria</span></div><div><strong>${number(info.bills.norms)}</strong><span>viraram norma</span></div></div>${activitySearch('bills')}<div id="bills-rows"></div>`);renderList('bills');}
    if(info?.votes){fill('#votes-list',`${info.votesHeld?`<p class="p-small">${number(info.votesHeld)} voto(s) em votações retidas para revisão não entram nos números nem na lista.</p>`:''}<div class="activity-numbers">${Object.entries(info.votes).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`<div><strong>${number(n)}</strong><span>${esc(c)}</span></div>`).join('')}</div>${activitySearch('votes')}<div id="votes-rows"></div>`);renderList('votes');}
  }

  function projectSection() {
    if(window.ClareiaData.billsApproved){queueMicrotask(hydrateActivity);return `${intro('05','Atividade do mandato','Ideias em movimento.',`PL, PLP e PEC de ${window.ClareiaData.billsYears.join(', ')}. Quantidade mostra atividade, não qualidade, e não é comparada com gastos.`)}${activitySelect('bills')}<div id="bills-list" aria-live="polite"><p class="p-small">Carregando…</p></div>`;}
    return `${intro('05','Além da quantidade','Ideias em movimento.','Apresentar um projeto é só o começo. Explore a proposta, a autoria e cada etapa do caminho.',badge('Próxima etapa'))}<div class="empty-state real-pending"><b>Projetos de lei ainda não foram coletados.</b><p>A próxima etapa traz PL, PLP e PEC da Câmara, separando autoria principal de coautoria e mostrando quais viraram lei. Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function voteCards() { return ''; }

  function voteSection() {
    if(window.ClareiaData.votesApproved){queueMicrotask(hydrateActivity);return `${intro('06','O voto e seu contexto','Como decidiram?',`Votações nominais de ${window.ClareiaData.votesYears.join(', ')}. Voto registrado não é presença nem falta.`)}${activitySelect('votes')}<div id="votes-list" aria-live="polite"><p class="p-small">Carregando…</p></div>`;}
    return `${intro('06','O voto e seu contexto','Como decidiram?', 'O objeto da votação vem antes do placar. Veja a etapa, o texto em discussão e a participação de cada pessoa.',badge('Próxima etapa'))}<div class="empty-state real-pending"><b>Votações nominais ainda não foram coletadas.</b><p>A próxima etapa separa a votação do projeto da votação de requerimentos e destaques. Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function moreSection() {
    return `${intro('07','Conecte as peças','Um mandato tem muitas dimensões.','Trajetória, eleições, patrimônio declarado e emendas entram nas próximas etapas.')}<div class="empty-state real-pending"><b>Eleições, patrimônio e emendas ainda não foram coletados.</b><p>Essas camadas dependem de outras fontes oficiais (TSE e Portal da Transparência). Nenhum número aparece aqui antes de ser conferido com a fonte oficial.</p></div>`;
  }

  function events(id) { const p=C.person(id); return [
    {date:C.span().toUpperCase(),title:'Despesas publicadas',text:`Registros oficiais da cota parlamentar de ${esc(p.name)}, conferidos registro por registro.`,action:'records',value:id},
    ...(window.ClareiaData.billsApproved&&window.ClareiaData.votesApproved?[]:[{date:'PRÓXIMA ETAPA',title:'Projetos e votações',text:'Ainda não coletados. Entram quando forem conferidos com a fonte oficial.',action:'profile',value:id}])
  ]; }

  function timeline() {return events(state.timeline).map((e,i)=>`<button class="timeline-event p-reveal" data-p-event="${e.action}" data-value="${e.value}"><span class="timeline-dot"></span><time>${e.date}</time><div><h3>${e.title}</h3><p>${e.text}</p></div>${ext()}</button>`).join('');}
  function savedList() {
    return state.favorites.size?`<div class="saved-people">${[...state.favorites].map(id=>{const p=C.person(id);return `<div>${C.avatar(p)}<button data-action="profile" data-id="${id}"><b>${esc(p.name)}</b><small>${esc(p.uf)} · abrir perfil</small></button>${followButton(id)}</div>`;}).join('')}</div>`:`<div class="saved-empty"><span class="saved-orbit" aria-hidden="true">+</span><h3>Comece por uma pessoa.</h3><p>Salve um perfil e volte para explorar sua atividade.</p><button class="p-primary" data-p-follow="${C.byTotal()[0].id}">Acompanhar ${esc(C.byTotal()[0].name)} +</button></div>`;
  }
  function following() {
    return `${intro('08','A política continua','Acompanhe o que muda.','Construa sua própria lista de acompanhamento. Os favoritos ficam salvos apenas neste navegador.')}<div class="following-grid"><div class="timeline-panel"><div class="timeline-heading"><h3>Linha do tempo do mandato</h3><label class="sr-only" for="timeline-person">Pessoa da linha do tempo</label><select id="timeline-person">${peopleOptions(state.timeline,false)}</select>${personFilter('timeline-person')}</div><div class="timeline">${timeline()}</div><p class="p-small">Linha do tempo desta versão publicada.</p></div><aside class="saved-panel"><div class="saved-heading"><h3>Meu acompanhamento</h3><span>${state.favorites.size}</span></div><div id="saved-list">${savedList()}</div><div class="saved-projects"><span>Projetos acompanhados</span><b>${state.projects.size}</b>${state.projects.size?`<div>${[...state.projects].map(id=>`<button data-p-project="${id}">DEMO ${id} ↗︎</button>`).join('')}</div>`:''}</div><button class="outline-button weekly-button" data-p="brief" ${!state.favorites.size?'disabled':''}>Abrir resumo dos acompanhados ${icon('arrow')}</button><p class="p-small">Sem cadastro. Nenhum e-mail ou alerta externo é enviado.</p></aside></div>`;
  }
  function closing() {
    return `<div class="closing-top">${label('09','A sua próxima pergunta')}<h2>Curiosidade é <br>um bom começo.</h2><p>Você não precisa conhecer o vocabulário do Congresso. <br>Comece com uma pergunta. Termine nos registros.</p><div class="closing-questions">${['Quem mais gastou por mês?',`Compare ${C.byTotal()[0].name.split(' ')[0]} e ${C.byTotal()[1].name.split(' ')[0]}`,'Quem gastou menos?'].map(q=>`<button data-question="${esc(q)}">${esc(q)}${icon('arrow')}</button>`).join('')}</div></div><div class="trust-row"><div><span>01</span><h3>Fonte à vista</h3><p>Cada número tem um caminho até os registros.</p></div><div><span>02</span><h3>Contexto primeiro</h3><p>Período, cobertura e definição acompanham a comparação.</p></div><div><span>03</span><h3>Limites explícitos</h3><p>Ausência de dados nunca vira zero ou uma resposta inventada.</p></div></div><button class="p-link" data-action="methodology">Conheça a metodologia ${ext()}</button>`;
  }
  const sections = [['panorama',overview],['despesas',spending],['atlas',atlas],['pessoas',directory],['comparacao',comparison],['projetos',projectSection],['votacoes',voteSection],['dimensoes',moreSection],['acompanhar',following],['perguntar',closing]];
  function mount() {
    const main=$('#main');
    main.insertAdjacentHTML('afterbegin',`<div class="page-progress" aria-hidden="true"><i></i></div><nav class="section-dock" aria-label="Seções da página"><a href="#rankings">Rankings</a><a href="#despesas">${editorial?'Gastos':'Despesas'}</a><a href="#atlas">Mapa</a>${editorial?'':'<a href="#comparacao">Comparar</a>'}<a href="#projetos">Projetos</a><a href="#votacoes">Votações</a><a href="#acompanhar" class="follow-nav">Acompanhar <span class="follow-count" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg><span id="saved-count">${state.favorites.size||''}</span></span></a><button type="button" id="dock-filter" class="dock-filter" data-action="reset" hidden></button></nav>`);
    C.scopeChip();
    main.insertAdjacentHTML('beforeend',`<div class="full-portal">${sections.map(([id,render])=>`<section class="p-section" id="${id}">${render()}</section>`).join('')}</div>`);
    $('.footer').innerHTML=`<div class="footer-brand"><span class="logo">${C.logo}</span><p>Entenda. Confira. Acompanhe.</p></div><div class="footer-links"><a href="#despesas">Gastos por categoria</a><a href="#comparacao">Comparar</a><button data-action="methodology">Fontes e metodologia</button><button data-p="coverage">Cobertura desta versão</button><button data-p="reset-saved">Apagar favoritos locais</button></div><div class="footer-disclaimer"><span>Versão ${C.span()}</span><p>Dados oficiais da Câmara dos Deputados, ${C.span()}. Versão de teste. Busca por regras locais, sem IA conectada.</p><button data-p="top">Voltar ao topo ↑</button></div>`;
    document.body.insertAdjacentHTML('beforeend',`<button class="assistant-launcher" data-p="assistant" aria-label="${editorial?'Fazer uma pergunta na busca':'Abrir assistente de investigação'}"><img class="assistant-spark" src="/icon.svg" alt="" width="24" height="24"><span>${editorial?'Fazer uma pergunta':'Pergunte ao Clareia'}</span>${icon('arrow')}</button>`);
    document.body.dataset.motion=state.motion?'on':'off';
    watchMotion(); watchSections(); fitChartHits();
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
  function animateCounter(el) { const target=el.querySelector('[data-counter]');if(!target)return;const value=+target.dataset.counter,start=performance.now();target.textContent=target.dataset.format==='money'?compact(value):number(value);target.style.display='inline-block';target.style.minWidth=target.getBoundingClientRect().width+'px';function frame(now){if(!target.isConnected)return;const t=Math.min(1,(now-start)/700),n=Math.round(value*(1-Math.pow(1-t,3)));target.textContent=target.dataset.format==='money'?compact(n):number(n);if(t<1&&state.motion)requestAnimationFrame(frame);else{target.textContent=target.dataset.format==='money'?compact(value):number(value);target.style.display=target.style.minWidth='';}}requestAnimationFrame(frame); }
  // Position-based spy: the current section is the last one whose top has passed 35% of the viewport; none above the first.
  function spySections() {
    const line=innerHeight*.35; let cur=null;
    document.querySelectorAll('#rankings,.p-section').forEach(el=>{if(el.getBoundingClientRect().top<=line)cur=el.id;});
    document.querySelectorAll('.section-dock a').forEach(a=>{const on=a.hash==='#'+cur;a.classList.toggle('current',on);if(on)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
  }
  function watchSections() { spySections(); }
  // Each point gets a 44px square hit area in screen pixels (the SVG is scaled), trimmed at the midpoint to the nearest other point so areas never overlap.
  let watchedSvg=null;
  const chartWatch=new ResizeObserver(()=>fitChartHits());
  function fitChartHits() {
    const svg=$('.linked-lines');
    // Observing again on every call would re-fire the first notification, which calls this function again, forever.
    if(svg!==watchedSvg){chartWatch.disconnect();watchedSvg=svg;if(svg)chartWatch.observe(svg);}
    if(!svg)return;
    const scale=svg.getBoundingClientRect().width/760;
    if(!scale)return;
    const pts=[...svg.querySelectorAll('.chart-point')].map(g=>({g,x:+g.dataset.cx*scale,y:+g.dataset.cy*scale}));
    for(const p of pts){
      const room={l:44,r:44,t:44,b:44};
      for(const o of pts){
        if(o===p)continue;
        const dx=o.x-p.x,dy=o.y-p.y;
        if(Math.max(Math.abs(dx),Math.abs(dy))>=44)continue;
        if(Math.abs(dx)>=Math.abs(dy))room[dx>=0?'r':'l']=Math.min(room[dx>=0?'r':'l'],Math.abs(dx));
        else room[dy>=0?'b':'t']=Math.min(room[dy>=0?'b':'t'],Math.abs(dy));
      }
      const cx=+p.g.dataset.cx,cy=+p.g.dataset.cy,r=p.g.querySelector('.chart-hit'),l=Math.min(22,room.l/2)/scale,rt=Math.min(22,room.r/2)/scale,t=Math.min(22,room.t/2)/scale,b=Math.min(22,room.b/2)/scale;
      r.setAttribute('x',cx-l);r.setAttribute('y',cy-t);r.setAttribute('width',l+rt);r.setAttribute('height',t+b);
    }
  }
  function renderPart(id,render) { const el=$('#'+id); if(el)el.innerHTML=render(); if(id==='comparacao')fitChartHits(); }
  function updateSpending() {
    // Keep the actual range input mounted so dragging retains pointer capture.
    const temp=document.createElement('div');temp.innerHTML=spending();
    for(const selector of ['.donut-panel','.p-mini-bars','.supplier-list','.supplier-more', ...(editorial?['.category-focus']:[])]) $('#despesas '+selector).innerHTML=temp.querySelector(selector).innerHTML;
    $('#despesas .spend-scope').textContent=temp.querySelector('.spend-scope').textContent;
    $('#despesas output')&&($('#despesas output').textContent=rangeText());
    $('#spend-range')?.setAttribute('aria-valuetext',rangeValueText());
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
  // The dialog starts from the summary totals, one row per deputy; a deputy's records file is fetched only when that row is opened.
  const EVIDENCE_STEP=10;
  let evidence=null;
  const atMonth=(month,fn)=>{const before=state.month;state.month=month;try{return fn();}finally{state.month=before;}};
  function expenseEvidence(category,supplier,month=state.month,keep=false) {
    return atMonth(month,()=>{
      const keepCategory=C.state.category,match=r=>r.month<month&&(!category||r.category===category)&&(!supplier||r.supplier===supplier);
      const rows=scopePeople().map(p=>{const cells=C.cells(p).filter(match);return {p,count:C.count(cells),total:C.sum(cells)};}).filter(x=>x.count).sort((a,b)=>b.total-a.total||a.p.name.localeCompare(b.p.name,'pt-BR'));
      const same=keep&&evidence&&evidence.category===category&&evidence.supplier===supplier&&evidence.month===month;
      evidence={category,supplier,month,match,keepCategory,rows,scope:[scopeText(periodText()),category?esc(lab(category)):''].filter(Boolean).join(' · '),title:category?lab(category):'Como chegamos nisso?',source:category?`<p class="records-note">Nome na fonte: ${esc(category)}</p>`:'',query:same?evidence.query:'',limit:same?evidence.limit:EVIDENCE_STEP};
      if(rows.length===1)return personEvidence(rows[0].p.id);
      C.rememberList(()=>expenseEvidence(category,supplier,month,true));
      const total=rows.reduce((n,x)=>n+x.total,0),count=rows.reduce((n,x)=>n+x.count,0);
      C.showDialog(evidence.title,`<p class="dialog-subtitle">Despesas por deputado.</p><p class="records-note">${evidence.scope}</p>${evidence.source}<div class="calculation-result">${money(total)}<small>Soma de ${number(count)} registros oficiais de ${number(rows.length)} deputados</small></div><label class="activity-search"><span class="sr-only">Buscar deputado</span><input id="evidence-search" type="search" autocomplete="off" placeholder="Buscar deputado" value="${esc(evidence.query)}"></label><div id="evidence-people"></div><p class="fixture-note">Salários, gabinete e emendas não entram nesta soma.</p>`);
      renderEvidencePeople();
    });
  }
  function renderEvidencePeople() {
    const box=$('#evidence-people');if(!box||!evidence)return;
    const q=folded(evidence.query).trim(),list=q?evidence.rows.filter(x=>folded(x.p.name).includes(q)):evidence.rows,shown=list.slice(0,evidence.limit);
    box.innerHTML=`<p class="p-small activity-count">Mostrando ${number(shown.length)} de ${number(list.length)} deputado${list.length===1?'':'s'}</p><table class="data-table evidence-people"><thead><tr><th>Deputado(a)</th><th>Registros</th><th>Valor líquido</th></tr></thead><tbody>${shown.map(x=>`<tr><td><button class="text-button" data-p-evidence-person="${x.p.id}">${esc(x.p.name)} →</button></td><td>${number(x.count)}</td><td>${money(x.total)}</td></tr>`).join('')||`<tr><td colspan="3">${q?'Nenhum deputado encontrado para essa busca.':'Nenhum registro neste recorte.'}</td></tr>`}</tbody></table>${list.length>shown.length?`<button class="outline-button activity-more" data-p="evidence-more">Mostrar mais ${Math.min(EVIDENCE_STEP,list.length-shown.length)}</button>`:''}`;
  }
  function personEvidence(id) {
    const view=evidence,p=view.rows.find(x=>x.p.id===id).p;
    C.rememberList(()=>{evidence=view;return personEvidence(id);});
    return C.withRecords([p],([list])=>{
      const items=list.filter(r=>view.match(r)&&(view.keepCategory==='Todas'||r.category===view.keepCategory)).sort(C.byRecordOrder),total=C.sum(items);
      C.showDialog(view.title,`<p class="dialog-subtitle">${esc(p.name)}, registro por registro.</p><p class="records-note">${view.scope}</p>${view.source}<div class="calculation-result">${money(total)}<small>Soma de ${items.length} registros oficiais</small></div>${view.rows.length>1?'<button class="text-button" data-p="evidence-back">← Voltar a todos os deputados</button>':''}${C.recordListHTML('Registros das despesas',items.map(r=>C.recordRow(p,r,true)),total)}<p class="fixture-note">Salários, gabinete e emendas não entram nesta soma.</p>`);
      $('#detail').classList.add('records-wide');
    });
  }
  function supplierDetail(category) {
    const rows=scopeRecords().filter(r=>r.category===category);
    const by=new Map();for(const r of rows){const t=by.get(r.supplier)||{total:0,count:0};t.total+=r.amount;t.count+=r.count;by.set(r.supplier,t);}
    const names=[...by.keys()].sort((a,b)=>by.get(b).total-by.get(a).total||a.localeCompare(b,'pt-BR'));
    C.showDialog('Da categoria ao fornecedor',`<p class="records-note">${esc(lab(category))} · ${scopeText(periodText())}</p><p class="records-note">Nome na fonte: ${esc(category)}</p><div class="calculation-result">${money(C.sum(rows))}<small>Soma dos registros da categoria selecionada</small></div><div class="supplier-list">${names.map(name=>`<button data-p-supplier="${esc(name)}" data-category="${esc(category)}"><span>${esc(name)}<small>${by.get(name).count} registros oficiais</small></span><b>${money(by.get(name).total)}</b>↗︎</button>`).join('')||'<p>Sem registros neste recorte.</p>'}</div><p class="fixture-note">Clique no fornecedor para abrir os registros. Na produção, o vínculo dependerá do identificador oficial; nomes parecidos não bastam.</p>`);
  }
  function projectDetail() {}

  function voteDetail() {}

  function dossier() { C.showDialog('Ainda não coletado','<p>Eleições, patrimônio e emendas ainda não foram coletados e conferidos.</p>'); }

  function summary(key) {
    if(key==='expenses'||key==='records'){expenseEvidence(undefined,undefined,12);return;}
    const ppl=scopePeople();
    C.showDialog('Como chegamos nisso?',`<p class="records-note">${scopeText()} · contagem dos deputados desta versão</p><table class="data-table"><thead><tr><th>Deputado(a)</th><th>ID Câmara</th></tr></thead><tbody>${ppl.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.officialId)}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><td>${ppl.length}</td></tr></tfoot></table><p class="fixture-note">Não há avaliação de qualidade do mandato.</p>`);
  }
  function brief() {C.showDialog('Seu resumo de acompanhamento',`<p class="records-note">Seleção local · ${C.span()}. Nenhuma notificação foi enviada.</p>${[...state.favorites].map(id=>`<section class="brief-person"><h3>${esc(C.person(id).name)}</h3>${events(id).slice(0,2).map(e=>`<button data-p-event="${e.action}" data-value="${e.value}"><small>${e.date}</small><b>${e.title}</b><span>${e.text} ↗︎</span></button>`).join('')}</section>`).join('')||'<p>Acompanhe uma pessoa para montar seu resumo.</p>'}`);}
  function assistant() {C.showDialog('Sua investigação começa aqui',`<div class="assistant-intro"><img class="assistant-spark" src="/icon.svg" alt="" width="24" height="24"><h3>Qual número você quer entender?</h3><p>Escolha uma pergunta ou escreva a sua. A busca consulta os registros oficiais desta versão, sem IA conectada.</p></div><form id="assistant-form"><label class="sr-only" for="assistant-query">Sua pergunta</label><textarea id="assistant-query" placeholder="Ex.: quem mais gastou por mês?" maxlength="300" required></textarea><button class="p-primary" type="submit">Investigar ${icon('arrow')}</button></form><div class="assistant-examples">${['Quem mais gastou por mês?','Quem mais gastou com passagens?','Quem gastou menos?'].map(q=>`<button data-p-ask="${esc(q)}">${esc(q)}${icon('arrow')}</button>`).join('')}</div><p class="p-small">Cobertura: ${C.all().length} deputados, despesas de ${C.span()}.</p>`);setTimeout(()=>$('#assistant-query')?.focus(),30);}
  function runAsk(q) {C.closeDialog().then(()=>{C.ask(q);$('#answer-slot').scrollIntoView({behavior:state.motion?'smooth':'instant',block:'center'});});}
  C.portalActive=()=>state.month!==COVER||state.highlightCategory!==null||state.mapUF!==null||state.mapMetric!=='total'||state.from!==1||state.to!==COVERAGE.length;
  const homeTitle=document.title;
  const syncEstado=()=>C.setPath(state.mapUF?`/estado/${state.mapUF}`:'/',state.mapUF?`${UF[state.mapUF][0]} — Clareia`:homeTitle);
  document.addEventListener('clareia:reset',()=>{state.month=COVER;state.highlightCategory=null;state.mapUF=null;syncEstado();state.mapMetric='total';state.from=1;state.to=COVERAGE.length;});
  document.addEventListener('clareia:change',updateAll);
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-p-highlight],[data-p],[data-p-follow],[data-p-uf],[data-p-category],[data-p-supplier],[data-p-evidence-person],[data-p-drill],[data-p-month],[data-p-metric],[data-p-topic],[data-p-project],[data-p-project-save],[data-p-vote],[data-p-dossier],[data-p-event],[data-p-summary],[data-p-ask],[data-p-add-compare]');if(!b)return;
    if(b.dataset.pHighlight){const slice=b.hasAttribute('data-donut-slice');state.highlightCategory=state.highlightCategory===b.dataset.pHighlight?null:b.dataset.pHighlight;updateSpending();focusMatch(`${slice?'[data-donut-slice]':'.donut-legend button'}[data-p-highlight="${CSS.escape(b.dataset.pHighlight)}"]`);previewDonut(null);return;}
    if(b.dataset.pEvidencePerson){personEvidence(b.dataset.pEvidencePerson);return;}
    if(b.dataset.pSupplier){expenseEvidence(b.dataset.category,b.dataset.pSupplier);return;}
    if(b.dataset.pDrill){supplierDetail(b.dataset.pDrill);return;}
    if(b.dataset.pAddCompare){state.a=b.dataset.pAddCompare;if(state.b===state.a)state.b=C.byTotal().find(p=>p.id!==state.a).id;renderPart('comparacao',comparison);if(editorial){C.toast(`${C.person(state.a).name.split(' ')[0]} entrou na comparação, ao lado de ${C.person(state.b).name.split(' ')[0]}.`);const h=$('#comparacao h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}$('#comparacao').scrollIntoView({behavior:state.motion?'smooth':'instant',block:'start'});return;}
    if(b.dataset.pFollow){const id=b.dataset.pFollow;state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);save('clareia-favorites',[...state.favorites]);const section=b.closest('.p-section');updateSaved();(section?.querySelector(`[data-p-follow="${id}"]`)||section?.querySelector('[data-p-follow]'))?.focus({preventScroll:true});C.toast(state.favorites.has(id)?'Perfil salvo neste navegador.':'Perfil removido do acompanhamento.');return;}
    if(b.dataset.pUf){state.mapUF=b.dataset.pUf;state.mapLimit=MAP_STEP;syncEstado();renderPart('atlas',atlas);focusMatch(`[data-p-uf="${state.mapUF}"]`);return;}
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
            case 'more-suppliers':{const before=state.supplierLimit;state.supplierLimit+=SUPPLIER_STEP;updateSpending();focusMatch(`#despesas .supplier-list > button:nth-child(${before+1})`);break;}
            case 'fewer-suppliers':state.supplierLimit=8;updateSpending();focusMatch('#supplier-search');break;
            case 'evidence-more':{const before=evidence.limit;evidence.limit+=EVIDENCE_STEP;renderEvidencePeople();($(`#evidence-people tbody tr:nth-child(${before+1}) button`)||$('[data-p=evidence-more]'))?.focus();break;}
            case 'evidence-back':expenseEvidence(evidence.category,evidence.supplier,evidence.month,true);break;
      case 'clear-highlight':state.highlightCategory=null;updateSpending();focusMatch('.donut-legend button:not(:disabled)');break;
      case 'spend-evidence':expenseEvidence();break;
      case 'map-evidence':C.showDialog('Como calculamos o mapa?',`<p class="records-note">${C.span()} · ${state.mapMetric==='projects'?'autoria principal':catText(C.state.category)}</p><p>UF de representação, não destino da despesa. Média por representante = soma das despesas dividida pelo número de perfis da UF; não ajusta tempo em exercício.</p><table class="data-table"><thead><tr><th>UF</th><th>Perfis</th><th>Valor</th></tr></thead><tbody>${Object.entries(UF).filter(([uf])=>C.all().some(p=>!p.noExercise&&p.uf===uf)).map(([uf,[name]])=>`<tr><td>${uf} / ${name}</td><td>${C.all().filter(p=>!p.noExercise).filter(p=>p.uf===uf).length}</td><td>${mapFormat(mapValue(uf))}</td></tr>`).join('')}</tbody></table><p class="fixture-note">UF de representação conforme o cadastro da Câmara. UFs sem deputados neste recorte aparecem como indisponíveis; indisponível não significa zero.</p>`);break;
      case 'map-metric':state.mapMetric=b.dataset.value;renderPart('atlas',atlas);focusMatch('[data-p=map-metric][data-value='+state.mapMetric+']');break;
      case 'activity-more':{const kind=b.dataset.kind;listState[kind].limit+=LIST_STEP;renderList(kind);focusMatch(`[data-p=activity-more][data-kind=${kind}]`);break;}
      case 'map-reset':state.mapUF=null;syncEstado();renderPart('atlas',atlas);focusMatch('[data-p=map-reset]');break;
      case 'apply-state':{const local=C.all().filter(p=>!p.noExercise&&p.uf===state.mapUF);state.a=local[0].id;state.b=(local[1]||C.byTotal().find(p=>p.id!==state.a)).id;C.state.uf=state.mapUF;C.refresh();}C.toast(`Recorte aplicado: ${UF[state.mapUF][0]}.`);break;
      case 'swap':[state.a,state.b]=[state.b,state.a];renderPart('comparacao',comparison);focusMatch('[data-p="swap"]');break;
      case 'compare-evidence':C.evidence(state.a,{kind:'gastos',compare:state.b});break;
      case 'ask-comparison':runAsk(`Compare ${C.person(state.a).name} e ${C.person(state.b).name} em ${C.state.year}${C.state.metric==='mensal'?' por mês':''}${C.state.category!=='Todas'?' com '+lab(C.state.category):''}`);break;
      case 'clear-projects':state.topic='Todos';state.stage='Todos';state.projectQuery='';renderPart('projetos',projectSection);watchMotion();break;
      case 'clear-directory':state.rosterQuery='';state.rosterUF='Todos';state.rosterParty='Todos';renderPart('pessoas',directory);$('#roster-query')?.focus();break;
      case 'brief':brief();break;
      case 'assistant':if(editorial){$('#query').scrollIntoView({block:'center',behavior:state.motion?'smooth':'instant'});$('#query').focus({preventScroll:true});}else assistant();break;
      case 'top':window.scrollTo({top:0,behavior:state.motion?'smooth':'instant'});break;
      case 'coverage':C.showDialog('Cobertura desta versão',`<div class="text-content"><h3>O que esta versão cobre.</h3><p>${C.all().length} deputados, ${C.span()}, despesas da cota parlamentar com dados oficiais da Câmara.</p><p>${window.ClareiaData.billsApproved||window.ClareiaData.votesApproved?`${[window.ClareiaData.billsApproved?'':'Projetos',window.ClareiaData.votesApproved?'':'Votações','Eleições','patrimônio e emendas'].filter(Boolean).join(', ')} ainda não foram publicados nesta versão.`:'Projetos, votações, eleições, patrimônio e emendas ainda não foram coletados; as seções aparecem com o aviso “ainda não coletado”.'}</p><p>A busca usa regras locais, sem IA conectada. Favoritos ficam só neste navegador.</p></div>`);break;
      case 'reset-saved':state.favorites.clear();state.projects.clear();save('clareia-favorites',[]);save('clareia-projects',[]);updateAll();updateFollowCount();C.toast('Favoritos locais apagados.');break;
    }
  });
  document.addEventListener('click',e=>{
    const m=e.target.closest('[data-action=map-more],[data-action=map-less]');
    if(m){const before=state.mapLimit,more=m.dataset.action==='map-more';state.mapLimit=more?before+MAP_STEP:MAP_STEP;renderPart('atlas',atlas);(more?document.querySelectorAll('.atlas-people > div')[before]?.querySelector('button'):$('[data-action=map-more]'))?.focus({preventScroll:more});return;}
    const b=e.target.closest('[data-action=roster-more],[data-action=roster-less]');if(!b)return;
    const before=state.rosterLimit,more=b.dataset.action==='roster-more';state.rosterLimit=more?before+ROSTER_STEP:ROSTER_STEP;
    renderPart('directory-grid',directoryCards);
    (more?document.querySelectorAll('#directory-grid .directory-card')[before]?.querySelector('button'):$('[data-action=roster-more]'))?.focus({preventScroll:more});
  });
  // Suggestions come from the full list in the select; choosing one sets the select, so every existing handler runs unchanged.
  function filterPeople(input){
    const select=$('#'+input.dataset.filter),list=$('#'+input.dataset.filter+'-options');if(!select||!list)return;
    const q=folded(input.value).trim(),found=q?[...select.options].filter(o=>folded(o.text).includes(q)):[];
    list.innerHTML=found.slice(0,50).map((o,i)=>`<li id="${list.id}-${i}" role="option" data-value="${esc(o.value)}" aria-selected="false">${esc(o.text)}</li>`).join('')||(q?'<li class="person-none" aria-disabled="true">Nenhum deputado encontrado</li>':'');
    list.hidden=!q;input.setAttribute('aria-expanded',String(!!q));input.removeAttribute('aria-activedescendant');
  }
  function pickPerson(input,value){
    const select=$('#'+input.dataset.filter);if(!select||!value)return;
    const list=$('#'+input.dataset.filter+'-options');if(list)list.hidden=true;input.setAttribute('aria-expanded','false');
    if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  document.addEventListener('keydown',e=>{
    const input=e.target.closest?.('.person-filter');if(!input)return;
    const list=$('#'+input.dataset.filter+'-options'),items=list?[...list.querySelectorAll('[role=option]')]:[];
    if(e.key==='Escape'){if(list&&!list.hidden){list.hidden=true;input.setAttribute('aria-expanded','false');e.preventDefault();}return;}
    if(!items.length)return;
    const at=items.findIndex(li=>li.getAttribute('aria-selected')==='true');
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=e.key==='ArrowDown'?Math.min(items.length-1,at+1):Math.max(0,at-1);items.forEach((li,i)=>li.setAttribute('aria-selected',String(i===next)));input.setAttribute('aria-activedescendant',items[next].id);items[next].scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'){e.preventDefault();pickPerson(input,(items[at]||items[0]).dataset.value);}
  });
  // mousedown keeps the focus in the box until the choice is made.
  document.addEventListener('mousedown',e=>{const li=e.target.closest?.('.person-options [role=option]');if(!li)return;e.preventDefault();pickPerson($('#'+li.closest('.person-options').id.replace(/-options$/,'')+'-filter'),li.dataset.value);});
  document.addEventListener('focusout',e=>{const input=e.target.closest?.('.person-filter');if(!input)return;setTimeout(()=>{const list=$('#'+input.dataset.filter+'-options');if(list&&document.activeElement!==input){list.hidden=true;input.setAttribute('aria-expanded','false');}},120);});
  document.addEventListener('input',e=>{
    if(e.target.classList.contains('person-filter')){filterPeople(e.target);return;}
    if(e.target.id==='supplier-search'){state.supplierQuery=e.target.value;state.supplierLimit=8;updateSpending();return;}
    if(e.target.id==='evidence-search'&&evidence){evidence.query=e.target.value;evidence.limit=EVIDENCE_STEP;renderEvidencePeople();return;}
    const search=/^activity-search-(bills|votes)$/.exec(e.target.id||'');if(search){listState[search[1]].query=e.target.value;listState[search[1]].limit=LIST_STEP;renderList(search[1]);return;}
    if(e.target.id==='linked-from'||e.target.id==='linked-to'){const isFrom=e.target.id==='linked-from';state[isFrom?'from':'to']=+e.target.value;if(state.from>state.to)state[isFrom?'to':'from']=+e.target.value;$('#linked-from').value=state.from;$('#linked-to').value=state.to;$('#linked-from-label').textContent=months[COVERAGE[state.from-1]];$('#linked-to-label').textContent=months[COVERAGE[state.to-1]];$('#linked-result').innerHTML=linkedChart();fitChartHits();}
    if(e.target.id==='spend-range'){state.month=+e.target.value;updateSpending();}
    if(e.target.id==='project-search'){state.projectQuery=e.target.value;renderPart('project-grid',projectCards);watchMotion();}
    if(e.target.id==='roster-query'){state.rosterQuery=e.target.value;state.rosterLimit=ROSTER_STEP;renderPart('directory-grid',directoryCards);}
  });
  document.addEventListener('change',e=>{
    const id=e.target.id,val=e.target.value;
    
    if(id==='map-select'){state.mapUF=val||null;state.mapLimit=MAP_STEP;syncEstado();renderPart('atlas',atlas);focusMatch('#map-select');}
    if(id==='activity-bills'||id==='activity-votes'){state.activity=val;activityShown=null;for(const list of Object.values(listState)){list.limit=LIST_STEP;list.query='';}document.querySelectorAll('#activity-bills,#activity-votes').forEach(select=>{select.value=val;});document.querySelectorAll('#bills-list,#votes-list').forEach(el=>el.setAttribute('aria-busy','true'));hydrateActivity();return;}
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
    if (!state.highlightCategory) return;
    // The click may already have replaced its own target (dialog body, supplier list), so test the path fixed at dispatch time.
    if (e.composedPath().some(node => node instanceof Element && node.matches('.interactive-donut,.donut-legend,.donut-caption,.p-mini-bars,.category-focus,.supplier-list,#detail,.supplier-more,.supplier-search,[data-p=spend-evidence],#spend-range'))) return;
    state.highlightCategory = null;
    updateSpending();
    previewDonut(null);
  });
  const donutTarget = target => target instanceof Element ? target.closest('[data-donut-slice],.donut-legend [data-p-highlight]:not(:disabled)') : null;
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
  const route=C.parseRoute(location.pathname);
  if(route?.type==='estado'&&UF[route.uf])state.mapUF=route.uf;
  mount();
  updateFollowCount();
  if(route?.type==='estado'&&UF[route.uf]){syncEstado();(document.fonts?.ready??Promise.resolve()).then(()=>requestAnimationFrame(()=>$('#atlas')?.scrollIntoView({block:'start'})));}
  else if(route)C.openRoute(route,{initial:true});
})();
