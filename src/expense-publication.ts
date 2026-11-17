import {UFS,canonical,hash,snapshotId} from './model.ts';
import type {Expense,Person,Snapshot} from './model.ts';
import type {ExpenseBatch} from './expense-intermediate.ts';
import type {HistoryReport} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';
import {readPublication} from './publications.ts';
import type {DB} from './store.ts';

export type ExpenseLotRun={runId:string;manifest:{runId:string;status:string;reportSha256:string;proposalSha256:string;inputSha256:string};input:{schema:string;proposal:any;temporal:TemporalReport};report:ExpenseBatch;audit:{status:string;reportSha256:string;proposalSha256:string;checkedAt:string;competences:number}};

const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
// The party the legislature's own events agree on; if they disagree, the latest one up to the end of the scope, and only when every date is readable.
function partyFromEvents(events:{original:{siglaPartido?:string|null;dataHora?:string|null}}[],end:string):{value:string;note:string}|null{
  const all=events.map(e=>({party:e.original.siglaPartido?.trim()||null,at:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.original.dataHora??'')?e.original.dataHora!.slice(0,16):null}));
  if(!all.length||all.some(e=>!e.party))return null;
  const parties=new Set(all.map(e=>e.party));
  if(parties.size===1)return {value:all[0].party!,note:'partido dos eventos da legislatura'};
  if(all.some(e=>!e.at))return null;
  const upto=all.filter(e=>e.at!<=end+'T23:59').sort((a,b)=>a.at!.localeCompare(b.at!));
  if(!upto.length)return null;
  if(upto.length>1&&upto.at(-2)!.at===upto.at(-1)!.at&&upto.at(-2)!.party!==upto.at(-1)!.party)return null;
  let i=upto.length-1;while(i>0&&upto[i-1].party===upto[i].party)i--;
  return {value:upto[i].party!,note:`último partido nos eventos (desde ${MONTHS[Number(upto[i].at!.slice(5,7))-1]}/${upto[i].at!.slice(0,4)})`};
}

// Only audited lots of one universe, all of them, each once: a missing or repeated lot would silently change the totals.
export function buildExpenseVersion(lots:ExpenseLotRun[],history:HistoryReport,now:string):Snapshot{
  if(!lots.length)throw Error('Nenhum lote informado');
  for(const l of lots){
    const reportSha=hash(canonical(l.report));
    if(l.input.schema!=='clareia.expense-lot-input.v1'||l.manifest.runId!==l.runId||l.manifest.status!=='review-required')throw Error(`Lote ${l.runId} não é uma coleta por lote concluída`);
    if(l.audit.status!=='passed'||l.audit.reportSha256!==reportSha||l.manifest.reportSha256!==reportSha)throw Error(`Lote ${l.runId} sem auditoria aprovada do mesmo relatório`);
    if(hash(canonical(l.input))!==l.manifest.inputSha256||hash(canonical(l.input.proposal))!==l.manifest.proposalSha256||l.audit.proposalSha256!==l.manifest.proposalSha256||l.report.proposalSha256!==l.manifest.proposalSha256)throw Error(`Lote ${l.runId} com seleção divergente`);
  }
  const first=lots[0].input.proposal,same=(key:string)=>lots.every(l=>canonical(l.input.proposal[key])===canonical(first[key]));
  if(!['year','months','lotSize','lots','universeSize','universeSha256','temporalSha256','crosscheckSha256'].every(same))throw Error('Lotes de universos ou versões diferentes');
  const numbers=lots.map(l=>l.input.proposal.lot).sort((a:number,b:number)=>a-b);
  if(canonical(numbers)!==canonical(Array.from({length:first.lots},(_,i)=>i)))throw Error(`Lotes incompletos ou repetidos: ${numbers.join(', ')} de ${first.lots}`);
  const ordered=[...lots].sort((a,b)=>a.input.proposal.lot-b.input.proposal.lot),ids=ordered.flatMap(l=>l.report.scope.ids);
  if(new Set(ids).size!==ids.length||ids.length!==first.universeSize||hash(canonical([...ids].sort((a,b)=>a-b)))!==first.universeSha256)throw Error('Pessoas dos lotes não formam o universo declarado');
  const temporal=ordered[0].input.temporal;
  if(hash(canonical(temporal))!==first.temporalSha256||temporal.historySha256!==hash(canonical(history)))throw Error('Histórico de pessoas diverge do usado na coleta');
  const records:Expense[]=[],heldMonths:Record<string,number>={},heldCompetences:{personId:number;month:number;reasons:string[]}[]=[];let cellTotal=0n;
  for(const l of ordered)for(const c of l.report.cells){
    if(c.status==='complete'||c.status==='no-expenses-confirmed'){
      if(c.status==='no-expenses-confirmed'&&c.records.length)throw Error('Célula sem despesas com registros');
      records.push(...c.records);cellTotal+=BigInt(c.totalCents??0);
    }else if(c.status==='held-review'||c.status==='source-failure'){if(c.records.length)throw Error('Célula retida com registros');heldMonths[c.personId]=(heldMonths[c.personId]??0)+1;heldCompetences.push({personId:c.personId,month:c.month,reasons:[...c.reasons].sort()});}
    else throw Error('Situação de célula desconhecida');
  }
  const total=records.reduce((n,r)=>n+BigInt(r.cents),0n);
  if(total!==cellTotal||!Number.isSafeInteger(Number(total)))throw Error('Soma dos registros diverge das células auditadas');
  const people:Person[]=ids.map(id=>{
    const h=history.people.find(p=>p.id===id),t=temporal.people.find(p=>p.id===id);
    if(!h?.profile||!t)throw Error(`Cadastro ausente para ${id}`);
    // The UF is fixed for the legislature, so any confirmed month serves. Without one, the UF the legislature's own events all agree on stands, marked; a month showing two UFs (changed/conflict) is never settled this way.
    const months=[...t.months].reverse(),temporalUf=months.find(m=>m.uf.status==='single')?.uf.value??null,contested=months.some(m=>m.uf.status==='changed'||m.uf.status==='conflict');
    const eventUfs=new Set(t.events.filter(e=>e.original.idLegislatura===temporal.scope.legislature).map(e=>e.original.siglaUf)),only=eventUfs.size===1?[...eventUfs][0]:null;
    const fallback=temporalUf===null&&!contested&&only&&UFS.has(only)?only:null,uf=temporalUf??fallback,confirmed=months.find(m=>m.year===first.year&&m.party.status==='single')?.party.value??null,eventParty=confirmed===null?partyFromEvents(t.events.filter(e=>e.original.idLegislatura===temporal.scope.legislature),temporal.scope.end):null,party=confirmed??eventParty?.value??null;
    return {id,name:h.profile.name,photo:h.profile.photo,sourceUrl:'https://www.camara.leg.br/deputados/'+id,profileFetchedAt:h.profile.source.fetchedAt,uf,...(fallback?{ufNote:'UF dos eventos da legislatura'}:{}),party,...(eventParty?{partyNote:eventParty.note}:{})};
  });
  const collectedAt=ordered.map(l=>l.report.createdAt).sort().at(-1)!;
  const body={metric:'camara.ceap.valor-liquido-uniao-fontes.v1',scope:{year:first.year,months:first.months,ids,legislature:temporal.scope.legislature},people,records,collectedAt,publishedAt:now,pages:[],
    validation:{sourceKind:'annual-api-union',stablePasses:2,recordCount:records.length,totalCents:Number(total),independentTotalCents:String(cellTotal),duplicatePolicy:'Documento não é chave. Ocorrências do CSV preservadas; conteúdo idêntico ambíguo retém a competência.',limitations:['Competências retidas para revisão ficam fora dos totais e são indicadas por deputado.'],heldMonths,heldCompetences:heldCompetences.sort((a,b)=>a.personId-b.personId||a.month-b.month),lots:ordered.map(l=>({runId:l.runId,lot:l.input.proposal.lot,reportSha256:l.manifest.reportSha256,contentSha256:l.report.contentSha256,auditCheckedAt:l.audit.checkedAt}))}};
  return {...body,id:snapshotId(body)};
}
// Re-reads what the database now holds; the lot audits already re-derived every competence from the sealed originals.
export async function auditExpenseVersion(db:DB,version:Snapshot,lots:ExpenseLotRun[]){
  const stored=await readPublication(db,version.id),failures:string[]=[];
  if(!stored)failures.push('not-stored');
  else{
    if(snapshotId(stored)!==version.id)failures.push('content-id');
    if(stored.records.length!==version.validation.recordCount)failures.push('record-count');
    if(String(stored.records.reduce((n,r)=>n+BigInt(r.cents),0n))!==version.validation.independentTotalCents)failures.push('total');
  }
  return {checkedAt:new Date().toISOString(),status:failures.length?'failed' as const:'passed' as const,failures,lots:lots.length,competences:lots.reduce((n,l)=>n+l.audit.competences,0),selected:version.records.length};
}
