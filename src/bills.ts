import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {canonical,hash} from './model.ts';

export const BILL_TYPES=['PL','PLP','PEC'] as const;
export const billsUrl=(year:number)=>`https://dadosabertos.camara.leg.br/arquivos/proposicoes/csv/proposicoes-${year}.csv`;
export const billAuthorsUrl=(year:number)=>`https://dadosabertos.camara.leg.br/arquivos/proposicoesAutores/csv/proposicoesAutores-${year}.csv`;
export const billTramitacoesUrl=(id:number)=>`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}/tramitacoes`;
export const NORM_SITUATION='Transformado em Norma Jurídica';
export type BillNorm={kind:string;number:string;year:number};
export type BillAuthor={deputyId:number;order:number|null;proponent:boolean};
export type Bill={id:number;type:string;number:number;year:number;presentedAt:string|null;summary:string;situation:string|null;situationAt:string|null;url:string|null;authors:BillAuthor[];otherAuthors:number;otherProponents:number;issues:string[];normStatus:'none'|'resolved'|'unresolved';norm:BillNorm|null};
export type BillPerson={id:number;proposed:number;joint:number;coauthored:number;norms:number};
export type BillSource={url:string;sha256:string;file:string;bytes:number;fetchedAt:string;pass?:number};
export type BillsReport={schema:'clareia.bills.v1';contentSha256:string;status:'review-required';publicationEligible:false;year:number;types:string[];createdAt:string;sources:BillSource[];bills:Bill[];people:BillPerson[];metrics:{propositions:number;selected:number;held:number;orphanAuthorRows:number;normsResolved:number;normsUnresolved:number}};
type Row=Record<string,string>;

const BILL_COLUMNS=['id','siglaTipo','numero','ano','ementa','dataApresentacao','urlInteiroTeor','ultimoStatus_dataHora','ultimoStatus_descricaoSituacao'];
const AUTHOR_COLUMNS=['idProposicao','idDeputadoAutor','uriAutor','ordemAssinatura','proponente'];
async function rows(bytes:Uint8Array,required:string[],visit:(row:Row)=>void):Promise<void>{
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({delimiter:';',bom:true,skip_empty_lines:true,columns:(headers:string[])=>{for(const field of required)if(!headers.includes(field))throw new Error('Contrato CSV de proposições mudou: coluna ausente '+field);return headers;}}));
  for await(const row of stream)visit(row as Row);
}
const positive=(value:string)=>/^[1-9]\d{0,9}$/.test(value)?Number(value):null;
export const billsContentId=(r:Pick<BillsReport,'schema'|'year'|'types'|'bills'|'people'|'metrics'>)=>hash(canonical({schema:r.schema,year:r.year,types:r.types,bills:r.bills,people:r.people,metrics:r.metrics}));

// Counts only separate who proposed from who co-signed, using the source's own flag.
// A held bill keeps its evidence and enters no count; signature order is never read as authorship.
const KINDS:Record<string,string>={PL:'Lei Ordinária',PLP:'Lei Complementar',PEC:'Emenda Constitucional'};
const NORM_TEXT=/Transformad[oa]\s+(?:n[ao]|em)\s+(Lei Ordin[áa]ria|Lei Complementar|Emenda Constitucional)\s+(?:n[ºo°.]*\s*)?(\d[\d.]*)\/(\d{4})/i;
const ANY_NORM=/(Lei Ordin[áa]ria|Lei Complementar|Emenda Constitucional)\s+(?:n[ºo°.]*\s*)?(\d[\d.]*)\/(\d{4})/gi;
// The norm comes only from the official dispatch text. Anything ambiguous or of an unexpected kind stays unresolved.
export function normFromTramitacoes(type:string,entries:{despacho?:string|null;descricaoTramitacao?:string|null}[],billYear=0):BillNorm|null{
  const found=new Map<string,BillNorm>(),cited=new Set<string>();
  for(const e of entries)for(const text of [e.despacho,e.descricaoTramitacao]){const m=text?NORM_TEXT.exec(text):null;if(m){const norm={kind:m[1].replace('Ordinaria','Ordinária'),number:m[2].replace(/\./g,''),year:Number(m[3])};found.set(canonical(norm),norm);}for(const c of text?.matchAll(ANY_NORM)??[])cited.add(c[1].toLowerCase().replace('ordinaria','ordinária')+'|'+c[2].replace(/\./g,'')+'|'+c[3]);}
  const [norm]=found.values();return found.size===1&&cited.size===1&&norm.kind===KINDS[type]&&norm.year>=billYear?norm:null;
}
export async function deriveBills(year:number,bills:Uint8Array,authors:Uint8Array,tramitacoes?:(id:number)=>Promise<{despacho?:string|null;descricaoTramitacao?:string|null}[]>):Promise<Pick<BillsReport,'bills'|'people'|'metrics'>>{
  const known=new Set<string>(),selected=new Map<number,Bill>(),types=new Set<string>(BILL_TYPES);let propositions=0;
  await rows(bills,BILL_COLUMNS,r=>{
    propositions++;known.add(r.id);if(!types.has(r.siglaTipo))return;
    const id=positive(r.id),number=positive(r.numero);if(id===null||number===null||r.ano!==String(year))throw new Error('Identificação de proposição inválida');
    if(selected.has(id))throw new Error('Proposição repetida no arquivo');
    const presentedAt=r.dataApresentacao||null,issues=presentedAt?.slice(0,4)===String(year)?[]:['year-date-mismatch'];
    selected.set(id,{id,type:r.siglaTipo,number,year,presentedAt,summary:r.ementa,situation:r.ultimoStatus_descricaoSituacao||null,situationAt:r.ultimoStatus_dataHora||null,url:r.urlInteiroTeor||null,authors:[],otherAuthors:0,otherProponents:0,issues,normStatus:r.ultimoStatus_descricaoSituacao===NORM_SITUATION?'unresolved':'none',norm:null});
  });
  let orphanAuthorRows=0;const seen=new Set<string>(),withRows=new Set<number>();
  await rows(authors,AUTHOR_COLUMNS,r=>{
    if(!known.has(r.idProposicao)){orphanAuthorRows++;return;}
    const bill=selected.get(Number(r.idProposicao));if(!bill)return;withRows.add(bill.id);
    if(!r.idDeputadoAutor){bill.otherAuthors++;if(r.proponente==='1')bill.otherProponents++;return;}
    const deputyId=positive(r.idDeputadoAutor),flag=r.proponente==='1'?true:r.proponente==='0'?false:null;
    if(deputyId===null||!r.uriAutor.endsWith('/deputados/'+r.idDeputadoAutor)){bill.issues.push('author-identity-mismatch');return;}
    if(flag===null){bill.issues.push('invalid-author-flag');return;}
    const key=bill.id+':'+deputyId;if(seen.has(key)){bill.issues.push('repeated-author-row');return;}seen.add(key);
    bill.authors.push({deputyId,order:positive(r.ordemAssinatura),proponent:flag});
  });
  const list=[...selected.values()].sort((a,b)=>a.id-b.id),counts=new Map<number,BillPerson>();
  if(tramitacoes)for(const bill of list)if(bill.normStatus==='unresolved'){bill.norm=normFromTramitacoes(bill.type,await tramitacoes(bill.id),bill.year);if(bill.norm)bill.normStatus='resolved';}
  for(const bill of list){
    bill.authors.sort((a,b)=>a.deputyId-b.deputyId);
    if(!withRows.has(bill.id))bill.issues.push('no-author-rows');
    bill.issues=[...new Set(bill.issues)].sort();if(bill.issues.length)continue;
    // The source marks several proponents on some bills, so a proposal is not always a solo one.
    const proponents=bill.authors.filter(a=>a.proponent).length+bill.otherProponents;
    for(const a of bill.authors){const c=counts.get(a.deputyId)??{id:a.deputyId,proposed:0,joint:0,coauthored:0,norms:0};if(a.proponent){c.proposed++;if(proponents>1)c.joint++;if(bill.norm)c.norms++;}else c.coauthored++;counts.set(a.deputyId,c);}
  }
  return {bills:list,people:[...counts.values()].sort((a,b)=>a.id-b.id),metrics:{propositions,selected:list.length,held:list.filter(b=>b.issues.length).length,orphanAuthorRows,normsResolved:list.filter(b=>b.normStatus==='resolved').length,normsUnresolved:list.filter(b=>b.normStatus==='unresolved').length}};
}
export function billsReport(year:number,derived:Pick<BillsReport,'bills'|'people'|'metrics'>,sources:BillSource[],createdAt:string):BillsReport{
  const body={schema:'clareia.bills.v1' as const,year,types:[...BILL_TYPES] as string[],...derived};
  return {...body,contentSha256:billsContentId(body),status:'review-required',publicationEligible:false,createdAt,sources};
}
