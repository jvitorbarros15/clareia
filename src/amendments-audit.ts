import {parse} from 'csv-parse/sync';
import {canonical,hash} from './model.ts';
import {amendmentsContentId,amendmentsCsv,AMENDMENTS_URL} from './amendments.ts';
import type {AmendmentsReport,AmendmentSource} from './amendments.ts';

const FIELDS=[['committed','Valor Empenhado'],['liquidated','Valor Liquidado'],['paid','Valor Pago'],['carriedOver','Valor Restos A Pagar Inscritos'],['carriedCancelled','Valor Restos A Pagar Cancelados'],['carriedPaid','Valor Restos A Pagar Pagos']] as const;
const cents=(v:string)=>{const sign=v.startsWith('-')?-1n:1n,[a,b='']=v.replace('-','').split(',');return sign*(BigInt(a)*100n+BigInt((b+'00').slice(0,2)));};
// Recounts the preserved CSV by another path. Same rules and author as the collector.
export async function auditAmendments(report:AmendmentsReport,read:(s:AmendmentSource)=>Promise<Uint8Array>):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string;contentSha256:string}>{
  const failures:string[]=[];
  if(report.status!=='review-required'||report.publicationEligible!==false)failures.push('publication-gate');
  if(amendmentsContentId(report)!==report.contentSha256)failures.push('content-id');
  const source=report.sources.filter(s=>s.url===AMENDMENTS_URL).sort((a,b)=>(a.pass??0)-(b.pass??0)).at(-1);
  if(!source)return {status:'failed',failures:[...failures,'missing-source'],checkedAt:new Date().toISOString(),contentSha256:report.contentSha256};
  const bytes=await read(source);if(hash(bytes)!==source.sha256)failures.push('source-hash');
  const rows=parse(Buffer.from(new TextDecoder('latin1').decode(amendmentsCsv(bytes)),'utf8'),{delimiter:';',columns:true,skip_empty_lines:true}) as Record<string,string>[];
  const tally=new Map<string,bigint[]>(),bump=(key:string,r:Record<string,string>)=>{const t=tally.get(key)??Array(7).fill(0n) as bigint[];t[0]++;FIELDS.forEach(([,c],i)=>{t[i+1]+=cents(r[c]);});tally.set(key,t);};
  let selected=0,individual=0;
  for(const r of rows){
    if(Number(r['Ano da Emenda'])<report.fromYear)continue;selected++;
    const type=r['Tipo de Emenda'],code=r['Código do Autor da Emenda'].trim();
    if(!type.startsWith('Emenda Individual')){bump('x|'+type,r);continue;}
    individual++;
    if(['','S/I','-99'].includes(code))bump('x|Emenda individual sem autor identificado',r);else bump('a|'+code+'|'+r['Ano da Emenda'],r);
  }
  if(report.metrics.rows!==rows.length||report.metrics.selected!==selected||report.metrics.individual!==individual)failures.push('row-counts');
  const shown=new Map<string,bigint[]>(),put=(key:string,t:Record<string,number>)=>shown.set(key,[BigInt(t.rows),...FIELDS.map(([m])=>BigInt(t[m]))]);
  for(const a of report.authors)for(const [y,t] of Object.entries(a.years))put('a|'+a.code+'|'+y,t);
  for(const [type,t] of Object.entries(report.excluded))put('x|'+type,t);
  const flat=(m:Map<string,bigint[]>)=>canonical([...m].map(([k,v])=>[k,v.map(String)]).sort(([a],[b])=>String(a).localeCompare(String(b))));
  if(flat(tally)!==flat(shown))failures.push('totals');
  if(report.links.some(l=>l.status==='proposed'&&l.candidates.length!==1)||report.links.length!==report.authors.length)failures.push('links');
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString(),contentSha256:report.contentSha256};
}
