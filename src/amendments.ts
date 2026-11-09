import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {unzipSync} from 'fflate';
import {canonical,hash} from './model.ts';

export const AMENDMENTS_URL='https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/emendas-parlamentares/EmendasParlamentares.zip';
export const AMENDMENTS_FILE='EmendasParlamentares.csv';
export const MEASURES=['committed','liquidated','paid','carriedOver','carriedCancelled','carriedPaid'] as const;
export type Measure=typeof MEASURES[number];
export type Totals=Record<Measure,number>&{rows:number};
const COLUMNS:Record<Measure,string>={committed:'Valor Empenhado',liquidated:'Valor Liquidado',paid:'Valor Pago',carriedOver:'Valor Restos A Pagar Inscritos',carriedCancelled:'Valor Restos A Pagar Cancelados',carriedPaid:'Valor Restos A Pagar Pagos'};
export type AuthorYear=Totals&{destinations:Record<string,Totals>};
export type AmendmentAuthor={code:string;name:string;names:string[];years:Record<string,AuthorYear>};
export type AmendmentLink={code:string;name:string;status:'proposed'|'ambiguous'|'unmatched';candidates:number[]};
export type AmendmentSource={url:string;sha256:string;file:string;bytes:number;fetchedAt:string;pass?:number};
export type AmendmentsReport={schema:'clareia.amendments.v1';contentSha256:string;status:'review-required';publicationEligible:false;fromYear:number;createdAt:string;sources:AmendmentSource[];authors:AmendmentAuthor[];links:AmendmentLink[];excluded:Record<string,Totals>;metrics:{rows:number;selected:number;individual:number;unattributed:number;repeatedRows:number}};
export type KnownPerson={id:number;name:string};

const empty=():Totals=>({rows:0,committed:0,liquidated:0,paid:0,carriedOver:0,carriedCancelled:0,carriedPaid:0});
const DESTINATION='Localidade de aplicação do recurso';
const BLANK_AUTHORS=new Set(['','S/I','-99']);
export function brlCents(value:string):number{
  if(!/^-?\d+(?:,\d{1,2})?$/.test(value))throw new Error('Valor monetário inválido');
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split(','),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  const out=negative?-cents:cents;if(out>BigInt(Number.MAX_SAFE_INTEGER)||out<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Valor fora da precisão segura');return Number(out);
}
export const normalizeName=(name:string)=>name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
export const amendmentsContentId=(r:Pick<AmendmentsReport,'schema'|'fromYear'|'authors'|'links'|'excluded'|'metrics'>)=>hash(canonical({schema:r.schema,fromYear:r.fromYear,authors:r.authors,links:r.links,excluded:r.excluded,metrics:r.metrics}));
export function amendmentsCsv(archive:Uint8Array):Uint8Array{
  const file=unzipSync(archive,{filter:f=>f.name===AMENDMENTS_FILE&&f.originalSize<=200_000_000})[AMENDMENTS_FILE];if(!file)throw new Error('Arquivo de emendas ausente');return file;
}
const add=(t:Totals,r:Record<string,string>)=>{t.rows++;for(const m of MEASURES)t[m]+=brlCents(r[COLUMNS[m]]);};
// Measures are never added to each other. Only individual amendments can reach a person, and
// a name match is only a proposal: an unreviewed link never attributes money to anyone.
export async function deriveAmendments(csvBytes:Uint8Array,fromYear:number,people:KnownPerson[]):Promise<Pick<AmendmentsReport,'authors'|'links'|'excluded'|'metrics'>>{
  const text=new TextDecoder('latin1').decode(csvBytes),required=[DESTINATION,'Ano da Emenda','Tipo de Emenda','Código do Autor da Emenda','Nome do Autor da Emenda',...Object.values(COLUMNS)];
  const stream=Readable.from([text]).pipe(parse({delimiter:';',skip_empty_lines:true,columns:(h:string[])=>{for(const f of required)if(!h.includes(f))throw new Error('Contrato CSV de emendas mudou: coluna ausente '+f);return h;}}));
  const authors=new Map<string,AmendmentAuthor>(),excluded:Record<string,Totals>={},seen=new Set<string>();let rows=0,selected=0,individual=0,unattributed=0,repeatedRows=0;
  for await(const r of stream as AsyncIterable<Record<string,string>>){
    rows++;if(Number(r['Ano da Emenda'])<fromYear)continue;selected++;
    const line=canonical(Object.values(r));if(seen.has(line))repeatedRows++;seen.add(line);
    const type=r['Tipo de Emenda'],code=r['Código do Autor da Emenda'].trim(),year=r['Ano da Emenda'];
    if(!type.startsWith('Emenda Individual')){add(excluded[type]??=empty(),r);continue;}
    individual++;
    if(BLANK_AUTHORS.has(code)){unattributed++;add(excluded['Emenda individual sem autor identificado']??=empty(),r);continue;}
    const authorName=r['Nome do Autor da Emenda'].trim(),author=authors.get(code)??{code,name:authorName,names:[],years:{}};if(!author.names.includes(authorName)){author.names.push(authorName);author.names.sort();author.name=author.names[0];}
    const totals=author.years[year]??={...empty(),destinations:{}},destination=r[DESTINATION].trim()||'Sem localidade informada';
    add(totals,r);add(totals.destinations[destination]??=empty(),r);authors.set(code,author);
  }
  const byName=new Map<string,number[]>();for(const p of people){const k=normalizeName(p.name);byName.set(k,[...(byName.get(k)??[]),p.id]);}
  const list=[...authors.values()].sort((a,b)=>a.code.localeCompare(b.code));
  // One code under several names cannot be tied to a person by name at all.
  const links=list.map<AmendmentLink>(a=>{const candidates=a.names.length>1?[]:[...(byName.get(normalizeName(a.name))??[])].sort((x,y)=>x-y);return {code:a.code,name:a.name,status:a.names.length>1||candidates.length>1?'ambiguous':candidates.length?'proposed':'unmatched',candidates};});
  return {authors:list,links,excluded:Object.fromEntries(Object.entries(excluded).sort(([a],[b])=>a.localeCompare(b))),metrics:{rows,selected,individual,unattributed,repeatedRows}};
}
export function amendmentsReport(fromYear:number,derived:Pick<AmendmentsReport,'authors'|'links'|'excluded'|'metrics'>,sources:AmendmentSource[],createdAt:string):AmendmentsReport{
  const body={schema:'clareia.amendments.v1' as const,fromYear,...derived};
  return {...body,contentSha256:amendmentsContentId(body),status:'review-required',publicationEligible:false,createdAt,sources};
}
