import {BASE,canonical,hash} from './model.ts';
import {findCpfs} from './cpf-scan.ts';
import type {HistoryReport,HistorySource} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';
import type {DiscoveryReport} from './people-discovery.ts';

type RawEvent={id:number;idLegislatura:number;dataHora:string|null;situacao:string|null;condicaoEleitoral:string|null;siglaPartido:string|null;siglaUf:string|null;descricaoStatus:string|null};
type Cell={status:'known'|'unknown'|'conflict';value:string|null;rows:number[]};
type State={exercise:Cell;party:Cell;uf:Cell};
const fields=['id','idLegislatura','dataHora','situacao','condicaoEleitoral','siglaPartido','siglaUf','descricaoStatus'] as const;
const clean=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const ordered=(values:Iterable<number>)=>[...new Set(values)].sort((a,b)=>a-b);
const empty=():Cell=>({status:'unknown',value:null,rows:[]});
const vacant=():State=>({exercise:empty(),party:empty(),uf:empty()});
const dayAfter=(day:string)=>{const [y,m,d]=day.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);};
// Deliberately separate parsing and temporal resolution: this audit reads the
// encrypted originals and never calls the production normalizer/resolver.
function auditTime(value:unknown):{time:string|null;precision:string}{
  if(typeof value!=='string')return {time:null,precision:'unsupported'};
  const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(!parts)return {time:null,precision:'unsupported'};
  const [y,m,d,h,min,sec]=parts.slice(1).map((p,i)=>p===undefined&&i===5?0:Number(p));
  const date=new Date(0);date.setUTCFullYear(y,m-1,d);date.setUTCHours(h,min,sec,0);
  const valid=date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d&&date.getUTCHours()===h&&date.getUTCMinutes()===min&&date.getUTCSeconds()===sec;
  return valid?{time:value.length===16?value+':00':value,precision:parts[6]===undefined?'minute':'second'}:{time:null,precision:'unsupported'};
}
function readEvents(data:any,id:number):RawEvent[]|null{
  if(!Array.isArray(data?.dados)||!Array.isArray(data?.links)||data.links.some((l:any)=>l.rel==='next'||l.rel==='last'))return null;
  const events:RawEvent[]=[];
  for(const row of data.dados){
    if(!row||row.id!==id||!Number.isInteger(row.idLegislatura)||fields.slice(2).some(k=>typeof row[k]!=='string'&&row[k]!==null))return null;
    events.push(Object.fromEntries(fields.map(k=>[k,row[k]])) as RawEvent);
  }
  return events;
}
function merge(values:{value:string|null;row:number}[]):Cell{
  const distinct=[...new Set(values.filter(v=>v.value!==null).map(v=>v.value!))],rows=ordered(values.map(v=>v.row));
  if(distinct.length>1)return {status:'conflict',value:null,rows};
  return distinct.length===1&&values.every(v=>v.value!==null)?{status:'known',value:distinct[0],rows}:{status:'unknown',value:null,rows};
}
export async function auditTemporalHistory(history:HistoryReport,temporal:TemporalReport,read:(source:HistorySource)=>Promise<Uint8Array>,discovery:DiscoveryReport){
  const failures:{id?:number;code:string}[]=[],knownPrivate=new Set<string>(),payloads=new Map<string,any>();
  const key=(source:HistorySource)=>source.pass+':'+source.url;
  for(const source of history.sources){
    if(payloads.has(key(source)))throw new Error('Fonte repetida na auditoria temporal');
    const bytes=await read(source);if(hash(bytes)!==source.sha256||bytes.length!==source.bytes)throw new Error('Hash do original temporal diverge');
    let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{raw=null;}
    payloads.set(key(source),raw);
    if(typeof raw?.dados?.cpf==='string'){const digits=raw.dados.cpf.replace(/\D/g,'');if(digits.length===11)knownPrivate.add(hash(digits));}
  }
  const from=(source:HistorySource)=>{
    const declared=history.sources.find(s=>key(s)===key(source));
    if(!declared||canonical(declared)!==canonical(source))throw new Error('Referência temporal não corresponde à captura');
    return payloads.get(key(source));
  };
  if(history.legislature.source.url!==`${BASE}/legislaturas/${history.scope.legislature}`||history.legislature.source.pass!==1||history.references.source.url!==BASE+'/referencias/deputados/codSituacao'||history.references.source.pass!==1)throw new Error('Origem das referências temporais divergente');
  const leg=from(history.legislature.source)?.dados,states=from(history.references.source)?.dados;
  if(!leg||leg.id!==history.scope.legislature||leg.dataInicio!==history.legislature.start||leg.dataFim!==history.legislature.end)throw new Error('Legislatura difere do original');
  if(!Array.isArray(states)||canonical(states.map((s:any)=>({sigla:s.sigla,nome:s.nome})))!==canonical(history.references.states))throw new Error('Referências diferem do original');
  if(temporal.historySha256!==hash(canonical(history)))failures.push({code:'history-version'});
  if(temporal.status!=='review-required'||temporal.publicAttributionEnabled!==false||history.dateMeaning!=='reported-change-not-independently-confirmed'||history.ruleVersion!=='camara.history-reported-change.v1'||temporal.ruleVersion!==history.ruleVersion)failures.push({code:'unapproved-public-attribution'});
  if(canonical(temporal.scope)!==canonical(history.scope))failures.push({code:'scope'});
  if(history.discoverySha256!==hash(canonical(discovery))||canonical(discovery.scope)!==canonical(history.scope))failures.push({code:'discovery-version-or-scope'});
  const ids=history.people.map(p=>p.id),outputIds=temporal.people.map(p=>p.id);
  const expectedIds=discovery.candidates.map(c=>c.id);
  if(!expectedIds.length||new Set(expectedIds).size!==expectedIds.length||expectedIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length||canonical(ordered(expectedIds))!==canonical(ordered(ids))||canonical(ordered(ids))!==canonical(ordered(outputIds))||new Set(outputIds).size!==outputIds.length)failures.push({code:'person-coverage'});
  const allowedStates=new Set(states.map((s:any)=>clean(s.nome))),allowedUfs=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
  const inOffice=(value:string|null)=>{
    if(!value)return null;const state=clean(value);
    if(!allowedStates.has(state)&&!(state==='fim_mandato'&&allowedStates.has('fim de mandato')))return null;
    if(state==='exercicio')return 'in-office';
    if(['afastado','licenca','suplencia','suspenso','vacancia','fim de mandato','fim_mandato'].includes(state))return 'out-of-office';return null;
  };
  let stable=0,changed=0,failed=0;
  const windowStart=history.scope.start+'T00:00:00',windowEnd=dayAfter(history.scope.end)+'T00:00:00',legStart=leg.dataInicio+'T00:00:00',legEnd=dayAfter(leg.dataFim)+'T00:00:00';
  for(const person of history.people){
    const result=temporal.people.find(p=>p.id===person.id);
    if(!result){failures.push({id:person.id,code:'missing-person'});continue;}
    const passEvents:{[pass:number]:RawEvent[]|null}={1:null,2:null};
    const seenPasses=new Set<number>();
    for(const source of person.sources){
      if(![1,2].includes(source.pass)||seenPasses.has(source.pass)||source.url!==`${BASE}/deputados/${person.id}/historico`)throw new Error('Origem do histórico individual divergente');
      seenPasses.add(source.pass);
      passEvents[source.pass]=readEvents(from(source),person.id);
    }
    if(person.profile&&(person.profile.source.url!==`${BASE}/deputados/${person.id}`||person.profile.source.pass!==1))throw new Error('Origem do cadastro divergente');
    const profile=person.profile?from(person.profile.source):null;
    const validProfile=profile?.dados?.id===person.id&&typeof profile.dados.ultimoStatus?.nome==='string'&&(profile.dados.ultimoStatus.urlFoto===null||typeof profile.dados.ultimoStatus.urlFoto==='string');
    const first=passEvents[1]??[],second=passEvents[2];
    const state=!validProfile||passEvents[1]===null||second===null?'failed':canonical(first.map(e=>canonical(e)).sort())===canonical(second.map(e=>canonical(e)).sort())?'stable':'changed';
    if(state==='stable')stable++;else if(state==='changed')changed++;else failed++;
    if(state!==person.status||result.collectionStatus!==person.status)failures.push({id:person.id,code:'collection-status'});
    if(canonical(first)!==canonical(person.events))failures.push({id:person.id,code:'normalized-history-events'});
    if(validProfile&&person.profile?.name!==profile.dados.ultimoStatus.nome)failures.push({id:person.id,code:'profile-name'});
    if(validProfile){
      let expectedPhoto:string|null=null;
      try{const photo=new URL(profile.dados.ultimoStatus.urlFoto);if(['http:','https:'].includes(photo.protocol)&&!photo.username&&!photo.password&&(photo.hostname==='camara.leg.br'||photo.hostname.endsWith('.camara.leg.br'))){photo.protocol='https:';expectedPhoto=photo.href;}}catch{}
      if(person.profile?.photo!==expectedPhoto)failures.push({id:person.id,code:'profile-photo'});
    }
    const normalized=first.map((original,row)=>{
      const stamp=auditTime(original.dataHora),disposition=original.idLegislatura!==history.scope.legislature?'other-legislature':!stamp.time?'invalid-date':stamp.time<legStart||stamp.time>=legEnd?'outside-legislature':'usable';
      return {row,original,...stamp,disposition};
    });
    if(canonical(normalized)!==canonical(result.events))failures.push({id:person.id,code:'temporal-event-provenance'});
    const usable=normalized.filter(e=>e.disposition==='usable'),foreignEvent=normalized.some(e=>e.disposition==='other-legislature'&&e.time!==null&&e.time>=windowStart&&e.time<windowEnd),blocked=foreignEvent||state!=='stable'||normalized.some(e=>e.disposition==='invalid-date'||e.disposition==='outside-legislature');
    const expectedIssues=[...new Set([...person.issues,...(normalized.some(e=>e.disposition==='outside-legislature')?['selected-legislature-date-mismatch']:[]),...(foreignEvent?['other-legislature-event-in-window']:[])])].sort();
    if(canonical(expectedIssues)!==canonical(result.issues))failures.push({id:person.id,code:'person-issues'});
    const stateAt=(time:string):State=>{
      if(blocked)return vacant();
      const previous=usable.filter(e=>e.time!<=time).sort((a,b)=>b.time!.localeCompare(a.time!))[0]?.time;
      if(!previous)return vacant();
      const latest=usable.filter(e=>e.time===previous);
      return {exercise:merge(latest.map(e=>({row:e.row,value:inOffice(e.original.situacao)}))),party:merge(latest.map(e=>({row:e.row,value:e.original.siglaPartido?.trim()||null}))),uf:merge(latest.map(e=>({row:e.row,value:allowedUfs.has(e.original.siglaUf??'')?e.original.siglaUf:null})))};
    };
    const boundaries=[...new Set([windowStart,windowEnd,...usable.map(e=>e.time!).filter(t=>t>windowStart&&t<windowEnd)])].sort();
    const expectedIntervals=boundaries.slice(0,-1).map((start,i)=>({start,end:boundaries[i+1],...stateAt(start)}));
    const actualIntervals=result.intervals.map(i=>({start:i.start,end:i.end,...Object.fromEntries(['exercise','party','uf'].map(k=>{const d=i[k as 'exercise'|'party'|'uf'];return [k,{status:d.status,value:d.value,rows:d.rows}];}))}));
    if(canonical(expectedIntervals)!==canonical(actualIntervals))failures.push({id:person.id,code:'interval-state-or-evidence'});
    for(const interval of result.intervals){
      const vacantBecause=blocked?'history-not-eligible-for-derivation':usable.some(e=>e.time!<=interval.start)?null:'no-prior-history-event';
      if([interval.exercise,interval.party,interval.uf].some(d=>vacantBecause?canonical(d.reasons)!==canonical([vacantBecause]):d.status==='known'?d.reasons.length>0:d.reasons.length===0))failures.push({id:person.id,code:'interval-unknown-reason'});
    }
    const expectedMonths=[];
    let cursor=new Date(history.scope.start.slice(0,7)+'-01T00:00:00Z');
    while(cursor.toISOString().slice(0,10)<=history.scope.end){
      const year=cursor.getUTCFullYear(),month=cursor.getUTCMonth()+1,monthStart=cursor.toISOString().slice(0,10)+'T00:00:00';cursor.setUTCMonth(cursor.getUTCMonth()+1);
      const monthEnd=cursor.toISOString().slice(0,10)+'T00:00:00',start=monthStart>windowStart?monthStart:windowStart,end=monthEnd<windowEnd?monthEnd:windowEnd;
      const sampleTimes=[start,...usable.map(e=>e.time!).filter(t=>t>start&&t<end)],snapshots=[...new Set(sampleTimes)].sort().map(stateAt);
      const ex=snapshots.map(s=>s.exercise);
      const exercise=ex.some(v=>v.status==='conflict')?'conflict':ex.some(v=>v.status==='unknown')?'unknown':new Set(ex.map(v=>v.value)).size>1?'partial':ex[0]?.value==='in-office'?'full':'outside';
      const dimensions=(field:'party'|'uf')=>{
        if(exercise==='outside')return {status:'not-applicable',value:null,values:[],rows:[]};
        const relevant=snapshots.filter(s=>s.exercise.status!=='known'||s.exercise.value==='in-office').map(s=>s[field]);
        const values=[...new Set(relevant.filter(v=>v.status==='known').map(v=>v.value!))].sort(),rows=ordered(relevant.flatMap(v=>v.rows));
        const status=relevant.some(v=>v.status==='conflict')?'conflict':values.length>1?'changed':!relevant.length||relevant.some(v=>v.status==='unknown')||exercise==='unknown'||exercise==='conflict'?'unknown':values.length===1?'single':'unknown';
        return {status,value:status==='single'?values[0]:null,values,rows};
      };
      expectedMonths.push({year,month,start,end,partialScope:start!==monthStart||end!==monthEnd,exercise,party:dimensions('party'),uf:dimensions('uf'),financialCollection:'not-collected'});
    }
    if(canonical(expectedMonths)!==canonical(result.months))failures.push({id:person.id,code:'monthly-coverage-or-affiliation'});
  }
  if(canonical({expected:ids.length,stable,changed,failed})!==canonical(history.coverage))failures.push({code:'collection-coverage-counts'});
  if(findCpfs(JSON.stringify(history)+JSON.stringify(temporal),knownPrivate))failures.push({code:'private-identifier-in-report'});
  return {schema:'clareia.people-temporal-audit.v1',status:failures.length?'failed':'passed',checkedAt:new Date().toISOString(),discoverySha256:hash(canonical(discovery)),historySha256:hash(canonical(history)),temporalSha256:hash(canonical(temporal)),people:ids.length,failures,publicAttributionEnabled:false,note:'Releitura independente de originais, universo aprovado, identidades, estabilidade, intervalos, competência e evidências. Valida a derivação segundo a regra reportada; não confirma vigência jurídica de dataHora nem libera publicação ou métricas financeiras.'};
}
