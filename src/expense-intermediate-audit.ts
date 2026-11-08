import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {unzipSync} from 'fflate';
import {BASE,canonical,hash} from './model.ts';
import type {Expense,Scope,FinancialBasis} from './model.ts';
import type {ExpenseBatch,ExpenseSource} from './expense-intermediate.ts';
import type {TemporalReport} from './people-temporal.ts';
import {findCpfs} from './cpf-scan.ts';
import {independentEquationReview,independentFlightMultiplicity} from './expense-equations-audit.ts';
import type {EquationInput} from './expense-equations.ts';
import {independentPortalReview,isAnalyticUrl} from './cota-portal-audit.ts';
import type {PortalCheck} from './cota-portal.ts';

type RawRow={raw:any;row:number;source:ExpenseSource};
const digest=(rows:unknown[])=>hash(rows.map(canonical).sort().join('\n'));
const amount=(value:unknown)=>{const text=String(value).trim().replace(',','.');if(!/^-?\d+(\.\d{1,2})?$/.test(text))throw Error();const [whole,part='']=text.replace('-','').split('.'),n=(BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))*(text.startsWith('-')?-1n:1n);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw Error();return Number(n);};
const verifiedCnpj=(s:string)=>{
  if(!/^\d{14}$/.test(s)||/^(\d)\1+$/.test(s))return false;
  for(const [size,weights] of [[12,[5,4,3,2,9,8,7,6,5,4,3,2]],[13,[6,5,4,3,2,9,8,7,6,5,4,3,2]]] as const){const remainder=weights.reduce((sum,w,i)=>sum+Number(s[i])*w,0)%11;if(Number(s[size])!==(remainder<2?0:11-remainder))return false;}return true;
};
function project(row:RawRow,id:number,scope:Scope,kind:'annual'|'api',csvHash?:string,basis?:FinancialBasis):Expense{
  const r=row.raw,annual=kind==='annual',year=Number(annual?r.numAno:r.ano),month=Number(annual?r.numMes:r.mes);
  if(!r||year!==scope.year||!scope.months.includes(month)||annual&&(Number(r.ideCadastro)!==id||Number(r.codLegislatura)!==scope.legislature))throw Error();
  if(!annual){
    for(const key of ['ano','mes','codLote','codTipoDocumento','parcela'])if(!Number.isInteger(r[key]))throw Error();
    for(const key of ['numDocumento','tipoDespesa','tipoDocumento','nomeFornecedor'])if(typeof r[key]!=='string')throw Error();
    if(!r.tipoDespesa||typeof r.codDocumento!=='string'&&!Number.isInteger(r.codDocumento)||r.numRessarcimento!==null&&!['string','number'].includes(typeof r.numRessarcimento))throw Error();
    for(const key of ['cnpjCpfFornecedor','dataDocumento','urlDocumento'])if(r[key]!==null&&typeof r[key]!=='string')throw Error();
    for(const key of ['valorLiquido','valorDocumento','valorGlosa'])if(typeof r[key]!=='number'||!Number.isFinite(r[key]))throw Error();
  }
  const category=annual?r.txtDescricao:r.tipoDespesa;if(typeof category!=='string'||!category.trim())throw Error();
  const money=(field:string)=>annual&&!r[field]?.trim()?null:amount(r[field]);
  const net=money(annual?'vlrLiquido':'valorLiquido'),face=money(annual?'vlrDocumento':'valorDocumento'),glosa=money(annual?'vlrGlosa':'valorGlosa');if(net===null||face!==null&&glosa!==null&&face-glosa!==net&&!basis)throw Error();
  const identity=String((annual?r.txtCNPJCPF:r.cnpjCpfFornecedor)||'').replace(/\D/g,''),verified=verifiedCnpj(identity),privatePerson=identity.length===11;
  const name=String((annual?r.txtFornecedor:r.nomeFornecedor)||'Fornecedor não informado').replace(/(?<![\d./-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d/])/g,'[CPF oculto]');
  let receipt:string|null=null;try{const url=new URL(annual?r.urlDocumento:r.urlDocumento);if(!privatePerson&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&(url.hostname==='camara.leg.br'||url.hostname.endsWith('.camara.leg.br'))){url.protocol='https:';receipt=url.href;}}catch{}
  const occurrence=hash(canonical({personId:id,raw:r}));
  return {id:occurrence,personId:id,year,month,category,supplier:privatePerson?'Fornecedor pessoa física':name,supplierKey:verified?hash('cnpj:'+identity):occurrence,supplierVerified:verified,documentId:annual?r.ideDocumento||'Não informado':String(r.codDocumento),documentNumber:annual?r.txtNumero||'Não informado':r.numDocumento,date:annual?r.datEmissao||null:r.dataDocumento,lot:annual?r.numLote||'':String(r.codLote),receipt,cents:net,documentCents:face,disallowedCents:glosa,source:{url:row.source.url,sha256:annual?csvHash!:row.source.sha256,row:row.row,fetchedAt:row.source.fetchedAt},...(basis?{financialBasis:basis}:{})};
}
// This verifier reads sources and independently projects records, paginates,
// parses money and pairs occurrences. It does not import collection, financial
// normalization, stableDigest, unionRecords or pairOccurrences implementations.
export async function auditExpenseBatch(report:ExpenseBatch,temporal:TemporalReport,expectedScope:Scope,proposalSha256:string,read:(s:ExpenseSource)=>Promise<Uint8Array>){
  const failures:{personId?:number;month?:number;code:string}[]=[],fail=(code:string,c?:{personId:number;month:number})=>failures.push(c?{personId:c.personId,month:c.month,code}:{code});
  const known=new Set<string>(),json=new Map<string,any>(),html=new Map<string,Uint8Array>(),refs=new Map<string,ExpenseSource>(),used=new Set<string>(),annuals=new Map<number,{rows:RawRow[];csvHash:string;scanned:number}>();
  if(report.schema!=='clareia.expense-intermediate.v1'||report.publicationEligible!==false||report.status!=='review-required')fail('publication-gate');
  if(canonical(report.scope)!==canonical(expectedScope)||report.peopleVersion!==hash(canonical(temporal))||report.proposalSha256!==proposalSha256)fail('input-version-or-scope');
  if(expectedScope.legislature!==temporal.scope.legislature)fail('temporal-legislature');
  const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>k!=='fetchedAt').map(k=>[k,stable(v[k])])):v;
  const body=JSON.parse(JSON.stringify(report));delete body.createdAt;delete body.metrics;delete body.contentSha256;body.sources.sort((a:ExpenseSource,b:ExpenseSource)=>a.pass-b.pass||a.url.localeCompare(b.url));
  if(report.contentSha256!==hash(canonical(stable(body))))fail('logical-content-version');
  const scope=expectedScope,annualUrl=`https://www.camara.leg.br/cotas/Ano-${scope.year}.csv.zip`;
  const remember=(value:unknown)=>{if(typeof value==='string'){const n=value.replace(/\D/g,'');if(n.length===11)known.add(hash(n));}};
  for(const s of report.sources){
    const key=s.pass+':'+s.url;if(![1,2].includes(s.pass)||s.file!==hash(s.url)+'.sealed'||refs.has(key))throw Error('Referência financeira inválida');refs.set(key,s);
    const u=new URL(s.url),analytic=isAnalyticUrl(u);if(u.username||u.password||u.hash||s.url!==annualUrl&&s.url!==BASE+'/api-docs'&&!analytic&&(u.origin!=='https://dadosabertos.camara.leg.br'||!/^\/api\/v2\/deputados\/\d+\/despesas$/.test(u.pathname)))throw Error('Origem financeira inválida');
    const bytes=await read(s);if(hash(bytes)!==s.sha256||bytes.length!==s.bytes)throw Error('Hash de original financeiro diverge');
    if(s.url===annualUrl){
      const name=`Ano-${scope.year}.csv`,csv=unzipSync(bytes,{filter:entry=>entry.name===name&&entry.originalSize<=200_000_000})[name];if(!csv)throw Error('CSV independente ausente');
      const rows:RawRow[]=[];let scanned=0;
      const reader=Readable.from([csv]).pipe(parse({delimiter:';',bom:true,skip_empty_lines:true,columns:(keys:string[])=>{const required=['ideCadastro','numAno','numMes','codLegislatura','txtDescricao','vlrLiquido','vlrDocumento','vlrGlosa','ideDocumento','txtFornecedor','txtCNPJCPF','urlDocumento','txtNumero','datEmissao','numLote'];if(new Set(keys).size!==keys.length||required.some(k=>!keys.includes(k)))throw Error('Contrato CSV independente mudou');return keys;}}));
      for await(const raw of reader){remember(raw.txtCNPJCPF);remember(raw.cpf);const row=scanned++;
        if(scope.ids.includes(Number(raw.ideCadastro))&&(!/^\d+$/.test(raw.ideCadastro)||!/^\d{4}$/.test(raw.numAno)||!Number.isInteger(Number(raw.numMes))||Number(raw.numMes)<1||Number(raw.numMes)>12||!/^\d{1,2}$/.test(raw.numMes)))throw Error('Competência anual independente inválida');
        if(Number(raw.numAno)===scope.year&&scope.months.includes(Number(raw.numMes))&&scope.ids.includes(Number(raw.ideCadastro)))rows.push({raw,row,source:s});}
      annuals.set(s.pass,{rows,csvHash:hash(csv),scanned});used.add(key);
    }else if(analytic){html.set(key,bytes);}else{
      let raw:any=null;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}json.set(key,raw);
      if(Array.isArray(raw?.dados))for(const r of raw.dados)remember(r.cnpjCpfFornecedor);
    }
  }
  const contract=refs.get('1:'+BASE+'/api-docs'),parameters=json.get('1:'+BASE+'/api-docs')?.paths?.['/deputados/{id}/despesas']?.get?.parameters;
  if(!contract||!Array.isArray(parameters)||['ano','mes','idLegislatura','itens','pagina','ordem','ordenarPor'].some(name=>!parameters.some((p:any)=>p.name===name&&p.in==='query')))throw Error('Contrato financeiro independente ausente');used.add('1:'+BASE+'/api-docs');
  const first=annuals.get(1),second=annuals.get(2);if(!first||!second)throw Error('Dois anuais financeiros são obrigatórios');
  for(const [index,a] of [first,second].entries())if(canonical(report.annual[index])!==canonical({source:refs.get((index+1)+':'+annualUrl),csvSha256:a.csvHash,scanned:a.scanned}))fail('annual-metadata');
  const annualStable=digest(first.rows.map(r=>r.raw))===digest(second.rows.map(r=>r.raw));
  function api(id:number,month:number,pass:number){
    const pages:ExpenseSource[]=[],rows:RawRow[]=[],bodyHashes=new Set<string>(),size=pass===1?100:25;
    const start=`${BASE}/deputados/${id}/despesas?ano=${scope.year}&mes=${month}&idLegislatura=${scope.legislature}&itens=${size}&ordem=ASC&ordenarPor=codDocumento&pagina=1`,initial=new URL(start),params=(u:URL)=>canonical([...u.searchParams].filter(([k])=>k!=='pagina').sort());
    const verify=(value:string)=>{const u=new URL(value);if(u.origin!==initial.origin||u.pathname!==initial.pathname||u.username||u.password||u.hash||params(u)!==params(initial)||u.searchParams.getAll('pagina').length!==1||!/^[1-9]\d*$/.test(u.searchParams.get('pagina')||''))throw Error();return Number(u.searchParams.get('pagina'));};
    let url:string|null=start,page=0,final:number|null=null,probe=false,previousCount=0;
    try{while(url){
      if(++page>1000||verify(url)!==page)throw Error();const key=pass+':'+url,source=refs.get(key);if(!source)throw Error();used.add(key);const raw=json.get(key);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();pages.push(source);
      if(!Array.isArray(raw.dados)||!Array.isArray(raw.links)||raw.links.some((l:any)=>!l||typeof l.rel!=='string'||typeof l.href!=='string'))throw Error();
      const self=raw.links.filter((l:any)=>l.rel==='self');if(self.length>1||self.length===1&&verify(self[0].href)!==page)throw Error();
      const next=raw.links.filter((l:any)=>l.rel==='next'),last=raw.links.filter((l:any)=>l.rel==='last');if(next.length>1||last.length>1)throw Error();
      if(probe){if(raw.dados.length!==0||next.length!==0||last.some((l:any)=>verify(l.href)!==page-1))throw Error();break;}
      if(raw.dados.length===0&&page>1&&final===page-1&&previousCount===size&&next.length===0&&last.length===0)break;
      if(last.length){const n=verify(last[0].href);if(n<page||final!==null&&final!==n)throw Error();final=n;}
      const h=hash(canonical(raw.dados));if(raw.dados.length&&bodyHashes.has(h)||!raw.dados.length&&(page>1||next.length))throw Error();bodyHashes.add(h);
      raw.dados.forEach((r:any,index:number)=>rows.push({raw:r,row:index,source}));
      previousCount=raw.dados.length;
      if(next.length){if(verify(next[0].href)!==page+1)throw Error();url=next[0].href;}else{if(final!==null&&final!==page)throw Error();if(final===null&&raw.dados.length===size){const nextUrl=new URL(start);nextUrl.searchParams.set('pagina',String(page+1));url=nextUrl.href;probe=true;}else url=null;}
    }return {rows,pages,count:rows.length};}catch{return {rows:null,pages,count:null};}
  }
  const expectedKeys=scope.ids.flatMap(id=>scope.months.map(month=>id+':'+month)),actualKeys=report.cells.map(c=>c.personId+':'+c.month);
  if(new Set(actualKeys).size!==actualKeys.length||canonical([...expectedKeys].sort())!==canonical([...actualKeys].sort()))fail('competence-universe');
  const reads=new Map<string,[ReturnType<typeof api>,ReturnType<typeof api>]>(),equationInputs:EquationInput[]=second.rows.map(r=>({kind:'annual',personId:Number(r.raw.ideCadastro),raw:r.raw,source:{url:r.source.url,sha256:second.csvHash,row:r.row,fetchedAt:r.source.fetchedAt}}));
  for(const id of scope.ids)for(const month of scope.months){const pair:[ReturnType<typeof api>,ReturnType<typeof api>]=[api(id,month,1),api(id,month,2)];reads.set(id+':'+month,pair);if(annualStable&&pair[0].rows!==null&&pair[1].rows!==null&&digest(pair[0].rows.map(r=>r.raw))===digest(pair[1].rows.map(r=>r.raw)))for(const r of pair[1].rows)equationInputs.push({kind:'api',personId:id,raw:r.raw,source:{url:r.source.url,sha256:r.source.sha256,row:r.row,fetchedAt:r.source.fetchedAt}});}
  const equationReview=independentEquationReview(scope,annualStable?equationInputs:[]);
  const multiplicityReview=independentFlightMultiplicity(scope,annualStable?equationInputs:[]);
  if(report.equationRule!=='camara.ceap.correlated-net.v1'||canonical(report.equationDecisions)!==canonical(equationReview.decisions))fail('equation-review-evidence');
  if(report.multiplicityRule!=='camara.ceap.sigepa-annual-routes.v1'||canonical(report.multiplicityDecisions)!==canonical(multiplicityReview.decisions))fail('multiplicity-review-evidence');
  if(report.portalRule!=='camara.ceap.sigepa-portal-ledger.v1'||typeof report.portalRequested!=='boolean')fail('portal-review-contract');
  const portalChecks:PortalCheck[]=[],portalCovered=new Set<string>();
  const permission=(kind:'annual'|'api',personId:number,r:RawRow)=>equationReview.permissions.get(hash(JSON.stringify([kind,personId,r.source.url,kind==='annual'?second.csvHash:r.source.sha256,r.row])));
  let grand=0n,allComplete=true;
  for(const c of report.cells){
    const coverage=temporal.people.find(p=>p.id===c.personId)?.months.find(m=>m.year===scope.year&&m.month===c.month);
    if(!coverage||c.year!==scope.year||canonical([c.exercise,c.party,c.uf])!==canonical([coverage.exercise,coverage.party,coverage.uf]))fail('temporal-coverage',c);
    const [one,two]=reads.get(c.personId+':'+c.month)??[api(c.personId,c.month,1),api(c.personId,c.month,2)],annual=second.rows.filter(r=>Number(r.raw.ideCadastro)===c.personId&&Number(r.raw.numMes)===c.month);
    if(c.annualCount!==annual.length||canonical(c.api)!==canonical([one,two].map(p=>({count:p.count,pages:p.pages}))))fail('source-counts-or-pages',c);
    let reasons:string[]=[],records:Expense[]=[],total:number|null=null,diagnostics:typeof c.diagnostics=null,status:typeof c.status='held-review';
    if(one.rows===null)reasons.push('api-source-failure-pass-1');if(two.rows===null)reasons.push('api-source-failure-pass-2');
    if(reasons.length)status='source-failure';
    else if(!annualStable)reasons=['annual-changed-between-passes'];
    else{
      const a=one.rows!,b=two.rows!,duplicates=(rows:RawRow[])=>new Set(rows.map(r=>canonical(r.raw))).size!==rows.length;
      const apiCounts=new Map<string,number>();for(const r of b){const key=canonical(r.raw);apiCounts.set(key,(apiCounts.get(key)??0)+1);}
      const rowKey=(r:RawRow)=>hash(JSON.stringify(['api',c.personId,r.source.url,r.source.sha256,r.row]));
      const unresolved=b.filter(r=>(apiCounts.get(canonical(r.raw))??0)>1&&!multiplicityReview.covered.has(rowKey(r)));
      const apiStable=digest(a.map(r=>({personId:c.personId,raw:r.raw})))===digest(b.map(r=>({personId:c.personId,raw:r.raw})));
      if(apiStable&&unresolved.length&&report.portalRequested&&unresolved.every(r=>r.raw?.tipoDespesa==='PASSAGEM AÉREA - SIGEPA')){
        const check=await independentPortalReview(c.personId,scope.year,c.month,scope.legislature,[first.rows,second.rows],b.filter(r=>r.raw?.tipoDespesa==='PASSAGEM AÉREA - SIGEPA').map(r=>r.raw),async(pass,url)=>{const key=pass+':'+url,source=refs.get(key),bytes=html.get(key);if(!source||!bytes)return null;used.add(key);return {source,bytes};});
        portalChecks.push(check);if(check.status==='matched')for(const r of unresolved)portalCovered.add(rowKey(r));
      }
      if(!apiStable)reasons=['api-changed-between-passes'];
      else if(unresolved.some(r=>!portalCovered.has(rowKey(r))))reasons=['ambiguous-identical-occurrences'];
      else if(duplicates(annual))reasons=['ambiguous-identical-occurrences'];
      else{
        let ar:Expense[]=[],br:Expense[]=[];
        try{ar=annual.map(r=>project(r,c.personId,scope,'annual',second.csvHash,permission('annual',c.personId,r)));const ordinals=new Map<string,number>();br=b.map(r=>{const record=project(r,c.personId,scope,'api',undefined,permission('api',c.personId,r));if(portalCovered.has(rowKey(r))){const ordinal=ordinals.get(record.id)??0;ordinals.set(record.id,ordinal+1);return {...record,id:hash(canonical(['portal-occurrence.v1',record.id,ordinal])),multiplicityBasis:'portal-corroborated' as const,occurrenceOrdinal:ordinal};}return record;});}catch{reasons=['financial-normalization-failed'];}
        if(!reasons.length){
          const blank=(s:string)=>s==='Não informado'?'':s,key=(r:Expense)=>canonical([r.personId,r.month,blank(r.documentId),r.category,r.cents]),pool=new Map<string,Expense[]>(),left:Expense[]=[],matches:{a:Expense;b:Expense}[]=[];
          for(const r of br)pool.set(key(r),[...(pool.get(key(r))??[]),r]);
          for(const r of ar){const list=pool.get(key(r));if(list?.length)matches.push({a:r,b:list.shift()!});else left.push(r);}
          const right=[...pool.values()].flat(),groups=(rs:Expense[])=>Object.fromEntries([...new Set(rs.map(r=>r.category))].map(k=>[k,rs.filter(r=>r.category===k).length]));diagnostics={annualOnly:groups(left),apiOnly:groups(right)};
          if(matches.some(({a,b})=>blank(a.documentNumber)!==blank(b.documentNumber)||(a.date?.slice(0,10)||null)!==(b.date?.slice(0,10)||null)||(a.lot||'')!==(b.lot||''))||left.some(r=>!['TELEFONIA','COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA'].includes(r.category))||right.some(r=>r.category!=='PASSAGEM AÉREA - SIGEPA'))reasons=['unreconciled-source-occurrences'];
          else{
            records=[...matches.map(({a})=>({...a,origin:'both' as const})),...left.map(r=>({...r,origin:'annual' as const})),...right.map(r=>({...r,origin:'api' as const}))];
            total=Number(records.reduce((n,r)=>n+BigInt(r.cents),0n));if(!Number.isSafeInteger(total))throw Error('Total independente fora da precisão segura');status=records.length?'complete':'no-expenses-confirmed';
          }
        }
      }
    }
    if(canonical({status,reasons,records,totalCents:total,diagnostics})!==canonical({status:c.status,reasons:c.reasons,records:c.records,totalCents:c.totalCents,diagnostics:c.diagnostics}))fail('financial-records-coverage-or-union',c);
    if(total===null)allComplete=false;else grand+=BigInt(total);
  }
  if(canonical(report.portalChecks)!==canonical(portalChecks))fail('portal-review-evidence');
  if(!Number.isSafeInteger(Number(grand)))fail('grand-total-overflow');if(report.totalCents!==(allComplete?Number(grand):null))fail('grand-total');
  if(used.size!==refs.size)fail('unreferenced-source');
  if(report.metrics.sourceBytes!==report.sources.reduce((n,s)=>n+s.bytes,0))fail('source-byte-count');
  if(findCpfs(JSON.stringify(report),known))fail('private-identifier');
  return {schema:'clareia.expense-intermediate-audit.v1',status:failures.length?'failed':'passed',checkedAt:new Date().toISOString(),reportSha256:hash(canonical(report)),peopleVersion:hash(canonical(temporal)),proposalSha256,scope,competences:expectedKeys.length,failures,publicationEligible:false,note:'Releitura independente de originais, registros, centavos, paginação, multiplicidades, cobertura e união; casos retidos continuam retidos. Não aprova publicação nem legitimidade da despesa.'};
}
