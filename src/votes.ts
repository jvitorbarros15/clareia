import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {canonical,hash} from './model.ts';
import {redactCpf} from './cpf-scan.ts';

export const voteFileUrl=(kind:'votacoes'|'votacoesVotos'|'votacoesProposicoes',year:number)=>`https://dadosabertos.camara.leg.br/arquivos/${kind}/csv/${kind}-${year}.csv`;
export type VoteObject={billId:number|null;title:string|null;summary:string|null};
export type VoteKind='merito'|'requerimento'|'destaque'|'outro';
export type Vote={id:string;date:string;organ:string;approved:string|null;kind:VoteKind;description:string;objects:VoteObject[];declared:{yes:number;no:number;other:number};observed:Record<string,number>;ballots:number;issues:string[]};
export type Ballot=[voteId:string,deputyId:number,category:string];
export type VoteSource={url:string;sha256:string;file:string;bytes:number;fetchedAt:string;pass?:number};
export type VotesReport={schema:'clareia.votes.v1';contentSha256:string;status:'review-required';publicationEligible:false;year:number;createdAt:string;sources:VoteSource[];votes:Vote[];ballotsSha256:string;metrics:{votes:number;nominal:number;reconciled:number;held:number;ballots:number;orphanBallots:number;categories:Record<string,number>}};
type Row=Record<string,string>;

const VOTE_COLUMNS=['id','data','siglaOrgao','aprovacao','votosSim','votosNao','votosOutros','descricao'];
const BALLOT_COLUMNS=['idVotacao','voto','deputado_id'];
const OBJECT_COLUMNS=['idVotacao','proposicao_id','proposicao_titulo','proposicao_ementa'];
async function rows(bytes:Uint8Array,required:string[],visit:(row:Row)=>void):Promise<void>{
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({delimiter:';',bom:true,skip_empty_lines:true,columns:(headers:string[])=>{for(const field of required)if(!headers.includes(field))throw new Error('Contrato CSV de votações mudou: coluna ausente '+field);return headers;}}));
  for await(const row of stream)visit(row as Row);
}
const count=(value:string)=>/^\d{1,4}$/.test(value)?Number(value):null;
// Read only from the official description. Anything not clearly one of these stays 'outro'.
export function classifyVote(description:string):VoteKind{
  const head=description.split(/[,.:]/)[0];
  if(/requerimento/i.test(head))return 'requerimento';
  if(/^\s*(mantid|suprimid)/i.test(head)||/destaque|destacad/i.test(head))return 'destaque';
  if(/subemenda\s+substitutiva/i.test(head))return 'merito';
  // The first subject named decides: a Proposta de Emenda is merit, an Emenda to a Projeto is not.
  const subject=/\b((?:sub)?emendas?|projeto|substitutiv[oa]|parecer|reda[çc][ãa]o|medida|mat[ée]ria|proposta)\b/i.exec(head)?.[1].toLowerCase();
  return !subject?'outro':subject.includes('emenda')?'destaque':'merito';
}
export const votesContentId=(r:Pick<VotesReport,'schema'|'year'|'votes'|'ballotsSha256'|'metrics'>)=>hash(canonical({schema:r.schema,year:r.year,votes:r.votes,ballotsSha256:r.ballotsSha256,metrics:r.metrics}));
export const ballotsHash=(ballots:Ballot[])=>hash(canonical(ballots));

// Sim and Não are checked against their own declared totals. The other categories only
// have a shared total in the source, so each one keeps its original name and is not interpreted.
// An empty vote is not an abstention, an absence or a vote against: the whole vote is held.
export async function deriveVotes(year:number,votes:Uint8Array,ballots:Uint8Array,objects:Uint8Array):Promise<{votes:Vote[];ballots:Ballot[];metrics:VotesReport['metrics']}>{
  const list=new Map<string,Vote>();
  await rows(votes,VOTE_COLUMNS,r=>{
    if(list.has(r.id))throw new Error('Votação repetida no arquivo');
    const yes=count(r.votosSim),no=count(r.votosNao),other=count(r.votosOutros);if(yes===null||no===null||other===null)throw new Error('Placar inválido');
    list.set(r.id,{id:r.id,date:r.data,organ:r.siglaOrgao,approved:r.aprovacao||null,kind:classifyVote(r.descricao),description:redactCpf(r.descricao),objects:[],declared:{yes,no,other},observed:{},ballots:0,issues:r.data.startsWith(String(year))?[]:['year-date-mismatch']});
  });
  await rows(objects,OBJECT_COLUMNS,r=>{list.get(r.idVotacao)?.objects.push({billId:/^[1-9]\d*$/.test(r.proposicao_id)?Number(r.proposicao_id):null,title:r.proposicao_titulo?redactCpf(r.proposicao_titulo):null,summary:r.proposicao_ementa?redactCpf(r.proposicao_ementa):null});});
  const seen=new Set<string>(),out:Ballot[]=[],categories:Record<string,number>={};let orphanBallots=0;
  await rows(ballots,BALLOT_COLUMNS,r=>{
    const vote=list.get(r.idVotacao);if(!vote){orphanBallots++;return;}
    const category=r.voto.trim(),deputyId=/^[1-9]\d*$/.test(r.deputado_id)?Number(r.deputado_id):null;
    if(deputyId===null){vote.issues.push('invalid-deputy');return;}
    const key=r.idVotacao+':'+deputyId;if(seen.has(key)){vote.issues.push('repeated-ballot');return;}seen.add(key);
    vote.observed[category]=(vote.observed[category]??0)+1;vote.ballots++;categories[category]=(categories[category]??0)+1;out.push([r.idVotacao,deputyId,category]);
  });
  const sorted=[...list.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const v of sorted){
    const declared=v.declared.yes+v.declared.no+v.declared.other;
    if(!v.ballots&&declared)v.issues.push('ballots-missing');
    if(v.ballots){
      const yes=v.observed['Sim']??0,no=v.observed['Não']??0,other=v.ballots-yes-no;
      if(v.observed['']){v.issues.push('empty-ballot');}
      if(yes!==v.declared.yes)v.issues.push('yes-mismatch');if(no!==v.declared.no)v.issues.push('no-mismatch');if(other!==v.declared.other)v.issues.push('other-mismatch');
    }
    v.issues=[...new Set(v.issues)].sort();v.observed=Object.fromEntries(Object.entries(v.observed).sort(([a],[b])=>a.localeCompare(b)));
  }
  out.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
  const nominal=sorted.filter(v=>v.ballots>0);
  return {votes:sorted,ballots:out,metrics:{votes:sorted.length,nominal:nominal.length,reconciled:nominal.filter(v=>!v.issues.length).length,held:sorted.filter(v=>v.issues.length).length,ballots:out.length,orphanBallots,categories:Object.fromEntries(Object.entries(categories).sort(([a],[b])=>a.localeCompare(b)))}};
}
export function votesReport(year:number,derived:{votes:Vote[];ballots:Ballot[];metrics:VotesReport['metrics']},sources:VoteSource[],createdAt:string):VotesReport{
  const body={schema:'clareia.votes.v1' as const,year,votes:derived.votes,ballotsSha256:ballotsHash(derived.ballots),metrics:derived.metrics};
  return {...body,contentSha256:votesContentId(body),status:'review-required',publicationEligible:false,createdAt,sources};
}
