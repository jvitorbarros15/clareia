import {unzipSync} from 'fflate';
import {BASE,canonical,hash,normalize,stableDigest} from './model.ts';
import type {Scope,Expense} from './model.ts';
import {PeopleCapture,sourceAllowed} from './people-discovery.ts';
import type {Capture} from './people-discovery.ts';
import {parseAnnual,normalizeAnnual,unionRecords,annualUrl} from './annual.ts';
import {assertArchive} from './sources.ts';
import {findCpfs} from './cpf-scan.ts';
import type {TemporalReport,MonthlyCoverage} from './people-temporal.ts';
import {equationKey,reviewExpenseEquations,reviewFlightMultiplicity} from './expense-equations.ts';
import type {EquationInput,EquationDecision,MultiplicityDecision} from './expense-equations.ts';
import {checkPortal,mapPortalIdentity} from './cota-portal.ts';
import type {PortalCheck} from './cota-portal.ts';

export type ExpenseSource=Capture&{pass:1|2};
export type ExpenseCell={personId:number;year:number;month:number;status:'complete'|'no-expenses-confirmed'|'held-review'|'source-failure';reasons:string[];api:[{count:number|null;pages:ExpenseSource[]},{count:number|null;pages:ExpenseSource[]}];annualCount:number;exercise:MonthlyCoverage['exercise'];party:MonthlyCoverage['party'];uf:MonthlyCoverage['uf'];totalCents:number|null;records:Expense[];diagnostics:{annualOnly:Record<string,number>;apiOnly:Record<string,number>}|null};
export type ExpenseBatch={schema:'clareia.expense-intermediate.v1';equationRule:'camara.ceap.correlated-net.v1';equationDecisions:EquationDecision[];multiplicityRule:'camara.ceap.sigepa-annual-routes.v1';multiplicityDecisions:MultiplicityDecision[];portalRule:'camara.ceap.sigepa-portal-ledger.v1';portalRequested:boolean;portalChecks:PortalCheck[];contentSha256:string;scope:Scope;peopleVersion:string;proposalSha256:string;createdAt:string;status:'review-required';publicationEligible:false;annual:[{source:ExpenseSource;csvSha256:string;scanned:number},{source:ExpenseSource;csvSha256:string;scanned:number}];cells:ExpenseCell[];sources:ExpenseSource[];totalCents:number|null;metrics:{elapsedMs:number;maxRssKiB:number;sourceBytes:number;requests:number;retries:number;cacheHits:number;downloadedBytes:number}};
export function expenseBatchContentId(report:ExpenseBatch):string{
  const {createdAt:_created,metrics:_metrics,contentSha256:_content,...body}=report;
  const withoutTimes=(value:unknown):unknown=>Array.isArray(value)?value.map(withoutTimes):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='fetchedAt').map(([key,value])=>[key,withoutTimes(value)])):value;
  return hash(canonical(withoutTimes({...body,sources:[...body.sources].sort((a,b)=>a.pass-b.pass||a.url.localeCompare(b.url))})));
}
type ApiRow={raw:unknown;source:ExpenseSource;row:number};
export function expenseUrl(scope:Scope,id:number,month:number,pass:1|2,page=1){return `${BASE}/deputados/${id}/despesas?ano=${scope.year}&mes=${month}&idLegislatura=${scope.legislature}&itens=${pass===1?100:25}&ordem=ASC&ordenarPor=codDocumento&pagina=${page}`;}
export function validateExpenseScope(scope:Scope,today=new Date()):void{
  if(!Number.isInteger(scope.year)||scope.year<2009||scope.year>today.getUTCFullYear()||!Number.isSafeInteger(scope.legislature)||scope.legislature<1||!scope.ids.length||scope.ids.length>1000||new Set(scope.ids).size!==scope.ids.length||scope.ids.some(id=>!Number.isSafeInteger(id)||id<1)||!scope.months.length||scope.months.length>12||new Set(scope.months).size!==scope.months.length||scope.months.some(m=>!Number.isInteger(m)||m<1||m>12||Date.UTC(scope.year,m,1)>today.valueOf()))throw Error('Escopo financeiro inválido ou mês não encerrado');
}
export async function expensePages(scope:Scope,id:number,month:number,pass:1|2,capture:PeopleCapture,pages:ExpenseSource[]=[]):Promise<ApiRow[]>{
  const first=new URL(expenseUrl(scope,id,month,pass)),rows:ApiRow[]=[],bodies=new Set<string>();let url:string|null=first.href,page=0,last:number|null=null,probing=false,previousCount=0;
  const parameters=(u:URL)=>canonical([...u.searchParams].filter(([key])=>key!=='pagina').sort());
  const check=(href:string,expected?:number)=>{const u=new URL(href);if(!sourceAllowed(href)||u.origin!==first.origin||u.pathname!==first.pathname||parameters(u)!==parameters(first)||u.searchParams.getAll('pagina').length!==1||expected!==undefined&&Number(u.searchParams.get('pagina'))!==expected)throw Error('Paginação financeira mudou de recorte');return u;};
  while(url){
    if(++page>1000)throw Error('Limite de paginação financeira');check(url,page);
    const {data,source}=await capture.json(url),ref={...source,pass};pages.push(ref);
    if(!Array.isArray(data.dados)||!Array.isArray(data.links)||data.links.some((l:any)=>!l||typeof l.rel!=='string'||typeof l.href!=='string'))throw Error('Envelope financeiro mudou');
    const self=data.links.filter((l:any)=>l.rel==='self');if(self.length>1)throw Error('Página financeira com identidade ambígua');if(self.length)check(self[0].href,page);
    const next=data.links.filter((l:any)=>l.rel==='next'),lasts=data.links.filter((l:any)=>l.rel==='last');if(next.length>1||lasts.length>1)throw Error('Paginação financeira ambígua');
    if(probing){if(data.dados.length||next.length||lasts.some((l:any)=>Number(check(l.href).searchParams.get('pagina'))!==page-1))throw Error('Prova adicional de término financeiro falhou');break;}
    // The live API sometimes emits next even on an exactly full declared last
    // page. Accept only its preserved empty successor, with that last-page proof.
    if(!data.dados.length&&page>1&&last===page-1&&previousCount===Number(first.searchParams.get('itens'))&&!next.length&&!lasts.length)break;
    if(lasts.length){const target=check(lasts[0].href),n=Number(target.searchParams.get('pagina'));if(!Number.isInteger(n)||n<page||last!==null&&last!==n)throw Error('Última página financeira mudou');last=n;}
    const signature=hash(canonical(data.dados));if(data.dados.length&&bodies.has(signature))throw Error('Página financeira repetida');bodies.add(signature);
    if(!data.dados.length&&(page>1||next.length))throw Error('Página financeira vazia inesperada');
    rows.push(...data.dados.map((raw:unknown,row:number)=>({raw,source:ref,row})));
    previousCount=data.dados.length;
    if(next.length){check(next[0].href,page+1);url=next[0].href;}else{if(last!==null&&last!==page)throw Error('Paginação financeira incompleta');if(last===null&&data.dados.length===Number(first.searchParams.get('itens'))){const probe=new URL(first);probe.searchParams.set('pagina',String(page+1));url=probe.href;probing=true;}else url=null;}
  }
  return rows;
}
export async function expenseAnnual(capture:PeopleCapture,scope:Scope,pass:1|2){
  const {bytes:archive,source}=await capture.get(annualUrl(scope.year));assertArchive(archive,22);
  const name=`Ano-${scope.year}.csv`,files=unzipSync(archive,{filter:file=>{if(file.name!==name)return false;if(file.originalSize>200_000_000)throw Error('CSV financeiro acima do limite');return true;}}),bytes=files[name];if(!bytes)throw Error('CSV financeiro ausente');
  const known=new Set<string>(),parsed=await parseAnnual(bytes,scope,raw=>{
    if(scope.ids.includes(Number(raw.ideCadastro))&&(!/^\d+$/.test(raw.ideCadastro)||!/^\d{4}$/.test(raw.numAno)||!/^(?:0?[1-9]|1[0-2])$/.test(raw.numMes)))throw Error('Identidade ou competência anual inválida');
    for(const value of [raw.txtCNPJCPF,raw.cpf]){const digits=(value||'').replace(/\D/g,'');if(digits.length===11)known.add(hash(digits));}
  });
  const digest=hash(parsed.rows.map(r=>canonical(r.raw)).sort().join('\n'));
  return {...parsed,source:{...source,pass},csvSha256:hash(bytes),known,digest};
}
const groups=(rows:Expense[])=>Object.fromEntries([...new Set(rows.map(r=>r.category))].map(category=>[category,rows.filter(r=>r.category===category).length]));
// Diagnostics preserve unmatched counts without relaxing the approved union rule.
function unmatched(annual:Expense[],api:Expense[]){
  const key=(r:Expense)=>canonical([r.personId,r.month,r.documentId==='Não informado'?'':r.documentId,r.category,r.cents]);
  const pool=new Map<string,Expense[]>();for(const r of api)pool.set(key(r),[...(pool.get(key(r))??[]),r]);
  const left:Expense[]=[];for(const r of annual){const list=pool.get(key(r));if(list?.length)list.shift();else left.push(r);}return {annualOnly:groups(left),apiOnly:groups([...pool.values()].flat())};
}
export async function collectExpenseBatch(scope:Scope,temporal:TemporalReport,proposalSha256:string,one:PeopleCapture,two:PeopleCapture,options:{workers?:number;portal?:boolean;wait?:(ms:number)=>Promise<void>;progress?:(pass:number,done:number,total:number)=>void}={}):Promise<ExpenseBatch>{
  validateExpenseScope(scope);const start=Date.now(),workers=options.workers??2,known=new Set<string>();
  if(!Number.isInteger(workers)||workers<1||workers>3||!/^[a-f0-9]{64}$/.test(proposalSha256)||scope.legislature!==temporal.scope.legislature||scope.ids.some(id=>!temporal.people.some(p=>p.id===id))||temporal.scope.start>`${scope.year}-01-01`||temporal.scope.end<`${scope.year}-12-31`)throw Error('Entradas financeiras incompatíveis');
  const {data:contract}=await one.json(BASE+'/api-docs'),parameters=contract.paths?.['/deputados/{id}/despesas']?.get?.parameters;
  if(!Array.isArray(parameters)||['ano','mes','idLegislatura','itens','pagina','ordem','ordenarPor'].some(name=>!parameters.some((p:any)=>p.name===name&&p.in==='query')))throw Error('Contrato da API de despesas mudou');
  const firstAnnual=await expenseAnnual(one,scope,1);for(const id of firstAnnual.known)known.add(id);
  const cells:ExpenseCell[]=[],results=new Map<string,[ApiRow[]|null,ApiRow[]|null]>();
  for(const id of scope.ids)for(const month of scope.months){const coverage=temporal.people.find(p=>p.id===id)!.months.find(m=>m.year===scope.year&&m.month===month);if(!coverage)throw Error('Competência temporal ausente');cells.push({personId:id,year:scope.year,month,status:'source-failure',reasons:[],api:[{count:null,pages:[]},{count:null,pages:[]}],annualCount:0,exercise:coverage.exercise,party:coverage.party,uf:coverage.uf,totalCents:null,records:[],diagnostics:null});results.set(id+':'+month,[null,null]);}
  for(const [index,capture] of [one,two].entries()){
    const pass=(index+1) as 1|2;let cursor=0,done=0;
    await Promise.all(Array.from({length:workers},async()=>{while(cursor<cells.length){
      const c=cells[cursor++];try{
        const rows=await expensePages(scope,c.personId,c.month,pass,capture,c.api[index].pages);c.api[index].count=rows.length;results.get(c.personId+':'+c.month)![index]=rows;
        for(const {raw} of rows){const digits=String((raw as any)?.cnpjCpfFornecedor??'').replace(/\D/g,'');if(digits.length===11)known.add(hash(digits));}
      }catch{c.reasons.push(`api-source-failure-pass-${pass}`);}
      options.progress?.(pass,++done,cells.length);await (options.wait??(ms=>new Promise(r=>setTimeout(r,ms))))(150);
    }}));
  }
  const secondAnnual=await expenseAnnual(two,scope,2);for(const id of secondAnnual.known)known.add(id);
  const annualStable=firstAnnual.digest===secondAnnual.digest;
  const equationInputs:EquationInput[]=secondAnnual.rows.map(({raw,row})=>({kind:'annual',personId:Number(raw.ideCadastro),raw,source:{url:secondAnnual.source.url,sha256:secondAnnual.csvSha256,row,fetchedAt:secondAnnual.source.fetchedAt}}));
  if(annualStable)for(const c of cells){const passes=results.get(c.personId+':'+c.month)!;if(passes.every(p=>p!==null)&&hash(passes[0]!.map(r=>canonical(r.raw)).sort().join('\n'))===hash(passes[1]!.map(r=>canonical(r.raw)).sort().join('\n')))for(const {raw,row,source} of passes[1]!)equationInputs.push({kind:'api',personId:c.personId,raw:raw as Record<string,any>,source:{url:source.url,sha256:source.sha256,row,fetchedAt:source.fetchedAt}});}
  const equationReview=reviewExpenseEquations(scope,annualStable?equationInputs:[]);
  const multiplicityReview=reviewFlightMultiplicity(scope,annualStable?equationInputs:[]);
  const portalChecks:PortalCheck[]=[],portalCovered=new Set<string>();
  for(const c of cells){
    const selected=secondAnnual.rows.filter(r=>Number(r.raw.ideCadastro)===c.personId&&Number(r.raw.numMes)===c.month),api=results.get(c.personId+':'+c.month)!;c.annualCount=selected.length;
    if(c.reasons.length)continue;c.status='held-review';
    if(!annualStable){c.reasons.push('annual-changed-between-passes');continue;}
    try{
      const digest=(rows:ApiRow[])=>hash(rows.map(r=>canonical(r.raw)).sort().join('\n'));
      if(digest(api[0]!)!==digest(api[1]!)){c.reasons.push('api-changed-between-passes');continue;}
      const counts=new Map<string,number>();for(const r of api[1]!){const key=canonical(r.raw);counts.set(key,(counts.get(key)??0)+1);}
      const unresolved=api[1]!.filter(r=>(counts.get(canonical(r.raw))??0)>1&&!multiplicityReview.covered.has(equationKey({kind:'api',personId:c.personId,source:{...r.source,row:r.row}})));
      if(unresolved.length&&options.portal&&unresolved.every(r=>(r.raw as any)?.tipoDespesa==='PASSAGEM AÉREA - SIGEPA')){
        const portalId=mapPortalIdentity(c.personId,firstAnnual.rows,secondAnnual.rows,scope.legislature),check:PortalCheck=portalId===null?{personId:c.personId,year:c.year,month:c.month,portalId:null,status:'unavailable',sources:[],count:null,totalCents:null,signatureSha256:null}:await checkPortal({personId:c.personId,portalId,year:c.year,month:c.month},api[1]!.filter(r=>(r.raw as any)?.tipoDespesa==='PASSAGEM AÉREA - SIGEPA').map(r=>r.raw),one,two);
        portalChecks.push(check);if(check.status==='matched')for(const r of unresolved)portalCovered.add(equationKey({kind:'api',personId:c.personId,source:{...r.source,row:r.row}}));
      }
      if(unresolved.some(r=>!portalCovered.has(equationKey({kind:'api',personId:c.personId,source:{...r.source,row:r.row}}))))throw Error();
      stableDigest(selected.map(r=>({personId:c.personId,raw:r.raw})));
    }catch{c.reasons.push('ambiguous-identical-occurrences');continue;}
    let annual:Expense[],apiRecords:Expense[];
    try{
      annual=selected.map(({raw,row})=>{const source={url:secondAnnual.source.url,sha256:secondAnnual.csvSha256,row,fetchedAt:secondAnnual.source.fetchedAt};return normalizeAnnual(raw,scope,source,equationReview.permissions.get(equationKey({kind:'annual',personId:c.personId,source})));});
      const ordinals=new Map<string,number>();
      apiRecords=api[1]!.map(({raw,source:ref,row})=>{const source={url:ref.url,sha256:ref.sha256,row,fetchedAt:ref.fetchedAt},key=equationKey({kind:'api',personId:c.personId,source}),record=normalize(raw,c.personId,scope,source,equationReview.permissions.get(key));if(portalCovered.has(key)){const ordinal=ordinals.get(record.id)??0;ordinals.set(record.id,ordinal+1);return {...record,id:hash(canonical(['portal-occurrence.v1',record.id,ordinal])),multiplicityBasis:'portal-corroborated' as const,occurrenceOrdinal:ordinal};}return record;});
    }catch{c.reasons.push('financial-normalization-failed');continue;}
    c.diagnostics=unmatched(annual,apiRecords);
    try{c.records=unionRecords(annual,apiRecords).records;}catch{c.reasons.push('unreconciled-source-occurrences');continue;}
    const sum=c.records.reduce((n,r)=>n+BigInt(r.cents),0n);if(sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER))throw Error('Total financeiro fora do limite');
    c.totalCents=Number(sum);c.status=c.records.length?'complete':'no-expenses-confirmed';
  }
  const sources:ExpenseSource[]=[...one.captures.map(s=>({...s,pass:1 as const})),...two.captures.map(s=>({...s,pass:2 as const}))];
  const complete=cells.every(c=>c.status==='complete'||c.status==='no-expenses-confirmed'),sum=cells.reduce((n,c)=>n+BigInt(c.totalCents??0),0n);if(sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER))throw Error('Total financeiro fora do limite');
  const stats=[one.stats,two.stats],report:ExpenseBatch={schema:'clareia.expense-intermediate.v1',equationRule:'camara.ceap.correlated-net.v1',equationDecisions:equationReview.decisions,multiplicityRule:'camara.ceap.sigepa-annual-routes.v1',multiplicityDecisions:multiplicityReview.decisions,portalRule:'camara.ceap.sigepa-portal-ledger.v1',portalRequested:options.portal===true,portalChecks,contentSha256:'',scope,peopleVersion:hash(canonical(temporal)),proposalSha256,createdAt:new Date().toISOString(),status:'review-required',publicationEligible:false,annual:[firstAnnual,secondAnnual].map(a=>({source:a.source,csvSha256:a.csvSha256,scanned:a.scanned})) as ExpenseBatch['annual'],cells,sources,totalCents:complete?Number(sum):null,metrics:{elapsedMs:Date.now()-start,maxRssKiB:process.resourceUsage().maxRSS,sourceBytes:sources.reduce((n,s)=>n+s.bytes,0),requests:stats.reduce((n,s)=>n+s.requests,0),retries:stats.reduce((n,s)=>n+s.retries,0),cacheHits:stats.reduce((n,s)=>n+s.cacheHits,0),downloadedBytes:stats.reduce((n,s)=>n+s.downloadedBytes,0)}};
  report.contentSha256=expenseBatchContentId(report);
  if(findCpfs(JSON.stringify(report),known))throw Error('Identificador privado no relatório financeiro');return report;
}
