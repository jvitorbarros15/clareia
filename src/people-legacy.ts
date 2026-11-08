import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {canonical,hash} from './model.ts';
import {findCpfs} from './cpf-scan.ts';
import {PeopleCapture} from './people-discovery.ts';
import type {Capture,DiscoveryReport} from './people-discovery.ts';
import type {HistoryReport} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';

export const LEGACY='https://www.camara.leg.br/SitCamaraWS/Deputados.asmx/ObterDetalhesDeputado';
export const legacyUrl=(id:number,legislature:number)=>`${LEGACY}?ideCadastro=${id}&numLegislatura=${legislature}`;
export const periodFields=['siglaUFRepresentacao','situacaoExercicio','dataInicio','dataFim','idCausaFimExercicio','descricaoCausaFimExercicio','idCadastroParlamentarAnterior'] as const;
export const affiliationFields=['idPartidoAnterior','siglaPartidoAnterior','nomePartidoAnterior','idPartidoPosterior','siglaPartidoPosterior','nomePartidoPosterior','dataFiliacaoPartidoPosterior','horaFiliacaoPartidoPosterior'] as const;
export type LegacyPeriod=Record<typeof periodFields[number],string>;
export type LegacyAffiliation=Record<typeof affiliationFields[number],string>;
export type LegacyProjection={id:number;legislature:number;periods:LegacyPeriod[];affiliations:LegacyAffiliation[]};
export type LegacySource=Capture&{pass:1|2};
export type LegacyPerson={id:number;status:'stable'|'changed'|'failed';first:LegacyProjection|null;second:LegacyProjection|null;sources:LegacySource[];issues:string[]};
export type LegacyReport={schema:'clareia.people-legacy.v1';discoverySha256:string;historySha256:string;scope:HistoryReport['scope'];createdAt:string;status:'review-required';publicAttributionEnabled:false;people:LegacyPerson[];sources:LegacySource[]};

// Shared syntax boundary only: projections and comparisons are independently
// checked by people-legacy-audit. No DTDs, custom entities or external resources.
export function safeLegacyXml(bytes:Uint8Array):Record<string,any>{
  try{
    if(bytes.length>12_000_000)throw Error();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)||/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(text)||XMLValidator.validate(text)!==true)throw Error();
    return new XMLParser({parseTagValue:false,parseAttributeValue:false,ignoreAttributes:false,trimValues:true,ignoreDeclaration:true,ignorePiTags:false,processEntities:true,htmlEntities:false}).parse(text);
  }catch{throw new Error('XML histórico inválido ou não permitido');}
}
export function legacyDay(value:string):string|null{
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!m)return null;
  const iso=`${m[3]}-${m[2]}-${m[1]}`,date=new Date(iso+'T00:00:00Z');
  return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===iso?iso:null;
}
function rows<T extends string>(container:unknown,item:string,fields:readonly T[],optional:readonly T[]=[]):Record<T,string>[] {
  if(container==='')return [];
  if(!container||typeof container!=='object'||Array.isArray(container)||Object.keys(container).some(k=>k!==item))throw Error('Bloco histórico mudou');
  const raw=(container as Record<string,unknown>)[item];if(!raw)throw Error('Bloco histórico ausente');
  return (Array.isArray(raw)?raw:[raw]).map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!fields.includes(k as T)))throw Error('Campos históricos mudaram');
    return Object.fromEntries(fields.map(field=>{const value=row[field];if(value===undefined&&optional.includes(field))return [field,''];if(typeof value!=='string')throw Error('Campo histórico incompatível');return [field,value.trim()];})) as Record<T,string>;
  });
}
export function inspectLegacy(id:number,legislature:number,bytes:Uint8Array):LegacyProjection{
  const doc=safeLegacyXml(bytes),envelope=doc.Deputados;
  if(Object.keys(doc).length!==1||!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).some(k=>k!=='Deputado'))throw Error('Envelope histórico mudou');
  const row=envelope.Deputado;
  if(!row||Array.isArray(row)||row.ideCadastro!==String(id)||row.numLegislatura!==String(legislature))throw Error('Identidade histórica incompatível');
  const periods=rows(row.periodosExercicio,'periodoExercicio',periodFields);
  const affiliations=rows(row.filiacoesPartidarias,'filiacaoPartidaria',affiliationFields,['horaFiliacaoPartidoPosterior']);
  for(const p of periods){const start=legacyDay(p.dataInicio),end=legacyDay(p.dataFim);if(!start||p.dataFim&&!end||end&&end<start)throw Error('Datas do exercício inválidas');if(!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(p.siglaUFRepresentacao))throw Error('UF não contratada');}
  for(const p of affiliations)if(!legacyDay(p.dataFiliacaoPartidoPosterior)||p.horaFiliacaoPartidoPosterior&&!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(p.horaFiliacaoPartidoPosterior)||!p.siglaPartidoAnterior||!p.siglaPartidoPosterior)throw Error('Filiação incompatível');
  return {id,legislature,periods,affiliations};
}
const signature=(p:LegacyProjection)=>canonical({id:p.id,legislature:p.legislature,periods:p.periods.map(canonical).sort(),affiliations:p.affiliations.map(canonical).sort()});
export async function collectLegacy(discovery:DiscoveryReport,history:HistoryReport,one:PeopleCapture,two:PeopleCapture,options:{workers?:number;wait?:(ms:number)=>Promise<void>;progress?:(pass:number,done:number,total:number)=>void}={}):Promise<LegacyReport>{
  const ids=discovery.candidates.map(p=>p.id);
  if(history.discoverySha256!==hash(canonical(discovery))||canonical(history.scope)!==canonical(discovery.scope)||canonical([...history.people.map(p=>p.id)].sort((a,b)=>a-b))!==canonical([...ids].sort((a,b)=>a-b))||!ids.length||new Set(ids).size!==ids.length)throw Error('Universo histórico incompatível');
  const workers=options.workers??2;if(!Number.isInteger(workers)||workers<1||workers>3)throw Error('Concorrência inválida');
  const people=ids.map<LegacyPerson>(id=>({id,status:'failed',first:null,second:null,sources:[],issues:[]})),known=new Set<string>();
  for(const [index,capture] of [one,two].entries()){
    const pass=(index+1) as 1|2;let cursor=0,done=0;
    await Promise.all(Array.from({length:workers},async()=>{while(cursor<people.length){
      const p=people[cursor++];try{
        const {bytes,source}=await capture.get(legacyUrl(p.id,history.scope.legislature));p.sources.push({...source,pass});
        // Private identifiers are hashed in memory, never copied to the report.
        const raw=safeLegacyXml(bytes).Deputados?.Deputado;
        for(const field of ['cpf','CPF'])if(typeof raw?.[field]==='string'){const digits=raw[field].replace(/\D/g,'');if(digits.length===11)known.add(hash(digits));}
        const normalized=inspectLegacy(p.id,history.scope.legislature,bytes);if(pass===1)p.first=normalized;else p.second=normalized;
      }catch{p.issues.push(`capture-or-contract-failure-pass-${pass}`);}
      done++;options.progress?.(pass,done,ids.length);await (options.wait??(ms=>new Promise(r=>setTimeout(r,ms))))(150);
    }}));
  }
  for(const p of people){p.status=p.first&&p.second?signature(p.first)===signature(p.second)?'stable':'changed':'failed';if(p.status==='changed')p.issues.push('legacy-changed-between-passes');if(p.first?.periods.some(period=>!['Titular','Suplente'].includes(period.situacaoExercicio)))p.issues.push('unconfirmed-exercise-kind');}
  const report:LegacyReport={schema:'clareia.people-legacy.v1',discoverySha256:hash(canonical(discovery)),historySha256:hash(canonical(history)),scope:history.scope,createdAt:new Date().toISOString(),status:'review-required',publicAttributionEnabled:false,people,sources:[...one.captures.map(s=>({...s,pass:1 as const})),...two.captures.map(s=>({...s,pass:2 as const}))]};
  if(findCpfs(JSON.stringify(report),known))throw Error('Identificador privado no relatório legado');return report;
}

export type CrosscheckMonth={year:number;month:number;v2Exercise:string;legacy:'reported-exercise'|'boundary-only'|'no-listed-period'|'unknown';periodRows:number[];openEnd:boolean;comparison:'corroborating-unknown'|'potential-conflict'|'no-automatic-resolution'|'unavailable'};
export type CrosscheckParty={legacyRow:number|null;v2Row:number|null;day:string;before:string;after:string;status:'same-day-and-time'|'same-day-time-differs'|'same-day-time-unavailable'|'same-day-minute-precision'|'legacy-only-change'|'v2-only-change'};
export type CrosscheckReport={schema:'clareia.people-crosscheck.v1';legacySha256:string;temporalSha256:string;historySha256:string;discoverySha256:string;scope:HistoryReport['scope'];createdAt:string;status:'review-required';publicAttributionEnabled:false;dateSemantics:'boundary-days-and-open-ends-unconfirmed';people:{id:number;legacyStatus:LegacyPerson['status'];months:CrosscheckMonth[];partyComparisonStatus:'compared'|'unavailable';partyChanges:CrosscheckParty[]}[]};
const next=(day:string)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
export function compareLegacy(legacy:LegacyReport,history:HistoryReport,temporal:TemporalReport):CrosscheckReport{
  if(legacy.historySha256!==hash(canonical(history))||temporal.historySha256!==legacy.historySha256||canonical(legacy.scope)!==canonical(temporal.scope)||canonical(legacy.people.map(p=>p.id).sort((a,b)=>a-b))!==canonical(temporal.people.map(p=>p.id).sort((a,b)=>a-b)))throw Error('Versões incompatíveis para cruzamento');
  const people=temporal.people.map(person=>{
    const p=legacy.people.find(p=>p.id===person.id)!,data=p.status==='stable'?p.first:null;
    const months=person.months.map<CrosscheckMonth>(m=>{
      const start=m.start.slice(0,10),end=m.end.slice(0,10),periodRows:number[]=[];let interior=false,boundary=false,openEnd=false,uncertain=false;
      for(const [row,period] of (data?.periods??[]).entries()){
        const first=legacyDay(period.dataInicio)!,last=period.dataFim?legacyDay(period.dataFim)!:null;
        // Exclude whole boundary days from positive overlap, because the source
        // documentation does not specify inclusivity or a time of day.
        if(next(first)<end&&(!last||last>start&&next(first)<last)){periodRows.push(row);if(['Titular','Suplente'].includes(period.situacaoExercicio))interior=true;else uncertain=true;openEnd||=last===null;}
        else if(first>=start&&first<end||last&&last>=start&&last<end){periodRows.push(row);boundary=true;if(!['Titular','Suplente'].includes(period.situacaoExercicio))uncertain=true;}
      }
      const state=!data||uncertain?'unknown':interior?'reported-exercise':boundary?'boundary-only':'no-listed-period';
      return {year:m.year,month:m.month,v2Exercise:m.exercise,legacy:state,periodRows,openEnd,comparison:state==='unknown'?'unavailable':interior&&m.exercise==='unknown'?'corroborating-unknown':interior&&m.exercise==='outside'||state==='no-listed-period'&&(m.exercise==='full'||m.exercise==='partial')?'potential-conflict':'no-automatic-resolution'};
    });
    const partyComparisonStatus:'compared'|'unavailable'=data&&person.collectionStatus==='stable'&&!person.events.some(e=>e.disposition==='invalid-date'||e.disposition==='outside-legislature')?'compared':'unavailable';
    const partyChanges:CrosscheckParty[]=[],events=partyComparisonStatus==='compared'?person.events.filter(e=>e.disposition==='usable').sort((a,b)=>a.time!.localeCompare(b.time!)||a.row-b.row):[],changes:{row:number;time:string;precision:string;before:string;after:string}[]=[];
    // Simultaneous conflicting events cannot establish a party transition.
    let previous:string|null=null;
    for(const time of [...new Set(events.map(e=>e.time!))]){
      const group=events.filter(e=>e.time===time),parties=[...new Set(group.map(e=>e.original.siglaPartido?.trim()||null))];
      const party=parties.length===1?parties[0]:null;
      if(previous&&party&&previous!==party&&time.slice(0,10)>=legacy.scope.start&&time.slice(0,10)<=legacy.scope.end)changes.push({row:group[0].row,time,precision:group.some(e=>e.precision==='minute')?'minute':'second',before:previous,after:party});if(party)previous=party;else if(parties.length>1)previous=null;
    }
    const matched=new Set<number>();
    if(data&&partyComparisonStatus==='compared')for(const [row,a] of data.affiliations.entries()){
      const day=legacyDay(a.dataFiliacaoPartidoPosterior)!;if(day<legacy.scope.start||day>legacy.scope.end)continue;
      const match=changes.findIndex((c,i)=>!matched.has(i)&&c.time.slice(0,10)===day&&c.before===a.siglaPartidoAnterior&&c.after===a.siglaPartidoPosterior);
      if(match>=0)matched.add(match);
      const status=match<0?'legacy-only-change':!a.horaFiliacaoPartidoPosterior?'same-day-time-unavailable':changes[match].precision==='minute'&&changes[match].time.slice(11,16)===a.horaFiliacaoPartidoPosterior.slice(0,5)?'same-day-minute-precision':changes[match].time.slice(11)===a.horaFiliacaoPartidoPosterior?'same-day-and-time':'same-day-time-differs';
      partyChanges.push({legacyRow:row,v2Row:match<0?null:changes[match].row,day,before:a.siglaPartidoAnterior,after:a.siglaPartidoPosterior,status});
    }
    if(data)for(const [i,c] of changes.entries())if(!matched.has(i))partyChanges.push({legacyRow:null,v2Row:c.row,day:c.time.slice(0,10),before:c.before,after:c.after,status:'v2-only-change'});
    return {id:person.id,legacyStatus:p.status,months,partyComparisonStatus,partyChanges};
  });
  return {schema:'clareia.people-crosscheck.v1',legacySha256:hash(canonical(legacy)),temporalSha256:hash(canonical(temporal)),historySha256:hash(canonical(history)),discoverySha256:legacy.discoverySha256,scope:legacy.scope,createdAt:new Date().toISOString(),status:'review-required',publicAttributionEnabled:false,dateSemantics:'boundary-days-and-open-ends-unconfirmed',people};
}
