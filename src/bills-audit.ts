import {parse} from 'csv-parse/sync';
import {canonical,hash} from './model.ts';
import {billAuthorsUrl,billsContentId,billsUrl,billTramitacoesUrl} from './bills.ts';
import type {BillsReport,BillSource} from './bills.ts';

// Rereads the preserved files by another path. It shares the rules and the author with
// the collector, so it detects implementation differences, not a wrong rule.
export async function auditBills(report:BillsReport,read:(source:BillSource)=>Promise<Uint8Array>):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string;contentSha256:string}>{
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
  const reported=new Map(report.bills.map(b=>[String(b.id),b])),proposed=new Map<number,number>(),coauthored=new Map<number,number>(),joint=new Map<number,number>(),norms=new Map<number,number>();
  const expectedKind:Record<string,string>={PL:'lei ordinária',PLP:'lei complementar',PEC:'emenda constitucional'};
  const normOf=async(id:string,type:string)=>{
    const s=source(billTramitacoesUrl(Number(id)));if(!s){failures.push('missing-tramitacao-'+id);return null;}
    const bytes=await read(s);if(hash(bytes)!==s.sha256){failures.push('source-hash');return null;}
    const seen=new Set<string>();let anchored=false;
    for(const e of JSON.parse(Buffer.from(bytes).toString()).dados as Record<string,string|null>[])for(const field of ['despacho','descricaoTramitacao']){
      const text=(e[field]??'').toLowerCase(),at=text.indexOf('transformad');
      for(const kind of ['lei ordinária','lei ordinaria','lei complementar','emenda constitucional'])for(let p=text.indexOf(kind,at);p>=0;p=text.indexOf(kind,p+1)){const tail=text.slice(p+kind.length).replace(/^[\sn.º°o]*/,'').split(/\s/)[0].replace(/[^0-9/.]/g,'').replace(/\.+$/,'');const [n,y]=tail.split('/');if(n&&y&&y.length===4){if(at>=0&&p>at&&p-at<=20)anchored=true;seen.add(JSON.stringify([kind.replace('ordinaria','ordinária'),n.replace(/\./g,''),Number(y)]));}}
    }
    if(seen.size!==1||!anchored)return null;const [kind,number,year]=JSON.parse([...seen][0]) as [string,string,number];return kind===expectedKind[type]&&year>=report.year?{kind,number,year}:null;
  };
  if(reported.size!==wanted.length||report.metrics.selected!==wanted.length||report.metrics.propositions!==propositions.length)failures.push('bill-universe');
  if(report.metrics.orphanAuthorRows!==authorRows.filter(a=>!ids.has(a.idProposicao)).length)failures.push('orphan-author-rows');
  let held=0,resolved=0,unresolved=0;
  for(const p of wanted){
    const bill=reported.get(p.id);if(!bill){failures.push('missing-bill-'+p.id);continue;}
    const rows=byBill.get(p.id)??[],deputies=rows.filter(a=>a.idDeputadoAutor!==''),expected=new Set<string>();
    if(!p.dataApresentacao.startsWith(String(report.year)))expected.add('year-date-mismatch');
    if(!rows.length)expected.add('no-author-rows');
    if(deputies.some(a=>!/^[1-9][0-9]*$/.test(a.idDeputadoAutor)||a.uriAutor.split('/').at(-1)!==a.idDeputadoAutor||a.uriAutor.split('/').at(-2)!=='deputados'))expected.add('author-identity-mismatch');
    if(deputies.some(a=>!['0','1'].includes(a.proponente)))expected.add('invalid-author-flag');
    if(new Set(deputies.map(a=>a.idDeputadoAutor)).size!==deputies.length)expected.add('repeated-author-row');
    if(canonical([...expected].sort())!==canonical(bill.issues))failures.push('issues-'+p.id);
    if(bill.situation!==(p.ultimoStatus_descricaoSituacao||null)||bill.summary!==p.ementa.replace(/(?<![0-9.])[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}(?![0-9])/g,'[CPF omitido]')||bill.type!==p.siglaTipo)failures.push('fields-'+p.id);
    const isNorm=p.ultimoStatus_descricaoSituacao==='Transformado em Norma Jurídica',norm=isNorm?await normOf(p.id,p.siglaTipo):null;
    if(bill.normStatus!==(isNorm?norm?'resolved':'unresolved':'none')||(norm&&(bill.norm?.number!==norm.number||bill.norm.year!==norm.year||bill.norm.kind.toLowerCase()!==norm.kind)))failures.push('norm-'+p.id);
    if(!isNorm&&bill.norm)failures.push('norm-'+p.id);
    if(norm)resolved++;else if(isNorm)unresolved++;
    if(expected.size){held++;continue;}
    if(bill.otherAuthors!==rows.length-deputies.length||bill.otherProponents!==rows.filter(a=>a.idDeputadoAutor===''&&a.proponente==='1').length||canonical(bill.authors.map(a=>[a.deputyId,a.proponent]))!==canonical(deputies.map(a=>[Number(a.idDeputadoAutor),a.proponente==='1']).sort((x,y)=>Number(x[0])-Number(y[0]))))failures.push('authors-'+p.id);
    const many=rows.filter(a=>a.proponente==='1').length>1;
    for(const a of deputies){const id=Number(a.idDeputadoAutor),target=a.proponente==='1'?proposed:coauthored,bump=(m:Map<number,number>)=>m.set(id,(m.get(id)??0)+1);bump(target);if(a.proponente==='1'&&many)bump(joint);if(a.proponente==='1'&&norm)bump(norms);}
  }
  if(report.metrics.held!==held)failures.push('held-count');
  if(report.metrics.normsResolved!==resolved||report.metrics.normsUnresolved!==unresolved)failures.push('norm-counts');
  const everyone=[...new Set([...proposed.keys(),...coauthored.keys()])].sort((a,b)=>a-b).map(id=>({id,proposed:proposed.get(id)??0,joint:joint.get(id)??0,coauthored:coauthored.get(id)??0,norms:norms.get(id)??0}));
  if(canonical(everyone)!==canonical(report.people))failures.push('person-counts');
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString(),contentSha256:report.contentSha256};
}
