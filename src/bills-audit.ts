import {parse} from 'csv-parse/sync';
import {canonical,hash} from './model.ts';
import {billAuthorsUrl,billsContentId,billsUrl} from './bills.ts';
import type {BillsReport,BillSource} from './bills.ts';

// Rereads the preserved files by another path. It shares the rules and the author with
// the collector, so it detects implementation differences, not a wrong rule.
export async function auditBills(report:BillsReport,read:(source:BillSource)=>Promise<Uint8Array>):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string}>{
  const failures:string[]=[];
  if(report.status!=='review-required'||report.publicationEligible!==false)failures.push('publication-gate');
  if(billsContentId(report)!==report.contentSha256)failures.push('content-id');
  const source=(url:string)=>report.sources.filter(s=>s.url===url).sort((a,b)=>(a.pass??0)-(b.pass??0)).at(-1),table=async(url:string)=>{
    const s=source(url);if(!s){failures.push('missing-source');return [] as Record<string,string>[];}
    const bytes=await read(s);if(hash(bytes)!==s.sha256||bytes.length!==s.bytes){failures.push('source-hash');return [] as Record<string,string>[];}
    return parse(Buffer.from(bytes),{delimiter:';',bom:true,columns:true,skip_empty_lines:true}) as Record<string,string>[];
  };
  const propositions=await table(billsUrl(report.year)),authorRows=await table(billAuthorsUrl(report.year));
  const wanted=propositions.filter(p=>report.types.includes(p.siglaTipo)),ids=new Set(propositions.map(p=>p.id)),byBill=new Map<string,Record<string,string>[]>();
  for(const a of authorRows){const list=byBill.get(a.idProposicao);if(list)list.push(a);else byBill.set(a.idProposicao,[a]);}
  const reported=new Map(report.bills.map(b=>[String(b.id),b])),proposed=new Map<number,number>(),coauthored=new Map<number,number>();
  if(reported.size!==wanted.length||report.metrics.selected!==wanted.length||report.metrics.propositions!==propositions.length)failures.push('bill-universe');
  if(report.metrics.orphanAuthorRows!==authorRows.filter(a=>!ids.has(a.idProposicao)).length)failures.push('orphan-author-rows');
  let held=0;
  for(const p of wanted){
    const bill=reported.get(p.id);if(!bill){failures.push('missing-bill-'+p.id);continue;}
    const rows=byBill.get(p.id)??[],deputies=rows.filter(a=>a.idDeputadoAutor!==''),expected=new Set<string>();
    if(!p.dataApresentacao.startsWith(String(report.year)))expected.add('year-date-mismatch');
    if(!rows.length)expected.add('no-author-rows');
    if(deputies.some(a=>!/^[1-9][0-9]*$/.test(a.idDeputadoAutor)||a.uriAutor.split('/').at(-1)!==a.idDeputadoAutor||a.uriAutor.split('/').at(-2)!=='deputados'))expected.add('author-identity-mismatch');
    if(deputies.some(a=>!['0','1'].includes(a.proponente)))expected.add('invalid-author-flag');
    if(new Set(deputies.map(a=>a.idDeputadoAutor)).size!==deputies.length)expected.add('repeated-author-row');
    if(canonical([...expected].sort())!==canonical(bill.issues))failures.push('issues-'+p.id);
    if(bill.situation!==(p.ultimoStatus_descricaoSituacao||null)||bill.summary!==p.ementa||bill.type!==p.siglaTipo)failures.push('fields-'+p.id);
    if(expected.size){held++;continue;}
    if(bill.otherAuthors!==rows.length-deputies.length||canonical(bill.authors.map(a=>[a.deputyId,a.proponent]))!==canonical(deputies.map(a=>[Number(a.idDeputadoAutor),a.proponente==='1']).sort((x,y)=>Number(x[0])-Number(y[0]))))failures.push('authors-'+p.id);
    for(const a of deputies){const id=Number(a.idDeputadoAutor),target=a.proponente==='1'?proposed:coauthored;target.set(id,(target.get(id)??0)+1);}
  }
  if(report.metrics.held!==held)failures.push('held-count');
  const everyone=[...new Set([...proposed.keys(),...coauthored.keys()])].sort((a,b)=>a-b).map(id=>({id,proposed:proposed.get(id)??0,coauthored:coauthored.get(id)??0}));
  if(canonical(everyone)!==canonical(report.people))failures.push('person-counts');
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString()};
}
