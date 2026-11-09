import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {unzipSync} from 'fflate';
import {z} from 'zod';
import {BASE,canonical,hash,readLimited,RETRY_WAITS,retryWait} from './model.ts';
import {seal,open} from './vault.ts';
import {assertArchive} from './sources.ts';

export type DiscoveryScope={legislature:number;start:string;end:string;sampleIds:number[]};
export type Capture={url:string;sha256:string;file:string;fetchedAt:string;bytes:number};
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type JsonObject=Record<string,any>;
export type AnnualIdentityIndex={year:number;scanned:number;selected:number;people:{id:number;months:number[];rows:number}[];issues:{row:number;reason:string}[]};
export type Candidate={id:number;inPeriodList:boolean;inLegislatureList:boolean;inCombinedList:boolean;annualYears:number[];classification:'historical-list'|'financial-only'|'legislature-only'|'combined-list-only'};
export type PeopleList={ids:number[];rows:number;repeatedIds:{id:number;rows:number}[]};
export type DiscoveryReport={
  schema:'clareia.people-discovery.v1';scope:DiscoveryScope;createdAt:string;
  status:'discovery-only';sources:Capture[];contract:ReturnType<typeof inspectPeopleContract>;
  sets:{period:number[];legislature:number[];combined:number[]};listRows:{period:Omit<PeopleList,'ids'>;legislature:Omit<PeopleList,'ids'>;combined:Omit<PeopleList,'ids'>};annuals:AnnualIdentityIndex[];candidates:Candidate[];
  samples:ReturnType<typeof inspectSample>[];limitations:string[];
};
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function validDay(value:string):boolean{
  if(!DAY.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
export function parseDiscoveryScope(input:unknown,today=new Date().toISOString().slice(0,10)):DiscoveryScope{
  const parsed=z.object({legislature:z.number().int().positive(),start:z.string(),end:z.string(),sampleIds:z.array(z.number().int().positive()).max(30)}).strict().safeParse(input);
  if(!parsed.success)throw new Error('Escopo de descoberta inválido');
  const s=parsed.data;
  if(!validDay(s.start)||!validDay(s.end)||s.start>s.end||s.end>today||Number(s.start.slice(0,4))<2009||Number(s.end.slice(0,4))-Number(s.start.slice(0,4))>4||new Set(s.sampleIds).size!==s.sampleIds.length)throw new Error('Período ou amostra de descoberta inválidos');
  return s;
}
export function sourceAllowed(url:string):boolean{
  let u:URL;try{u=new URL(url);}catch{return false;}
  const legacy=u.origin==='https://www.camara.leg.br'&&u.pathname==='/SitCamaraWS/Deputados.asmx/ObterDetalhesDeputado'&&
    [...u.searchParams.keys()].sort().join(',')==='ideCadastro,numLegislatura'&&
    ['ideCadastro','numLegislatura'].every(key=>/^[1-9]\d{0,8}$/.test(u.searchParams.get(key)||''));
  if(u.origin==='https://dadosabertos.camara.leg.br'&&!u.search&&(/^\/arquivos\/(proposicoes\/csv\/proposicoes|proposicoesAutores\/csv\/proposicoesAutores)-20\d{2}\.csv$/.test(u.pathname)||/^\/api\/v2\/proposicoes\/[1-9]\d{0,9}\/tramitacoes$/.test(u.pathname)))return true;
  const expenses=u.origin==='https://dadosabertos.camara.leg.br'&&/^\/api\/v2\/deputados\/[1-9]\d{0,8}\/despesas$/.test(u.pathname)&&
    [...u.searchParams.keys()].sort().join(',')==='ano,idLegislatura,itens,mes,ordem,ordenarPor,pagina'&&
    ['ano','idLegislatura','itens','mes','pagina'].every(key=>/^[1-9]\d{0,8}$/.test(u.searchParams.get(key)||''))&&
    Number(u.searchParams.get('ano'))>=2009&&Number(u.searchParams.get('mes'))<=12&&[25,100].includes(Number(u.searchParams.get('itens')))&&u.searchParams.get('ordem')==='ASC'&&u.searchParams.get('ordenarPor')==='codDocumento';
  const portal=u.origin==='https://www.camara.leg.br'&&u.pathname==='/cota-parlamentar/analitico'&&
    [...u.searchParams.keys()].sort().join(',')==='cnpjFornecedor,dataFim,dataInicio,despesa,nomeFornecedor,nomeHospede,nomePassageiro,nuDeputadoId,numDocumento,sguf'&&
    /^[1-9]\d{0,8}$/.test(u.searchParams.get('nuDeputadoId')||'')&&u.searchParams.get('despesa')==='998'&&
    /^(?:[1-9]|1[0-2])\/\d{4}$/.test(u.searchParams.get('dataInicio')||'')&&u.searchParams.get('dataInicio')===u.searchParams.get('dataFim')&&
    ['cnpjFornecedor','nomeFornecedor','nomeHospede','nomePassageiro','numDocumento','sguf'].every(k=>u.searchParams.get(k)==='');
  return !u.username&&!u.password&&!u.hash&&(
    u.origin==='https://dadosabertos.camara.leg.br'&&/^\/api\/v2\/(?:api-docs|deputados(?:\/\d+(?:\/historico)?)?|legislaturas\/\d+|referencias\/deputados\/codSituacao)$/.test(u.pathname)||
    u.origin==='https://www.camara.leg.br'&&/^\/cotas\/Ano-\d{4}\.csv\.zip$/.test(u.pathname)&&!u.search||legacy||expenses||portal
  );
}
export class PeopleCapture {
  readonly captures:Capture[]=[];
  readonly stats={cacheHits:0,requests:0,retries:0,downloadedBytes:0};
  constructor(readonly directory:string,private readonly key:Buffer,private readonly fetcher:Fetcher=fetch,private readonly wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
    if(key.length!==32)throw new Error('Chave de originais inválida');
  }
  async get(url:string):Promise<{bytes:Uint8Array;source:Capture}>{
    if(!sourceAllowed(url))throw new Error('Origem de descoberta não permitida');
    await fs.mkdir(this.directory,{recursive:true});
    const stem=hash(url),metaFile=path.join(this.directory,stem+'.meta.json'),file=stem+'.sealed';
    let source:Capture,bytes:Uint8Array;
    // A run resumes its own immutable captures. A fresh run uses a fresh directory.
    try{
      source=JSON.parse(await fs.readFile(metaFile,'utf8'));
      if(source.url!==url||source.file!==file)throw new Error('Captura não corresponde à requisição');
      bytes=open(await fs.readFile(path.join(this.directory,file)),this.key);
      if(hash(bytes)!==source.sha256||bytes.length!==source.bytes)throw new Error('Hash de original diverge');
      this.stats.cacheHits++;
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Captura preservada inválida; não sobrescrever o original');
      let result:Uint8Array|undefined;
      for(let attempt=0;attempt<=RETRY_WAITS.length;attempt++){
        let retry:number|undefined;
        try{
          this.stats.requests++;if(attempt)this.stats.retries++;
          const response=await this.fetcher(url,{headers:{Accept:url.endsWith('.zip')?'application/zip':url.endsWith('.csv')?'text/csv':new URL(url).pathname.endsWith('/ObterDetalhesDeputado')?'application/xml, text/xml':new URL(url).pathname==='/cota-parlamentar/analitico'?'text/html':'application/json','User-Agent':'clareia-people-discovery'},redirect:'error',signal:AbortSignal.timeout(url.endsWith('.csv')?300_000:60_000)});
          if(response.ok){result=await readLimited(response,url.endsWith('.zip')?100_000_000:url.endsWith('.csv')?200_000_000:12_000_000);this.stats.downloadedBytes+=result.length;break;}
          if(response.status!==429&&response.status<500)throw new HttpFailure(response.status);
          const raw=response.headers.get('retry-after');
          const ms=raw===null?NaN:/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
          if(Number.isFinite(ms))retry=Math.max(0,Math.min(120_000,ms));
        }catch(error){
          if(error instanceof HttpFailure)throw new Error(`${url}: HTTP ${error.status}`);
          // Do not log response bodies or exception text that could include source data.
        }
        if(attempt===RETRY_WAITS.length)throw new Error(`${url}: falha após tentativas limitadas`);
        await this.wait(retry??retryWait(attempt));
      }
      bytes=result!;
      source={url,sha256:hash(bytes),file,fetchedAt:new Date().toISOString(),bytes:bytes.length};
      // Encrypt before any original is written, including profiles and annual CSV archives.
      const target=path.join(this.directory,file);
      const encrypted=seal(bytes,this.key);
      try{await fs.writeFile(target,encrypted,{flag:'wx',mode:0o600});}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;throw new Error('Captura incompleta encontrada; revisar sem sobrescrever');}
      await fs.writeFile(metaFile,JSON.stringify(source,null,2),{flag:'wx',mode:0o600});
    }
    if(!this.captures.some(c=>c.url===url))this.captures.push(source);
    return {bytes,source};
  }
  async json(url:string):Promise<{data:JsonObject;source:Capture}>{
    const {bytes,source}=await this.get(url);
    let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error(`${url}: JSON inválido`);}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error(`${url}: envelope inválido`);
    return {data:data as JsonObject,source};
  }
}
class HttpFailure extends Error{constructor(readonly status:number){super('HTTP '+status);}}

export function inspectPeopleContract(doc:JsonObject){
  const routes=['/deputados','/deputados/{id}','/deputados/{id}/historico'];
  const requiredList=['idLegislatura','dataInicio','dataFim','pagina','itens','ordem','ordenarPor'];
  const operations=routes.map(route=>{
    const op=doc.paths?.[route]?.get;
    if(!op||!Array.isArray(op.parameters)||!op.responses?.['200'])throw new Error('Contrato de pessoas mudou: recurso ausente');
    return {route,query:op.parameters.filter((p:JsonObject)=>p.in==='query').map((p:JsonObject)=>String(p.name)).sort() as string[]};
  });
  if(requiredList.some(p=>!operations[0].query.includes(p)))throw new Error('Contrato de pessoas mudou: filtros da lista ausentes');
  const fields=Object.keys(doc.components?.schemas?.DeputadoHistorico?.properties||{}).sort();
  if(['id','idLegislatura','dataHora','situacao','condicaoEleitoral','siglaPartido','siglaUf','descricaoStatus'].some(p=>!fields.includes(p)))throw new Error('Contrato de histórico mudou: campos ausentes');
  const historyQuery=operations[2].query;
  if(historyQuery.some(p=>['pagina','itens'].includes(p)))throw new Error('Histórico agora paginado: revisar coletor antes de continuar');
  return {schema:'clareia.camara-people-contract.v1',operations,historyFields:fields,historyDateSemantics:'not-yet-confirmed',temporalAttributionEnabled:false};
}
const envelope=z.object({dados:z.array(z.unknown()),links:z.array(z.object({rel:z.string(),href:z.string()}))});
const identity=z.object({id:z.number().int().positive()});
export async function listPeople(first:string,capture:PeopleCapture):Promise<PeopleList>{
  const initial=new URL(first),visited=new Set<string>(),seenBodies=new Set<string>(),ids=new Map<number,number>();
  let url:string|null=first,pages=0,lastPage:number|null=null;
  while(url){
    if(visited.has(url)||++pages>1000)throw new Error('Loop de paginação de pessoas');
    visited.add(url);const current=new URL(url);
    if(!sourceAllowed(url)||current.origin!==initial.origin||current.pathname!==initial.pathname)throw new Error('Paginação mudou de recurso');
    const originalParams=[...initial.searchParams].filter(([key])=>key!=='pagina').sort();
    const currentParams=[...current.searchParams].filter(([key])=>key!=='pagina').sort();
    if(canonical(originalParams)!==canonical(currentParams))throw new Error('Paginação mudou de recorte');
    if(current.searchParams.getAll('pagina').length!==1||Number(current.searchParams.get('pagina'))!==pages)throw new Error('Página fora da sequência');
    const {data}=await capture.json(url),parsed=envelope.safeParse(data);
    if(!parsed.success)throw new Error('Envelope da lista de pessoas mudou');
    const {dados,links}=parsed.data,digest=hash(canonical(dados));
    if(dados.length&&seenBodies.has(digest))throw new Error('Página repetida');seenBodies.add(digest);
    const lasts=links.filter(l=>l.rel==='last');if(lasts.length>1)throw new Error('Mais de uma última página');
    if(lasts[0]){
      const target=new URL(lasts[0].href),expected=new URL(current);expected.searchParams.set('pagina',target.searchParams.get('pagina')||'');
      const same=[...target.searchParams].sort();
      if(target.origin!==initial.origin||target.pathname!==initial.pathname||canonical(same)!==canonical([...expected.searchParams].sort()))throw new Error('Última página mudou de recorte');
      const n=Number(target.searchParams.get('pagina'));
      if(!Number.isInteger(n)||n<pages||lastPage!==null&&lastPage!==n)throw new Error('Última página inconsistente');lastPage=n;
    }
    // A temporal list can repeat an official ID with different historical party
    // attributes. Preserve every raw row; the universe is a SET of identities,
    // never an attribution of those party fields to a particular month.
    for(const raw of dados){const row=identity.safeParse(raw);if(!row.success)throw new Error('ID inválido na lista histórica');ids.set(row.data.id,(ids.get(row.data.id)||0)+1);}
    const next=links.filter(l=>l.rel==='next');if(next.length>1)throw new Error('Mais de uma próxima página');
    url=next[0]?.href??null;
    if(!dados.length)throw new Error('Lista histórica vazia exige revisão');
    if(!url&&lastPage!==null&&pages!==lastPage)throw new Error('Paginação incompleta');
    if(!url&&lastPage===null&&dados.length>=Number(initial.searchParams.get('itens')))throw new Error('Página cheia sem prova de término');
  }
  return {ids:[...ids.keys()].sort((a,b)=>a-b),rows:[...ids.values()].reduce((a,b)=>a+b,0),repeatedIds:[...ids].filter(([,n])=>n>1).sort(([a],[b])=>a-b).map(([id,rows])=>({id,rows}))};
}
export async function annualIdentityIndex(archive:Uint8Array,year:number,scope:DiscoveryScope):Promise<AnnualIdentityIndex>{
  assertArchive(archive,22);
  const expected=`Ano-${year}.csv`;
  const files=unzipSync(archive,{filter:file=>{if(file.name!==expected)return false;if(file.originalSize>200_000_000)throw new Error('CSV anual acima do limite');return true;}});
  const bytes=files[expected];if(!bytes)throw new Error('CSV anual esperado ausente');
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({delimiter:';',bom:true,skip_empty_lines:true,columns:(columns:string[])=>{
    if(new Set(columns).size!==columns.length||['ideCadastro','numAno','numMes','codLegislatura'].some(c=>!columns.includes(c)))throw new Error('Contrato de identidade no anual mudou');return columns;
  }}));
  const people=new Map<number,{id:number;months:Set<number>;rows:number}>(),issues:AnnualIdentityIndex['issues']=[];
  let scanned=0,selected=0;
  for await(const row of stream){
    const position=scanned++;
    if(!/^\d{4}$/.test(row.numAno)||!/^(?:[1-9]|1[0-2])$/.test(row.numMes))throw new Error('Competência inválida no anual');
    if(Number(row.numAno)!==year)throw new Error('Ano diverge do arquivo contratado');
    const month=Number(row.numMes),competence=`${year}-${String(month).padStart(2,'0')}`;
    if(competence<scope.start.slice(0,7)||competence>scope.end.slice(0,7))continue;
    selected++;
    if(!/^\d+$/.test(row.ideCadastro)||!Number.isSafeInteger(Number(row.ideCadastro))||Number(row.ideCadastro)<1){issues.push({row:position,reason:'invalid-person-id'});continue;}
    const id=Number(row.ideCadastro),entry=people.get(id)||{id,months:new Set<number>(),rows:0};entry.months.add(month);entry.rows++;people.set(id,entry);
    if(String(scope.legislature)!==row.codLegislatura)issues.push({row:position,reason:'legislature-mismatch'});
  }
  if(!scanned||!selected)throw new Error('Arquivo anual vazio no período exige revisão');
  return {year,scanned,selected,people:[...people.values()].sort((a,b)=>a.id-b.id).map(p=>({...p,months:[...p.months].sort((a,b)=>a-b)})),issues};
}
export function compareUniverse(period:number[],legislature:number[],annuals:AnnualIdentityIndex[],combined:number[]=[]):Candidate[]{
  const historical=new Set(period),members=new Set(legislature),joined=new Set(combined),financial=new Map<number,number[]>();
  for(const annual of annuals)for(const p of annual.people)financial.set(p.id,[...(financial.get(p.id)||[]),annual.year]);
  return [...new Set([...historical,...members,...joined,...financial.keys()])].sort((a,b)=>a-b).map(id=>({id,inPeriodList:historical.has(id),inLegislatureList:members.has(id),inCombinedList:joined.has(id),annualYears:[...new Set(financial.get(id)||[])].sort(),classification:historical.has(id)?'historical-list':financial.has(id)?'financial-only':members.has(id)?'legislature-only':'combined-list-only'}));
}
export function inspectSample(id:number,profile:JsonObject,history:JsonObject,scope:DiscoveryScope){
  if(profile.dados?.id!==id)throw new Error('ID do cadastro diverge da pessoa solicitada');
  const parsed=envelope.safeParse(history);if(!parsed.success)throw new Error('Envelope do histórico mudou');
  // History currently documents no pagination. Never silently accept a partial history.
  if(parsed.data.links.some(l=>['next','last'].includes(l.rel)))throw new Error('Histórico requer paginação não contratada');
  const issues:string[]=[],events=parsed.data.dados.map(raw=>{
    const row=z.object({id:z.number().int(),idLegislatura:z.number().int(),dataHora:z.string().nullable(),situacao:z.string().nullable(),condicaoEleitoral:z.string().nullable(),siglaPartido:z.string().nullable(),siglaUf:z.string().nullable(),descricaoStatus:z.string().nullable()}).safeParse(raw);
    if(!row.success)throw new Error('Campos do histórico mudaram');
    if(row.data.id!==id)throw new Error('Identidade divergente dentro do histórico');
    return row.data;
  });
  if(!events.length)issues.push('empty-history');
  const dates=events.map(e=>e.dataHora).filter((s):s is string=>s!==null);
  if(dates.some((d,i)=>i>0&&d<dates[i-1]))issues.push('source-not-chronological');
  if(events.some(e=>!e.dataHora||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(e.dataHora)||!validDay(e.dataHora.slice(0,10))))issues.push('invalid-or-missing-history-date');
  // Flag, do not fix, inconsistent legislature/date pairs in the observed source.
  if(events.some(e=>e.idLegislatura>scope.legislature&&e.dataHora&&e.dataHora.slice(0,10)<=scope.end))issues.push('later-legislature-event-before-scope-cutoff');
  return {id,events,issues,temporalAttributionEnabled:false};
}
function listUrl(scope:DiscoveryScope,kind:'period'|'legislature'|'combined'):string{
  const url=new URL(BASE+'/deputados');
  if(kind!=='period')url.searchParams.set('idLegislatura',String(scope.legislature));
  if(kind!=='legislature'){url.searchParams.set('dataInicio',scope.start);url.searchParams.set('dataFim',scope.end);}
  url.searchParams.set('itens','100');url.searchParams.set('ordem','ASC');url.searchParams.set('ordenarPor','id');url.searchParams.set('pagina','1');
  return url.href;
}
export async function discoverPeople(scope:DiscoveryScope,capture:PeopleCapture,progress:(message:string)=>void=()=>{}):Promise<DiscoveryReport>{
  scope=parseDiscoveryScope(scope);
  progress('Validando contrato oficial');
  const {data:doc}=await capture.json(BASE+'/api-docs'),contract=inspectPeopleContract(doc);
  progress('Coletando lista histórica apenas por intervalo');const periodList=await listPeople(listUrl(scope,'period'),capture);
  progress('Coletando participantes apenas por legislatura');const legislatureList=await listPeople(listUrl(scope,'legislature'),capture);
  progress('Conferindo combinação dos filtros de intervalo e legislatura');const combinedList=await listPeople(listUrl(scope,'combined'),capture);
  const {ids:period,...periodRows}=periodList,{ids:legislature,...legislatureRows}=legislatureList,{ids:combined,...combinedRows}=combinedList;
  const annuals:AnnualIdentityIndex[]=[];
  for(let year=Number(scope.start.slice(0,4));year<=Number(scope.end.slice(0,4));year++){
    progress(`Conferindo IDs financeiros de ${year}`);
    const {bytes}=await capture.get(`https://www.camara.leg.br/cotas/Ano-${year}.csv.zip`);
    annuals.push(await annualIdentityIndex(bytes,year,scope));
  }
  const candidates=compareUniverse(period,legislature,annuals,combined),samples:ReturnType<typeof inspectSample>[]=[];
  // Differences must be inspected as well as the declared contract sample. No name matching.
  const reviewIds=[...new Set([...scope.sampleIds,...candidates.filter(c=>c.classification==='financial-only'||c.classification==='combined-list-only').map(c=>c.id)])];
  for(const id of reviewIds){
    progress(`Inspecionando cadastro e histórico do ID ${id}`);
    const {data:profile}=await capture.json(`${BASE}/deputados/${id}`),{data:history}=await capture.json(`${BASE}/deputados/${id}/historico`);
    samples.push(inspectSample(id,profile,history,scope));
  }
  return {schema:'clareia.people-discovery.v1',scope,createdAt:new Date().toISOString(),status:'discovery-only',sources:capture.captures,contract,sets:{period,legislature,combined},listRows:{period:periodRows,legislature:legislatureRows,combined:combinedRows},annuals,candidates,samples,limitations:[
    'Descoberta de candidatos, não publicação aprovada de exercício, filiação ou despesas.',
    'Histórico inspecionado apenas para a amostra e IDs financeiros ausentes da lista histórica; demais pessoas aguardam coleta própria.',
    'Semântica temporal de dataHora ainda não confirmada; nenhuma atribuição mensal foi derivada.',
    'Competência é mensal: os meses das fronteiras podem ser parciais; IDs anuais não provam exercício em um dia específico.',
    'Uma captura por recurso não comprova estabilidade da fonte; início/fim e hashes preservados para revisão.',
    'A lista histórica pode repetir IDs com atributos diferentes; multiplicidades registradas e originais preservados, sem usar partido da lista para atribuição mensal.',
    'Intervalo, legislatura e combinação coletados separadamente: combinar filtros não é presumido como interseção; participação/filiação dependem do histórico individual.',
    'Valores financeiros não foram calculados nem publicados por esta descoberta.'
  ]};
}
