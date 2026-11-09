import fs from 'node:fs/promises';
import path from 'node:path';
import {BASE,hash,canonical,snapshotId,envelopeSchema,normalize,stableDigest,officialUrl,METRIC,readLimited,RETRY_WAITS,retryWait,sourceError,UFS} from './model.ts';
import type {Scope,Person,Page,Snapshot} from './model.ts';
import { z } from 'zod';

type Fetcher=(url:string)=>Promise<Response>;
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function request(url:string,fetcher:Fetcher=u=>fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000),redirect:'error'}),wait=delay):Promise<string> {
  if(!officialUrl(url,'api'))throw new Error('Origem de API não permitida');
  let last:unknown;
  for(let attempt=0;attempt<=RETRY_WAITS.length;attempt++){
    try {const response=await fetcher(url);
      if(!response.ok){if(response.status!==429&&response.status<500)throw new FatalError(`${url}: HTTP ${response.status}`);
        const retry=response.headers.get('retry-after');if(retry)await wait(Math.min(30000,Number(retry)*1000||Date.parse(retry)-Date.now()));throw new Error('HTTP '+response.status);}
      const text=new TextDecoder().decode(await readLimited(response,12_000_000));JSON.parse(text);return text;
    }catch(e){if(e instanceof FatalError)throw e;last=e;if(attempt<RETRY_WAITS.length)await wait(retryWait(attempt));}
  }throw sourceError(url,last);
}
class FatalError extends Error {}
type Stored={data:unknown;page:Page};
export class RunCache {
  pages:Page[]=[];
  constructor(readonly directory:string,readonly fetcher?:Fetcher){}
  async get(url:string,pass:number):Promise<Stored>{
    await fs.mkdir(this.directory,{recursive:true});const key=hash(`${pass}:${url}`),file=`${key}.json`,meta=`${key}.meta.json`;let text:string;let page:Page;
    try {page=JSON.parse(await fs.readFile(path.join(this.directory,meta),'utf8'));text=await fs.readFile(path.join(this.directory,file),'utf8');if(page.url!==url||page.pass!==pass||hash(text)!==page.sha256||Date.now()-Date.parse(page.fetchedAt)>3600_000)throw new Error('Cache inválido ou expirado');}
    catch {text=await request(url,this.fetcher);const data=JSON.parse(text);page={url,pass,file,sha256:hash(text),fetchedAt:new Date().toISOString(),count:Array.isArray(data.dados)?data.dados.length:null};await fs.writeFile(path.join(this.directory,file),text);await fs.writeFile(path.join(this.directory,meta),JSON.stringify(page));await delay(this.fetcher?0:150);}
    this.pages.push(page);return {data:JSON.parse(text),page};
  }
}
export async function paginate(first:string,pass:number,cache:RunCache):Promise<{raw:unknown;page:Page;row:number}[]> {
  const rows:{raw:unknown;page:Page;row:number}[]=[],visited=new Set<string>(),bodies=new Set<string>();let url:string|null=first;let expectedLast:number|null=null;let pages=0;
  const initial=new URL(first);
  while(url){
    if(visited.has(url)||++pages>1000)throw new Error('Loop ou excesso de paginação');visited.add(url);
    const current=new URL(url);if(!officialUrl(url,'api')||current.pathname!==initial.pathname)throw new Error('Paginação mudou de recurso');
    for(const [k,v] of initial.searchParams)if(k!=='pagina'&&current.searchParams.get(k)!==v)throw new Error('Paginação mudou de recorte');
    if(Number(current.searchParams.get('pagina')||1)!==pages)throw new Error('Página fora da sequência');
    const {data,page}=await cache.get(url,pass);const result=envelopeSchema.parse(data);const digest=hash(canonical(result.dados));
    if(bodies.has(digest)&&result.dados.length)throw new Error('Página repetida');bodies.add(digest);
    const last=result.links.find(l=>l.rel==='last');if(last){const n=Number(new URL(last.href).searchParams.get('pagina'));if(!Number.isInteger(n)||n<pages)throw new Error('Última página inválida');if(expectedLast!==null&&expectedLast!==n)throw new Error('Quantidade de páginas mudou');expectedLast=n;}
    result.dados.forEach((raw,row)=>rows.push({raw,page,row}));
    const next=result.links.filter(l=>l.rel==='next');if(next.length>1)throw new Error('Mais de uma próxima página');
    url=next[0]?.href||null;
    if(!result.dados.length&&(url||pages>1))throw new Error('Página vazia inesperada');
    if(!url&&expectedLast!==null&&pages!==expectedLast)throw new Error('Paginação incompleta');
    if(!url&&expectedLast===null&&result.dados.length===Number(initial.searchParams.get('itens')))throw new Error('Página cheia sem prova de término');
  }return rows;
}
export async function collect(scope:Scope,cache:RunCache):Promise<Snapshot>{
  if(scope.ids.length!==3||new Set(scope.ids).size!==3||scope.months.length!==2||new Set(scope.months).size!==2)throw new Error('Piloto exige três IDs distintos e dois meses distintos');
  if(!Number.isInteger(scope.year)||scope.year<2009||scope.ids.some(id=>!Number.isInteger(id)||id<1)||scope.months.some(m=>!Number.isInteger(m)||m<1||m>12||Date.UTC(scope.year,m,1)>Date.now()))throw new Error('Recorte inválido ou mês não encerrado');
  const people:Person[]=[];
  for(const id of scope.ids){const url=`${BASE}/deputados/${id}`;const {data,page}=await cache.get(url,0);const profile=z.object({dados:z.object({id:z.number(),ultimoStatus:z.object({nome:z.string(),urlFoto:z.string().nullable(),siglaUf:z.string().nullish(),siglaPartido:z.string().nullish(),data:z.string().nullish()})})}).parse(data);if(profile.dados.id!==id)throw new Error('Identidade oficial divergente');const status=profile.dados.ultimoStatus;if(status.siglaUf&&!UFS.has(status.siglaUf))throw new Error(`UF inválida no cadastro oficial de ${id}`);people.push({id,name:status.nome,photo:status.urlFoto?officialUrl(status.urlFoto,'photo'):null,sourceUrl:url,profileFetchedAt:page.fetchedAt,uf:status.siglaUf??null,party:status.siglaPartido?.trim()||null,statusDate:status.data??null});}
  const passes=[];
  for(const pass of [1,2]){
    const rows=[];
    for(const personId of scope.ids)for(const month of scope.months){
      const url=`${BASE}/deputados/${personId}/despesas?ano=${scope.year}&mes=${month}&idLegislatura=${scope.legislature}&itens=${pass===1?100:25}&ordem=ASC&ordenarPor=codDocumento&pagina=1`;
      const result=await paginate(url,pass,cache);if(!result.length)throw new Error(`Recorte vazio exige revisão: ${personId}/${month}`);
      rows.push(...result.map(r=>({...r,personId})));
    }passes.push(rows);
  }
  const digest=stableDigest(passes[0]);if(digest!==stableDigest(passes[1]))throw new Error('A origem mudou entre as duas capturas; publicação retida');
  const rows=passes[1];const records=rows.map(r=>normalize(r.raw,r.personId,scope,{url:r.page.url,sha256:r.page.sha256,row:r.row,fetchedAt:r.page.fetchedAt}));
  // Independent decimal parsing from the source, without the cents()/normalization function.
  let independent=0n;
  for(const {raw} of rows){const text=String((raw as {valorLiquido:number}).valorLiquido);const [whole,frac='']=text.replace('-','').split('.');independent+=(BigInt(whole)*100n+BigInt((frac+'00').slice(0,2)))*(text.startsWith('-')?-1n:1n);}
  const total=records.reduce((n,r)=>n+r.cents,0);if(!Number.isSafeInteger(total)||BigInt(total)!==independent)throw new Error('Somas independentes divergiram');
  const body={metric:METRIC,scope,people,records,collectedAt:new Date().toISOString(),publishedAt:new Date().toISOString(),pages:cache.pages,validation:{stablePasses:2,recordCount:records.length,totalCents:total,independentTotalCents:String(independent),duplicatePolicy:'Ocorrências preservadas por versão/página/posição. Documento não é chave de evento; linhas idênticas são retidas para revisão.',limitations:['Piloto de três pessoas e dois meses, sem ranking nacional.','Duas capturas iguais não garantem ausência de erros da origem.','Soma do campo valorLiquido da API; não calcula restituições ausentes do endpoint nem gasto total do mandato.','Identidade pelo ID Câmara; nome e retrato consultados agora, sem atribuição histórica de partido/UF.','CPF e fornecedores sem CNPJ validado não são agrupados entre registros.','Conferência com arquivo anual e auditoria humana ampla ainda pendentes.']}};
  return {...body,id:snapshotId(body)};
}
