import { createHash } from 'node:crypto';
import { z } from 'zod';

export const BASE = 'https://dadosabertos.camara.leg.br/api/v2';
export const METRIC = 'camara.ceap.valor-liquido-api.v1';
export const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
// Capture timestamps are excluded so re-collecting identical content stays idempotent; everything else, including validation texts, changes the id.
export const SNAPSHOT_SCHEMA='clareia.snapshot.v2';
const CAPTURE_TIMES=new Set(['publishedAt','collectedAt','fetchedAt','profileFetchedAt']);
function withoutCaptureTimes(value:unknown):unknown{
  if(Array.isArray(value))return value.map(withoutCaptureTimes);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!CAPTURE_TIMES.has(k)).map(([k,v])=>[k,withoutCaptureTimes(v)]));
  return value;
}
export function snapshotId(snapshot:object):string{
  const {id,...body}=JSON.parse(JSON.stringify(snapshot));
  return hash(canonical({schema:SNAPSHOT_SCHEMA,body:withoutCaptureTimes(body)}));
}
// Some suppliers are individuals with a CPF inside the trade name; it never reaches a published record.
export const maskPersonalId=(name:string)=>name.replace(/(?<![\d./-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d/])/g,'[CPF oculto]');
export async function readLimited(response:Response,limit:number):Promise<Uint8Array> {
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Resposta excede limite');
  const parts:Uint8Array[]=[];let size=0;
  if(response.body)for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>limit)throw new Error('Resposta excede limite');parts.push(chunk);}
  return Buffer.concat(parts);
}
export function cents(value: number | string): number {
  const text=String(value);
  if(!/^-?\d+(\.\d{1,2})?$/.test(text))throw new Error('Valor monetário inválido: precisão maior que centavos ou formato inesperado');
  const negative=text.startsWith('-'), [integer,decimal='']=text.replace('-','').split('.');
  const n=Number(BigInt(integer)*100n+BigInt(decimal.padEnd(2,'0')))*(negative?-1:1);
  if(!Number.isSafeInteger(n))throw new Error('Valor fora da precisão segura');
  return n;
}
export const expenseSchema=z.object({
  ano:z.number().int(),mes:z.number().int().min(1).max(12),
  codDocumento:z.union([z.number().int(),z.string()]).transform(String),
  codLote:z.number().int(),codTipoDocumento:z.number().int(),parcela:z.number().int(),
  numDocumento:z.string(),numRessarcimento:z.union([z.string(),z.number()]).nullable(),
  tipoDespesa:z.string().min(1),tipoDocumento:z.string(),nomeFornecedor:z.string(),
  cnpjCpfFornecedor:z.string().nullable(),dataDocumento:z.string().nullable(),urlDocumento:z.string().nullable(),
  valorDocumento:z.number(),valorGlosa:z.number(),valorLiquido:z.number()
}).passthrough();
export const envelopeSchema=z.object({dados:z.array(z.unknown()),links:z.array(z.object({rel:z.string(),href:z.string()}))});
export type Scope={year:number;months:number[];ids:number[];legislature:number};
export type Person={id:number;name:string;photo:string|null;sourceUrl:string;profileFetchedAt:string};
export type SourceRef={url:string;sha256:string;row:number;fetchedAt:string};
export type Expense={id:string;personId:number;year:number;month:number;category:string;supplier:string;supplierKey:string;supplierVerified:boolean;documentId:string;documentNumber:string;date:string|null;lot?:string;receipt:string|null;cents:number;documentCents:number|null;disallowedCents:number|null;source:SourceRef;origin?:'both'|'annual'|'api'};
export type Page={url:string;sha256:string;file:string;fetchedAt:string;pass:number;count:number|null};
export type Snapshot={id:string;metric:string;scope:Scope;people:Person[];records:Expense[];collectedAt:string;publishedAt:string;pages:Page[];validation:{stablePasses:number;recordCount:number;totalCents:number;independentTotalCents:string;duplicatePolicy:string;limitations:string[];apiComparison?:{apiRecords:number;annualRecords:number;missingInApi:number;extraInApi:number;netDifferenceCents:number;paired?:number;originCents?:{both:number;annual:number;api:number}};sourceKind?:string;removedFromPrevious?:{personId:number;month:number;category:string;cents:number}[]}};

export function officialUrl(input:string, kind:'api'|'receipt'|'photo'):string|null {
  try {const u=new URL(input);if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
    if(u.username||u.password)return null;
    if(kind==='api'&&(u.origin!=='https://dadosabertos.camara.leg.br'||!u.pathname.startsWith('/api/v2/')))return null;
    if(kind!=='api'&&!(u.hostname==='camara.leg.br'||u.hostname.endsWith('.camara.leg.br')))return null;
    u.protocol='https:';return u.href;
  }catch{return null;}
}
export function normalize(raw:unknown,personId:number,scope:Scope,source:SourceRef):Expense {
  const r=expenseSchema.parse(raw);
  if(!scope.ids.includes(personId)||r.ano!==scope.year||!scope.months.includes(r.mes))throw new Error('Registro fora do recorte contratado');
  const net=cents(r.valorLiquido),face=cents(r.valorDocumento),glosa=cents(r.valorGlosa);
  if(face-glosa!==net)throw new Error('Documento menos glosa diverge do valor líquido: revisão obrigatória');
  const supplierId=(r.cnpjCpfFornecedor||'').replace(/\D/g,'');
  // Only validated CNPJ businesses are grouped across records. CPF/missing IDs remain separate.
  const verified=validCnpj(supplierId);
  const occurrence=hash(canonical({personId,raw}));
  return {id:occurrence,personId,year:r.ano,month:r.mes,category:r.tipoDespesa,supplier:maskPersonalId(r.nomeFornecedor||'Fornecedor não informado'),supplierKey:verified?hash('cnpj:'+supplierId):occurrence,supplierVerified:verified,documentId:r.codDocumento,documentNumber:r.numDocumento,date:r.dataDocumento,lot:String(r.codLote),receipt:r.urlDocumento?officialUrl(r.urlDocumento,'receipt'):null,cents:net,documentCents:face,disallowedCents:glosa,source};
}
export function validCnpj(id:string):boolean {
  if(!/^\d{14}$/.test(id)||/^(\d)\1+$/.test(id))return false;
  const check=(s:string)=>{let weight=s.length-7;const sum=[...s].reduce((n,c)=>{n+=Number(c)*weight;weight=weight===2?9:weight-1;return n;},0);const mod=sum%11;return mod<2?0:11-mod;};
  return check(id.slice(0,12))===Number(id[12])&&check(id.slice(0,13))===Number(id[13]);
}
export function stableDigest(rows:{personId:number;raw:unknown}[]):string {
  const keys=rows.map(({personId,raw})=>canonical({personId,raw})).sort();
  for(let i=1;i<keys.length;i++)if(keys[i]===keys[i-1])throw new Error('Linhas idênticas ambíguas: não deduplicar nem publicar automaticamente');
  return hash(keys.join('\n'));
}
