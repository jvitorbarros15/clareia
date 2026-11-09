import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/model.ts';
import {deriveVotes,voteFileUrl,votesReport} from '../src/votes.ts';
import type {VoteSource} from '../src/votes.ts';
import {auditVotes} from '../src/votes-audit.ts';
import {sourceAllowed} from '../src/people-discovery.ts';

const csv=(lines:string[])=>new TextEncoder().encode(lines.join('\n')+'\n');
const voteHead='"id";"data";"siglaOrgao";"aprovacao";"votosSim";"votosNao";"votosOutros";"descricao"',ballotHead='"idVotacao";"voto";"deputado_id"',objectHead='"idVotacao";"proposicao_id";"proposicao_titulo";"proposicao_ementa"';
const vote=(id:string,yes:number,no:number,other:number,date='2025-03-01')=>`"${id}";"${date}";"PLEN";"1";"${yes}";"${no}";"${other}";"Aprovado"`;
const ballot=(id:string,deputy:number|string,category:string)=>`"${id}";"${category}";"${deputy}"`;
const derive=(votes:string[],ballots:string[],objects:string[]=[])=>deriveVotes(2025,csv([voteHead,...votes]),csv([ballotHead,...ballots]),csv([objectHead,...objects]));

test('Sim, Não and the shared other total reconcile and original categories are kept',async()=>{
  const r=await derive([vote('a',1,1,2)],[ballot('a',1,'Sim'),ballot('a',2,'Não'),ballot('a',3,'Abstenção'),ballot('a',4,'Artigo 17')]);
  assert.deepEqual(r.votes[0].issues,[]);assert.deepEqual(r.votes[0].observed,{'Abstenção':1,'Artigo 17':1,'Não':1,Sim:1});assert.equal(r.metrics.reconciled,1);
});
test('a category mismatch is held even when the total line count agrees',async()=>{
  const r=await derive([vote('a',2,0,0)],[ballot('a',1,'Sim'),ballot('a',2,'Não')]);
  assert.deepEqual(r.votes[0].issues,['no-mismatch','yes-mismatch']);assert.equal(r.metrics.held,1);
});
test('an empty vote holds the vote and never becomes a category of its own meaning',async()=>{
  const r=await derive([vote('a',1,0,1)],[ballot('a',1,'Sim'),ballot('a',2,'')]);
  assert.deepEqual(r.votes[0].issues,['empty-ballot']);
});
test('a declared score without ballots is held, and a vote with neither is simply not nominal',async()=>{
  const r=await derive([vote('a',5,0,0),vote('b',0,0,0)],[]);
  assert.deepEqual(r.votes.map(v=>v.issues),[['ballots-missing'],[]]);assert.equal(r.metrics.nominal,0);
});
test('a repeated deputy is held and counted once',async()=>{
  const r=await derive([vote('a',1,0,0)],[ballot('a',1,'Sim'),ballot('a',1,'Sim')]);
  assert.deepEqual(r.votes[0].issues,['repeated-ballot']);assert.equal(r.ballots.length,1);
});
test('the voted object is attached and ballots for unknown votes are measured',async()=>{
  const r=await derive([vote('a',1,0,0)],[ballot('a',1,'Sim'),ballot('z',1,'Sim')],['"a";"10";"PL 1/2025";"Ementa"']);
  assert.deepEqual(r.votes[0].objects,[{billId:10,title:'PL 1/2025',summary:'Ementa'}]);assert.equal(r.metrics.orphanBallots,1);
});
test('a vote dated in another year is held',async()=>{
  assert.deepEqual((await derive([vote('a',0,0,0,'2024-12-01')],[])).votes[0].issues,['year-date-mismatch']);
});
test('a missing column stops the run',async()=>{
  await assert.rejects(deriveVotes(2025,csv(['"id"']),csv([ballotHead]),csv([objectHead])),/coluna ausente/);
});
test('only the official yearly files are allowed',()=>{
  assert.ok(sourceAllowed(voteFileUrl('votacoesVotos',2025)));assert.equal(sourceAllowed('https://dadosabertos.camara.leg.br/arquivos/votacoes/csv/outro.csv'),false);
});
test('the audit recounts each category and catches changed tallies, holds and ballots',async()=>{
  const v=csv([voteHead,vote('a',1,1,0),vote('b',1,0,0)]),b=csv([ballotHead,ballot('a',1,'Sim'),ballot('a',2,'Não'),ballot('b',1,'Não')]),o=csv([objectHead]);
  const file=new Map<string,Uint8Array>([['v',v],['b',b],['o',o]]),source=(url:string,name:string):VoteSource=>({url,sha256:hash(file.get(name)!),file:name,bytes:file.get(name)!.length,fetchedAt:'2026-11-09T00:00:00Z',pass:2});
  const derived=await deriveVotes(2025,v,b,o),report=votesReport(2025,derived,[source(voteFileUrl('votacoes',2025),'v'),source(voteFileUrl('votacoesVotos',2025),'b'),source(voteFileUrl('votacoesProposicoes',2025),'o')],'2026-11-09T00:00:00Z'),read=async(s:VoteSource)=>file.get(s.file)!;
  assert.deepEqual((await auditVotes(report,derived.ballots,read)).failures,[]);
  const edit=(change:(r:typeof report)=>void)=>{const c=structuredClone(report);change(c);return auditVotes(c,derived.ballots,read);};
  assert.ok((await edit(r=>{r.votes[0].observed={Sim:2};})).failures.includes('tally-a'));
  assert.ok((await edit(r=>{r.votes[1].issues=[];})).failures.includes('issues-b'));
  assert.ok((await auditVotes(report,[...derived.ballots,['a',9,'Sim']],read)).failures.includes('ballots-hash'));
});

test('a CPF written in official free text is removed before anything is kept',async()=>{
  const r=await derive([vote('a',0,0,0).replace('Aprovado','Aprovado 529.982.247-25')],[],['"a";"10";"PL 1/2025";"Pensão a Fulana (CPF 529.982.247-25), filha"']);
  assert.equal(JSON.stringify(r).includes('529.982'),false);assert.match(r.votes[0].objects[0].summary!,/\[CPF omitido\]/);
});

test('CPFs written in other forms next to the label are removed too',async()=>{
  const {redactCpf,findCpfs}=await import('../src/cpf-scan.ts');
  for(const t of ['CPF n.529.982.247-25','CPF 52998224725','CPF 529982247-25','CPF 529.982.247/25']){assert.ok(findCpfs(t,new Set())>0,t);assert.equal(redactCpf(t).match(/\d{3}/),null,t);}
  assert.equal(redactCpf('Processo 1234/2025'),'Processo 1234/2025');
});
