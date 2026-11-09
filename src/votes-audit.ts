import {parse} from 'csv-parse/sync';
import {canonical,hash} from './model.ts';
import {ballotsHash,voteFileUrl,votesContentId} from './votes.ts';
import type {Ballot,VotesReport,VoteSource} from './votes.ts';

// Recounts every category from the preserved files by another path. It shares the
// rules and the author with the collector, so it detects implementation differences only.
export async function auditVotes(report:VotesReport,ballots:Ballot[],read:(source:VoteSource)=>Promise<Uint8Array>):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string;contentSha256:string}>{
  const failures:string[]=[];
  if(report.status!=='review-required'||report.publicationEligible!==false)failures.push('publication-gate');
  if(votesContentId(report)!==report.contentSha256)failures.push('content-id');
  if(ballotsHash(ballots)!==report.ballotsSha256)failures.push('ballots-hash');
  const table=async(kind:'votacoes'|'votacoesVotos'|'votacoesProposicoes')=>{
    const url=voteFileUrl(kind,report.year),s=report.sources.filter(x=>x.url===url).sort((a,b)=>(a.pass??0)-(b.pass??0)).at(-1);
    if(!s){failures.push('missing-source');return [] as Record<string,string>[];}
    const bytes=await read(s);if(hash(bytes)!==s.sha256||bytes.length!==s.bytes){failures.push('source-hash');return [] as Record<string,string>[];}
    return parse(Buffer.from(bytes),{delimiter:';',bom:true,columns:true,skip_empty_lines:true}) as Record<string,string>[];
  };
  const clean=(t:string)=>t.replace(/CPF|[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}/gi,'');
  const declared=await table('votacoes'),rows=await table('votacoesVotos'),matters=await table('votacoesProposicoes'),mattersOf=new Map<string,Record<string,string>[]>(),reported=new Map(report.votes.map(v=>[v.id,v])),perVote=new Map<string,Record<string,string>[]>(),ids=new Set(declared.map(v=>v.id));
  for(const m of matters){const l=mattersOf.get(m.idVotacao);if(l)l.push(m);else mattersOf.set(m.idVotacao,[m]);}
  for(const r of rows){if(!ids.has(r.idVotacao))continue;const l=perVote.get(r.idVotacao);if(l)l.push(r);else perVote.set(r.idVotacao,[r]);}
  if(declared.length!==report.votes.length||report.metrics.orphanBallots!==rows.filter(r=>!ids.has(r.idVotacao)).length)failures.push('vote-universe');
  let total=0,held=0;
  for(const d of declared){
    const v=reported.get(d.id);if(!v){failures.push('missing-vote-'+d.id);continue;}
    const own=perVote.get(d.id)??[],deputies=new Set<string>(),tally:Record<string,number>={};let dup=false,bad=false;
    for(const r of own){if(!/^[1-9][0-9]*$/.test(r.deputado_id)){bad=true;continue;}if(deputies.has(r.deputado_id)){dup=true;continue;}deputies.add(r.deputado_id);const c=r.voto.trim();tally[c]=(tally[c]??0)+1;}
    const n=Object.values(tally).reduce((a,b)=>a+b,0),yes=tally['Sim']??0,no=tally['Não']??0,issues:string[]=[];
    if(!d.data.startsWith(String(report.year)))issues.push('year-date-mismatch');
    if(bad)issues.push('invalid-deputy');if(dup)issues.push('repeated-ballot');
    if(!n&&Number(d.votosSim)+Number(d.votosNao)+Number(d.votosOutros)>0)issues.push('ballots-missing');
    if(n){if(tally['']!==undefined)issues.push('empty-ballot');if(yes!==Number(d.votosSim))issues.push('yes-mismatch');if(no!==Number(d.votosNao))issues.push('no-mismatch');if(n-yes-no!==Number(d.votosOutros))issues.push('other-mismatch');}
    const lead=d.descricao.split(/[,.:]/)[0].toLowerCase(),firstAt=(words:string[])=>Math.min(...words.map(w=>{const i=lead.search(new RegExp('\\b'+w+'\\b'));return i<0?Infinity:i;})),amend=firstAt(['emenda','emendas','subemenda','subemendas']),merit=firstAt(['projeto','substitutivo','substitutiva','parecer','redação','redacao','medida','matéria','materia','proposta']),kind=lead.includes('requerimento')?'requerimento':/^\s*(mantid|suprimid)/.test(lead)||lead.includes('destaque')||lead.includes('destacad')?'destaque':lead.includes('subemenda substitutiva')?'merito':amend===Infinity&&merit===Infinity?'outro':amend<merit?'destaque':'merito';
    if(kind!==v.kind)failures.push('kind-'+d.id);
    if(d.data!==v.date||d.siglaOrgao!==v.organ||(d.descricao.search(/cpf|[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}/i)<0&&d.descricao!==v.description))failures.push('fields-'+d.id);
    const expectedMatters=(mattersOf.get(d.id)??[]).map(m=>[/^[1-9][0-9]*$/.test(m.proposicao_id)?Number(m.proposicao_id):null,clean(m.proposicao_titulo)]);
    if(canonical(expectedMatters)!==canonical(v.objects.map(o=>[o.billId,clean(o.title??'')])))failures.push('matters-'+d.id);
    if(canonical(issues.sort())!==canonical(v.issues))failures.push('issues-'+d.id);
    if(canonical(Object.entries(tally).sort(([a],[b])=>a.localeCompare(b)))!==canonical(Object.entries(v.observed).sort(([a],[b])=>a.localeCompare(b)))||v.ballots!==n)failures.push('tally-'+d.id);
    total+=n;if(issues.length)held++;
  }
  if(report.metrics.ballots!==total||report.metrics.held!==held)failures.push('totals');
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString(),contentSha256:report.contentSha256};
}
