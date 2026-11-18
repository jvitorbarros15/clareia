import {UFS,canonical,hash,snapshotId} from './model.ts';
import type {DuplicateReason,Expense,Person,Snapshot} from './model.ts';
import type {ExpenseBatch} from './expense-intermediate.ts';
import type {HistoryReport} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';
import {readPublication} from './publications.ts';
import type {DB} from './store.ts';

export type ExpenseLotRun={runId:string;manifest:{runId:string;status:string;reportSha256:string;proposalSha256:string;inputSha256:string};input:{schema:string;proposal:any;temporal:TemporalReport};report:ExpenseBatch;audit:{status:string;reportSha256:string;proposalSha256:string;checkedAt:string;competences:number}};

const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
// Parties that ceased to exist in 2023, the party that succeeded them and the day the TSE approved it (Câmara events keep the old label afterwards).
const MERGERS:Record<string,{to:string;on:string}>={PATRIOTA:{to:'PRD',on:'2023-11-09'},PTB:{to:'PRD',on:'2023-11-09'},PSC:{to:'PODE',on:'2023-06-15'},PROS:{to:'SOLIDARIEDADE',on:'2023-02-14'}};
const monthYear=(day:string)=>`${MONTHS[Number(day.slice(5,7))-1]}/${day.slice(0,4)}`;
type PartyEvent={time:string|null;original:{idLegislatura:number;siglaPartido?:string|null}};
// The party the legislature's own events give for the expense period: only events up to the period's last day count, so a later switch never leaks in. Without a party, note says why.
export function partyFromEvents(events:PartyEvent[],legislature:number,start:string,end:string):{value:string|null;note:string}{
  const none=(note:string)=>({value:null,note});
  if(events.some(e=>e.original.idLegislatura!==legislature&&e.time&&e.time>=start&&e.time<=end+'T23:59:59'))return none('evento de outra legislatura dentro do período');
  const own=events.filter(e=>e.original.idLegislatura===legislature);
  if(own.some(e=>!e.time))return none('evento sem data válida');
  const upto=own.filter(e=>e.time!<=end+'T23:59:59').sort((a,b)=>a.time!.localeCompare(b.time!));
  if(!upto.length)return none('sem eventos até o fim do período');
  if(upto.some(e=>!e.original.siglaPartido?.trim()))return none('evento sem partido');
  const party=(e:PartyEvent)=>e.original.siglaPartido!.trim(),last=upto.at(-1)!,day=last.time!.slice(0,10);
  if(new Set(upto.filter(e=>e.time===last.time).map(party)).size>1)return none('eventos de partidos diferentes no mesmo instante');
  const merger=MERGERS[party(last)];
  if(merger&&merger.on<=end)return {value:merger.to,note:`${party(last)} registrado em ${monthYear(day)}; partido extinto, sucedido pelo ${merger.to} (${monthYear(merger.on)})`};
  const agree=new Set(upto.map(party)).size===1&&day>=start;
  return {value:party(last),note:agree?'partido dos eventos da legislatura':`partido registrado em ${monthYear(day)}, nos eventos da legislatura`};
}
export const SIGN_NOTE='sinal corrigido conforme a página da Câmara';
export const SIGN_CATEGORIES=['COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA','PASSAGEM AÉREA - MISSÃO OFICIAL'];
// The source reports document > 0, no glosa and net = -document; the Câmara's own pages count it as positive. Only this shape in the two listed categories is flipped (the signed source net stays in sourceCents); the same shape elsewhere stops the build for a human decision.
export const fixSign=(r:Expense):Expense=>{
  if(r.financialBasis||r.documentCents===null||r.documentCents<=0||r.disallowedCents!==null||r.cents!==-r.documentCents)return r;
  if(!SIGN_CATEGORIES.includes(r.category))throw Error(`Sinal invertido em categoria não prevista (${r.category}): decisão necessária antes de publicar`);
  return {...r,cents:r.documentCents,sourceCents:r.cents,note:SIGN_NOTE};
};

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
  const periodStart=`${first.year}-${String(Math.min(...first.months)).padStart(2,'0')}-01`,lastMonth=Math.max(...first.months),periodEnd=new Date(Date.UTC(first.year,lastMonth,0)).toISOString().slice(0,10);
  const records:Expense[]=[],heldMonths:Record<string,number>={},heldCompetences:{personId:number;month:number;reasons:string[]}[]=[],duplicateCompetences:{personId:number;month:number;reason:DuplicateReason}[]=[];let cellTotal=0n,fixCount=0,fixDelta=0n;
  for(const l of ordered)for(const c of l.report.cells){
    if(c.status==='complete'||c.status==='no-expenses-confirmed'){
      if(c.status==='no-expenses-confirmed'&&c.records.length)throw Error('Célula sem despesas com registros');
      const fixed=c.records.map(fixSign);records.push(...fixed);cellTotal+=BigInt(c.totalCents??0);for(const r of fixed)if(r.sourceCents!==undefined){fixCount++;fixDelta+=BigInt(r.cents-r.sourceCents);}
      if(c.duplicateReason)duplicateCompetences.push({personId:c.personId,month:c.month,reason:c.duplicateReason});
    }else if(c.status==='held-review'||c.status==='source-failure'){if(c.records.length)throw Error('Célula retida com registros');heldMonths[c.personId]=(heldMonths[c.personId]??0)+1;heldCompetences.push({personId:c.personId,month:c.month,reasons:[...c.reasons].sort()});}
    else throw Error('Situação de célula desconhecida');
  }
  const total=records.reduce((n,r)=>n+BigInt(r.cents),0n);
  if(total!==cellTotal+fixDelta||!Number.isSafeInteger(Number(total)))throw Error('Soma dos registros diverge das células auditadas');
  const people:Person[]=ids.map(id=>{
    const h=history.people.find(p=>p.id===id),t=temporal.people.find(p=>p.id===id);
    if(!h?.profile||!t)throw Error(`Cadastro ausente para ${id}`);
    // The UF is fixed for the legislature, so any confirmed month serves. Without one, the UF the legislature's own events all agree on stands, marked; a month showing two UFs (changed/conflict) is never settled this way.
    const months=[...t.months].reverse(),temporalUf=months.find(m=>m.uf.status==='single')?.uf.value??null,contested=months.some(m=>m.uf.status==='changed'||m.uf.status==='conflict');
    const eventUfs=new Set(t.events.filter(e=>e.original.idLegislatura===temporal.scope.legislature).map(e=>e.original.siglaUf)),only=eventUfs.size===1?[...eventUfs][0]:null;
    const fallback=temporalUf===null&&!contested&&only&&UFS.has(only)?only:null,uf=temporalUf??fallback,confirmed=months.find(m=>m.year===first.year&&m.party.status==='single')?.party.value??null,partyContested=months.some(m=>m.year===first.year&&(m.party.status==='changed'||m.party.status==='conflict')),eventParty=confirmed!==null?null:partyContested?{value:null,note:'mês do ano com partido em disputa'}:partyFromEvents(t.events,temporal.scope.legislature,periodStart,periodEnd),party=confirmed??eventParty?.value??null;
    return {id,name:h.profile.name,photo:h.profile.photo,sourceUrl:'https://www.camara.leg.br/deputados/'+id,profileFetchedAt:h.profile.source.fetchedAt,uf,...(fallback?{ufNote:'UF dos eventos da legislatura'}:{}),party,...(eventParty?{partyNote:eventParty.note}:{})};
  });
  const collectedAt=ordered.map(l=>l.report.createdAt).sort().at(-1)!;
  const body={metric:'camara.ceap.valor-liquido-uniao-fontes.v1',scope:{year:first.year,months:first.months,ids,legislature:temporal.scope.legislature},people,records,collectedAt,publishedAt:now,pages:[],
    validation:{sourceKind:'annual-api-union',stablePasses:2,recordCount:records.length,totalCents:Number(total),independentTotalCents:String(cellTotal+fixDelta),signFix:{count:fixCount,deltaCents:Number(fixDelta)},duplicatePolicy:'Documento não é chave. Ocorrências do CSV preservadas; linhas repetidas são publicadas, como a Câmara as conta, e sinalizadas como possível duplicidade.',limitations:['Competências retidas para revisão ficam fora dos totais e são indicadas por deputado.'],heldMonths,heldCompetences:heldCompetences.sort((a,b)=>a.personId-b.personId||a.month-b.month),duplicateCompetences:duplicateCompetences.sort((a,b)=>a.personId-b.personId||a.month-b.month),lots:ordered.map(l=>({runId:l.runId,lot:l.input.proposal.lot,reportSha256:l.manifest.reportSha256,contentSha256:l.report.contentSha256,auditCheckedAt:l.audit.checkedAt}))}};
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
    // The sign rule is written again here on purpose: a bug in fixSign must not pass its own check.
    const cells=lots.flatMap(l=>l.report.cells).filter(c=>c.status==='complete'||c.status==='no-expenses-confirmed'),allowed=['COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA','PASSAGEM AÉREA - MISSÃO OFICIAL'];
    let source=0n,count=0,delta=0n,bad=false;
    for(const r of stored.records){
      const d=r.documentCents,shape=d!==null&&d>0&&r.disallowedCents===null&&!r.financialBasis;
      if(r.sourceCents===undefined){source+=BigInt(r.cents);if(shape&&r.cents===-d)bad=true;}
      else{source+=BigInt(r.sourceCents);count++;delta+=BigInt(r.cents-r.sourceCents);if(!shape||r.sourceCents!==-d||r.cents!==d||r.note!==SIGN_NOTE||!allowed.includes(r.category))bad=true;}
    }
    const fix=version.validation.signFix;
    if(source!==cells.reduce((n,c)=>n+BigInt(c.totalCents??0),0n))failures.push('audited-total');
    if(bad||count!==fix?.count||Number(delta)!==fix?.deltaCents)failures.push('sign-correction');
  }
  return {checkedAt:new Date().toISOString(),status:failures.length?'failed' as const:'passed' as const,failures,lots:lots.length,competences:lots.reduce((n,l)=>n+l.audit.competences,0),selected:version.records.length};
}
