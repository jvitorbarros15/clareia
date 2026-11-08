import {canonical,hash} from './model.ts';
import {findCpfs} from './cpf-scan.ts';
import {safeLegacyXml,LEGACY} from './people-legacy.ts';
import type {LegacyReport,LegacySource,CrosscheckReport} from './people-legacy.ts';
import type {HistoryReport} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';
import type {DiscoveryReport} from './people-discovery.ts';

// Only XML syntax parsing is shared. Field projection, date conversion, source
// stability and cross-source comparisons below do not call production rules.
const periodKeys=['siglaUFRepresentacao','situacaoExercicio','dataInicio','dataFim','idCausaFimExercicio','descricaoCausaFimExercicio','idCadastroParlamentarAnterior'];
const partyKeys=['idPartidoAnterior','siglaPartidoAnterior','nomePartidoAnterior','idPartidoPosterior','siglaPartidoPosterior','nomePartidoPosterior','dataFiliacaoPartidoPosterior','horaFiliacaoPartidoPosterior'];
function day(value:string):number{
  const parts=value.split('/').map(Number);if(parts.length!==3||!/^(\d{2})\/(\d{2})\/(\d{4})$/.test(value))throw Error();
  const [d,m,y]=parts,t=Date.UTC(y,m-1,d),date=new Date(t);
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error();return t;
}
const iso=(value:string)=>new Date(day(value)).toISOString().slice(0,10);
function project(raw:any,id:number,leg:number){
  const envelope=raw.Deputados,row=envelope?.Deputado;
  if(Object.keys(raw).length!==1||!envelope||Array.isArray(envelope)||Object.keys(envelope).join(',')!=='Deputado'||!row||Array.isArray(row)||row.ideCadastro!==String(id)||row.numLegislatura!==String(leg))return null;
  const extract=(container:any,item:string,keys:string[])=>{
    if(container==='')return [];
    if(!container||typeof container!=='object'||Array.isArray(container)||Object.keys(container).join(',')!==item)throw Error();
    return (Array.isArray(container[item])?container[item]:[container[item]]).map((r:any)=>{
      if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!keys.includes(k)))throw Error();
      return Object.fromEntries(keys.map(k=>{
        if(k==='horaFiliacaoPartidoPosterior'&&r[k]===undefined)return [k,''];
        if(typeof r[k]!=='string')throw Error();return [k,r[k].trim()];
      }));
    });
  };
  try{
    const periods=extract(row.periodosExercicio,'periodoExercicio',periodKeys),affiliations=extract(row.filiacoesPartidarias,'filiacaoPartidaria',partyKeys);
    for(const p of periods)if(p.dataFim&&day(p.dataFim)<day(p.dataInicio)||!/^\d{2}\/\d{2}\/\d{4}$/.test(p.dataInicio)||!Number.isFinite(day(p.dataInicio))||!new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']).has(p.siglaUFRepresentacao))throw Error();
    for(const a of affiliations){day(a.dataFiliacaoPartidoPosterior);if(!a.siglaPartidoAnterior||!a.siglaPartidoPosterior||a.horaFiliacaoPartidoPosterior&&!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(a.horaFiliacaoPartidoPosterior))throw Error();}
    return {id,legislature:leg,periods,affiliations};
  }catch{return null;}
}
const sorted=(rows:unknown[])=>rows.map(canonical).sort();
export async function auditLegacy(legacy:LegacyReport,cross:CrosscheckReport,history:HistoryReport,temporal:TemporalReport,discovery:DiscoveryReport,read:(s:LegacySource)=>Promise<Uint8Array>){
  const failures:{id?:number;code:string}[]=[],known=new Set<string>();
  const fail=(code:string,id?:number)=>failures.push(id===undefined?{code}:{id,code});
  if(legacy.schema!=='clareia.people-legacy.v1'||cross.schema!=='clareia.people-crosscheck.v1')fail('schema');
  const ids=discovery.candidates.map(p=>p.id).sort((a,b)=>a-b);
  if(!ids.length||new Set(ids).size!==ids.length||[legacy.people,cross.people,history.people,temporal.people].some(list=>list.length!==ids.length||canonical(list.map(p=>p.id).sort((a,b)=>a-b))!==canonical(ids)))fail('universe');
  if(legacy.discoverySha256!==hash(canonical(discovery))||legacy.historySha256!==hash(canonical(history))||temporal.historySha256!==legacy.historySha256||cross.discoverySha256!==legacy.discoverySha256||cross.historySha256!==legacy.historySha256||cross.legacySha256!==hash(canonical(legacy))||cross.temporalSha256!==hash(canonical(temporal))||history.discoverySha256!==legacy.discoverySha256)fail('versions');
  if([legacy.scope,cross.scope,temporal.scope].some(scope=>canonical(scope)!==canonical(discovery.scope)))fail('scope');
  if(legacy.publicAttributionEnabled!==false||cross.publicAttributionEnabled!==false||temporal.publicAttributionEnabled!==false||legacy.status!=='review-required'||cross.status!=='review-required'||cross.dateSemantics!=='boundary-days-and-open-ends-unconfirmed')fail('publication-gate');
  const originals=new Map<string,unknown>(),used=new Set<string>();
  for(const source of legacy.sources){
    const key=source.pass+':'+source.url;
    const url=new URL(source.url),params=[...url.searchParams.keys()].sort();
    if(![1,2].includes(source.pass)||source.file!==hash(source.url)+'.sealed'||originals.has(key)||url.origin+url.pathname!==LEGACY||url.username||url.password||url.hash||params.join(',')!=='ideCadastro,numLegislatura'||url.searchParams.get('numLegislatura')!==String(discovery.scope.legislature)||!ids.includes(Number(url.searchParams.get('ideCadastro'))))throw Error('Referência legada não permitida');
    const bytes=await read(source);if(hash(bytes)!==source.sha256||bytes.length!==source.bytes)throw Error('Hash de XML diverge');
    let raw:any=null;try{raw=safeLegacyXml(bytes);}catch{}
    for(const key of ['cpf','CPF']){const value=raw?.Deputados?.Deputado?.[key];if(typeof value==='string'&&value.replace(/\D/g,'').length===11)known.add(hash(value.replace(/\D/g,'')));}
    originals.set(key,raw);
  }
  let stable=0,changed=0,failed=0;
  for(const p of legacy.people){
    const actual=cross.people.find(r=>r.id===p.id),v2=temporal.people.find(r=>r.id===p.id);if(!actual||!v2){fail('missing-crosscheck',p.id);continue;}
    const projections=new Map<number,ReturnType<typeof project>>();
    for(const s of p.sources){
      const key=s.pass+':'+s.url,declared=legacy.sources.find(source=>source.pass===s.pass&&source.url===s.url);
      if(projections.has(s.pass)||s.url!==`${LEGACY}?ideCadastro=${p.id}&numLegislatura=${discovery.scope.legislature}`||!declared||canonical(s)!==canonical(declared))throw Error('Referência individual legada diverge');
      used.add(key);const raw=originals.get(key);projections.set(s.pass,raw?project(raw,p.id,discovery.scope.legislature):null);
    }
    const first=projections.get(1)??null,second=projections.get(2)??null;
    if(canonical(first)!==canonical(p.first)||canonical(second)!==canonical(p.second))fail('original-projection',p.id);
    const sig=(r:NonNullable<typeof first>)=>canonical({periods:sorted(r.periods),affiliations:sorted(r.affiliations)});
    const status=!first||!second?'failed':sig(first)===sig(second)?'stable':'changed';
    if(status==='stable')stable++;else if(status==='changed')changed++;else failed++;
    if(p.status!==status||actual.legacyStatus!==status)fail('stability-status',p.id);
    const issues:string[]=[];
    if(!first)issues.push('capture-or-contract-failure-pass-1');if(!second)issues.push('capture-or-contract-failure-pass-2');
    if(status==='changed')issues.push('legacy-changed-between-passes');
    if(first?.periods.some(period=>!['Titular','Suplente'].includes(period.situacaoExercicio)))issues.push('unconfirmed-exercise-kind');
    if(canonical(issues)!==canonical(p.issues))fail('collection-issues',p.id);
    const data=status==='stable'?first:null;
    const months=v2.months.map(m=>{
      const left=Date.parse(m.start.slice(0,10)+'T00:00:00Z'),right=Date.parse(m.end.slice(0,10)+'T00:00:00Z');
      const rows:number[]=[];let positive=false,edge=false,open=false,uncertain=false;
      if(data)data.periods.forEach((period,index)=>{
        const begin=day(period.dataInicio),finish=period.dataFim?day(period.dataFim):Infinity;
        const understood=period.situacaoExercicio==='Titular'||period.situacaoExercicio==='Suplente';
        if(begin+86_400_000<right&&finish>left&&begin+86_400_000<finish){if(understood)positive=true;else uncertain=true;rows.push(index);if(finish===Infinity)open=true;}
        else if(begin>=left&&begin<right||finish>=left&&finish<right){edge=true;rows.push(index);if(!understood)uncertain=true;}
      });
      return {year:m.year,month:m.month,v2Exercise:m.exercise,legacy:!data||uncertain?'unknown':positive?'reported-exercise':edge?'boundary-only':'no-listed-period',periodRows:rows,openEnd:open,comparison:!data||uncertain?'unavailable':positive&&m.exercise==='unknown'?'corroborating-unknown':positive&&m.exercise==='outside'||!positive&&!edge&&['full','partial'].includes(m.exercise)?'potential-conflict':'no-automatic-resolution'};
    });
    if(canonical(months)!==canonical(actual.months))fail('monthly-crosscheck',p.id);
    const transitions:{row:number;time:string;minute:boolean;before:string;after:string}[]=[],groups=new Map<string,typeof v2.events>();
    const comparable=data!==null&&v2.collectionStatus==='stable'&&v2.events.every(e=>e.disposition!=='invalid-date'&&e.disposition!=='outside-legislature');
    if(actual.partyComparisonStatus!==(comparable?'compared':'unavailable'))fail('party-comparison-eligibility',p.id);
    if(comparable)for(const e of v2.events)if(e.disposition==='usable')groups.set(e.time!,[...(groups.get(e.time!)??[]),e]);
    let before:string|null=null;
    for(const [time,events] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
      events.sort((a,b)=>a.row-b.row);const parties=new Set(events.map(e=>e.original.siglaPartido?.trim()||null)),after=parties.size===1?[...parties][0]:null;
      if(before&&after&&before!==after&&time.slice(0,10)>=discovery.scope.start&&time.slice(0,10)<=discovery.scope.end)transitions.push({row:events[0].row,time,minute:events.some(e=>e.precision==='minute'),before,after});if(after)before=after;else if(parties.size>1)before=null;
    }
    const expected:any[]=[],usedChanges=new Set<number>();
    if(data&&comparable){
      data.affiliations.forEach((a,row)=>{
        const date=iso(a.dataFiliacaoPartidoPosterior);if(date<discovery.scope.start||date>discovery.scope.end)return;
        const candidate=transitions.findIndex((t,i)=>!usedChanges.has(i)&&t.time.startsWith(date+'T')&&t.before===a.siglaPartidoAnterior&&t.after===a.siglaPartidoPosterior);
        if(candidate!==-1)usedChanges.add(candidate);
        expected.push({legacyRow:row,v2Row:candidate===-1?null:transitions[candidate].row,day:date,before:a.siglaPartidoAnterior,after:a.siglaPartidoPosterior,status:candidate===-1?'legacy-only-change':!a.horaFiliacaoPartidoPosterior?'same-day-time-unavailable':transitions[candidate].minute&&a.horaFiliacaoPartidoPosterior.slice(0,5)===transitions[candidate].time.substring(11,16)?'same-day-minute-precision':a.horaFiliacaoPartidoPosterior===transitions[candidate].time.substring(11)?'same-day-and-time':'same-day-time-differs'});
      });
      transitions.forEach((t,i)=>{if(!usedChanges.has(i))expected.push({legacyRow:null,v2Row:t.row,day:t.time.slice(0,10),before:t.before,after:t.after,status:'v2-only-change'});});
    }
    if(canonical(expected)!==canonical(actual.partyChanges))fail('party-crosscheck',p.id);
  }
  if(used.size!==originals.size)fail('unreferenced-original');
  if(findCpfs(JSON.stringify(legacy)+JSON.stringify(cross),known))fail('private-identifier');
  return {schema:'clareia.people-legacy-audit.v1',status:failures.length?'failed':'passed',checkedAt:new Date().toISOString(),legacySha256:hash(canonical(legacy)),crosscheckSha256:hash(canonical(cross)),discoverySha256:hash(canonical(discovery)),historySha256:hash(canonical(history)),temporalSha256:hash(canonical(temporal)),people:ids.length,stable,changed,failed,failures,publicAttributionEnabled:false,note:'Auditoria das projeções e comparações reportadas; não aprova vigência, preenchimento de lacunas, exercício ou publicação.'};
}
