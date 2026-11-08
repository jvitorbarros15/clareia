import {parse} from 'csv-parse';
import {Readable} from 'node:stream';
import {unzipSync} from 'fflate';
import {BASE,canonical,hash} from './model.ts';
import type {DiscoveryReport,Capture} from './people-discovery.ts';
import {findCpfs} from './cpf-scan.ts';

// Reads the preserved bytes independently. Does not call the discovery parser,
// paginator or set comparison, so a report cannot approve its own calculations.
export async function auditPeopleDiscovery(report:DiscoveryReport,read:(source:Capture)=>Promise<Uint8Array>){
  const sets={period:new Set<number>(),legislature:new Set<number>(),combined:new Set<number>()};
  const counts={period:new Map<number,number>(),legislature:new Map<number,number>(),combined:new Map<number,number>()};
  const pagination={period:{pages:new Set<number>(),last:new Set<number>(),next:new Map<number,number>()},legislature:{pages:new Set<number>(),last:new Set<number>(),next:new Map<number,number>()},combined:{pages:new Set<number>(),last:new Set<number>(),next:new Map<number,number>()}};
  const financial=new Map<number,Set<number>>();
  const annuals=new Map<number,{scanned:number;selected:number;people:Map<number,{rows:number;months:Set<number>}>;issues:{row:number;reason:string}[]}>();
  const failures:string[]=[],sourceUrls=new Set<string>();
  const privateIds=new Set<string>();
  const rememberCpf=(value:unknown)=>{if(typeof value!=='string')return;const digits=value.replace(/\D/g,'');if(digits.length===11)privateIds.add(hash(digits));};
  let contract=false;
  const histories=new Map<number,Record<string,unknown>[]>();
  for(const source of report.sources){
    if(sourceUrls.has(source.url))throw new Error('Fonte duplicada no relatório');sourceUrls.add(source.url);
    const bytes=await read(source);
    if(hash(bytes)!==source.sha256||bytes.length!==source.bytes)throw new Error('Original da auditoria não corresponde à captura');
    const url=new URL(source.url);
    if(source.url===BASE+'/api-docs'){const paths=JSON.parse(new TextDecoder().decode(bytes)).paths??{};contract=['/deputados','/deputados/{id}','/deputados/{id}/historico'].every(p=>paths[p]?.get);continue;}
    const historyPath=url.origin==='https://dadosabertos.camara.leg.br'?/^\/api\/v2\/deputados\/(\d+)\/historico$/.exec(url.pathname):null;
    if(historyPath){histories.set(Number(historyPath[1]),JSON.parse(new TextDecoder().decode(bytes)).dados??[]);continue;}
    if(url.origin==='https://dadosabertos.camara.leg.br'&&/^\/api\/v2\/deputados\/\d+$/.test(url.pathname)){
      const profile=JSON.parse(new TextDecoder().decode(bytes));rememberCpf(profile.dados?.cpf);
    }
    if(url.origin==='https://dadosabertos.camara.leg.br'&&url.pathname==='/api/v2/deputados'){
      const data=JSON.parse(new TextDecoder().decode(bytes));
      const isPeriod=url.searchParams.has('dataInicio'),hasLegislature=url.searchParams.has('idLegislatura'),kind=isPeriod?(hasLegislature?'combined':'period'):'legislature',set=sets[kind],multiplicity=counts[kind],paging=pagination[kind];
      if(!isPeriod&&!hasLegislature||hasLegislature&&url.searchParams.get('idLegislatura')!==String(report.scope.legislature)||isPeriod&&(url.searchParams.get('dataInicio')!==report.scope.start||url.searchParams.get('dataFim')!==report.scope.end))throw new Error('Fonte fora do escopo da auditoria');
      const page=Number(url.searchParams.get('pagina'));
      if(!Number.isSafeInteger(page)||page<1||paging.pages.has(page))throw new Error('Página inválida na auditoria');paging.pages.add(page);
      const nonPage=[...url.searchParams].filter(([key])=>key!=='pagina').sort();
      for(const link of data.links){
        if(!['next','last'].includes(link.rel))continue;
        const target=new URL(link.href),number=Number(target.searchParams.get('pagina'));
        if(target.origin!==url.origin||target.pathname!==url.pathname||canonical([...target.searchParams].filter(([key])=>key!=='pagina').sort())!==canonical(nonPage)||!Number.isSafeInteger(number)||number<1)throw new Error('Link fora do recorte na auditoria');
        if(link.rel==='last')paging.last.add(number);
        else {if(paging.next.has(page)||number!==page+1)throw new Error('Próxima página inválida na auditoria');paging.next.set(page,number);}
      }
      for(const row of data.dados){if(!Number.isSafeInteger(row.id)||row.id<1)throw new Error('Identidade inválida na auditoria');set.add(row.id);multiplicity.set(row.id,(multiplicity.get(row.id)||0)+1);}
    }
    if(url.origin==='https://www.camara.leg.br'&&url.pathname.endsWith('.csv.zip')){
      const year=Number(/Ano-(\d{4})/.exec(url.pathname)?.[1]);
      if(annuals.has(year))throw new Error('Ano repetido na auditoria');
      const contents=unzipSync(bytes,{filter:entry=>entry.name===`Ano-${year}.csv`&&entry.originalSize<=200_000_000});
      const csv=contents[`Ano-${year}.csv`];if(!csv)throw new Error('Anual ausente na auditoria');
      const result={scanned:0,selected:0,people:new Map<number,{rows:number;months:Set<number>}>(),issues:[] as {row:number;reason:string}[]};
      const reader=Readable.from([csv]).pipe(parse({columns:(columns:string[])=>{if(columns.length!==new Set(columns).size)throw new Error('Coluna duplicada na auditoria');return columns;},delimiter:';',bom:true,skip_empty_lines:true}));
      for await(const row of reader){
        rememberCpf(row.txtCNPJCPF);
        const position=result.scanned++;
        const reference=Number(row.numAno)*100+Number(row.numMes),first=Number(report.scope.start.slice(0,7).replace('-','')),last=Number(report.scope.end.slice(0,7).replace('-',''));
        if(reference<first||reference>last)continue;
        result.selected++;
        const id=Number(row.ideCadastro);
        if(!/^[0-9]+$/.test(row.ideCadastro)||!Number.isSafeInteger(id)||id<=0){result.issues.push({row:position,reason:'invalid-person-id'});continue;}
        const entry=result.people.get(id)||{rows:0,months:new Set<number>()};entry.rows++;entry.months.add(Number(row.numMes));result.people.set(id,entry);
        const years=financial.get(id)||new Set<number>();years.add(year);financial.set(id,years);
        if(row.codLegislatura!==String(report.scope.legislature))result.issues.push({row:position,reason:'legislature-mismatch'});
      }
      annuals.set(year,result);
    }
  }
  const sorted=(values:Iterable<number>)=>[...values].sort((a,b)=>a-b);
  if(!contract)failures.push('missing-source-contract');
  for(const key of ['period','legislature','combined'] as const){
    if(canonical(sorted(sets[key]))!==canonical(report.sets[key]))failures.push('list-set-'+key);
    const count=counts[key],observed={rows:[...count.values()].reduce((a,b)=>a+b,0),repeatedIds:sorted(count.keys()).filter(id=>count.get(id)!>1).map(id=>({id,rows:count.get(id)!}))};
    if(canonical(observed)!==canonical(report.listRows[key]))failures.push('list-multiplicity-'+key);
    const paging=pagination[key],last=Math.max(0,...paging.pages);
    if(!last||paging.pages.size!==last||paging.last.size>1||paging.last.size===1&&![...paging.last].includes(last)||paging.next.has(last)||Array.from({length:last-1},(_,i)=>i+1).some(page=>paging.next.get(page)!==page+1))failures.push('list-pagination-'+key);
  }
  const expectedYears=Array.from({length:Number(report.scope.end.slice(0,4))-Number(report.scope.start.slice(0,4))+1},(_,i)=>Number(report.scope.start.slice(0,4))+i);
  if(canonical(sorted(annuals.keys()))!==canonical(expectedYears)||report.annuals.length!==expectedYears.length)failures.push('annual-coverage');
  for(const annual of report.annuals){
    const observed=annuals.get(annual.year);
    if(!observed){failures.push('missing-annual-'+annual.year);continue;}
    const people=sorted(observed.people.keys()).map(id=>({id,months:sorted(observed.people.get(id)!.months),rows:observed.people.get(id)!.rows}));
    if(canonical(people)!==canonical(annual.people)||observed.scanned!==annual.scanned||observed.selected!==annual.selected||canonical(observed.issues)!==canonical(annual.issues))failures.push('annual-index-'+annual.year);
  }
  const candidates=sorted(new Set([...sets.period,...sets.legislature,...sets.combined,...financial.keys()])).map(id=>({id,inPeriodList:sets.period.has(id),inLegislatureList:sets.legislature.has(id),inCombinedList:sets.combined.has(id),annualYears:sorted(financial.get(id)||[]),classification:sets.period.has(id)?'historical-list':financial.has(id)?'financial-only':sets.legislature.has(id)?'legislature-only':'combined-list-only'}));
  if(canonical(candidates)!==canonical(report.candidates))failures.push('candidate-universe');
  for(const sample of report.samples){
    const original=histories.get(sample.id);
    if(!original){failures.push('sample-history-missing-'+sample.id);continue;}
    const fields=['id','idLegislatura','dataHora','situacao','condicaoEleitoral','siglaPartido','siglaUf','descricaoStatus'],projected=original.map(e=>Object.fromEntries(fields.map(k=>[k,e[k]])));
    if(canonical(projected)!==canonical(sample.events))failures.push('sample-events-'+sample.id);
    const later=original.some(e=>Number(e.idLegislatura)>report.scope.legislature&&typeof e.dataHora==='string'&&e.dataHora.slice(0,10)<=report.scope.end);
    if(later!==sample.issues.includes('later-legislature-event-before-scope-cutoff'))failures.push('sample-issues-'+sample.id);
  }
  if(findCpfs(JSON.stringify(report),privateIds))failures.push('private-identifier-in-report');
  return {schema:'clareia.people-discovery-audit.v1',status:failures.length?'failed':'passed',checkedAt:new Date().toISOString(),reportSha256:hash(canonical(report)),candidates:candidates.length,failures,note:'Conferência independente dos conjuntos e índices de identidade nas capturas preservadas. Não aprova exercício, atribuição temporal, valores financeiros ou publicação pública.'};
}
