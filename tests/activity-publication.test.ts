import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {ballotsHash,classifyVote,votesContentId} from '../src/votes.ts';
import type {Ballot,Vote,VotesReport} from '../src/votes.ts';
import {assertVotesMatchVersion,auditVotesVersion,buildVotesVersion,readBallots,storeVotesVersion} from '../src/votes-publication.ts';
import {amendmentsContentId} from '../src/amendments.ts';
import type {AmendmentsReport,Totals} from '../src/amendments.ts';
import {assertApprovable,auditAmendmentsVersion,buildAmendmentsVersion,loadReviewedLinks,readAmendmentRows,storeAmendmentsVersion} from '../src/amendments-publication.ts';

const now='2026-11-09T00:00:00Z';
const vote=(id:string,observed:Record<string,number>):Vote=>({id,date:'2025-03-01',organ:'PLEN',approved:'1',kind:'merito',description:'Aprovado o Projeto',objects:[],declared:{yes:1,no:0,other:0},observed,ballots:Object.values(observed).reduce((a,b)=>a+b,0),issues:[]});
function report(votes:Vote[],ballots:Ballot[]=[]):VotesReport{
  const metrics={votes:votes.length,nominal:votes.length,reconciled:votes.length,held:0,ballots:1,orphanBallots:0,categories:{}},body={schema:'clareia.votes.v1' as const,year:2025,votes,ballotsSha256:ballotsHash(ballots),metrics};
  return {...body,contentSha256:votesContentId(body),status:'review-required',publicationEligible:false,createdAt:now,sources:[]};
}
test('votes are separated into merit, request, amendment or highlight, and other, from the official text',()=>{
  assert.equal(classifyVote('Rejeitado o Requerimento de Retirada de pauta. Resultado: 26 votos'),'requerimento');
  assert.equal(classifyVote('Mantido o texto. Sim: 3'),'destaque');assert.equal(classifyVote('Aprovada a Emenda de Plenário n. 7. Sim: 269'),'destaque');assert.equal(classifyVote('Aprovada a matéria destacada. Fica mantido'),'destaque');
  assert.equal(classifyVote('Aprovado o Parecer,  ressalvado o Destaque'),'merito');assert.equal(classifyVote('Aprovada a Subemenda Substitutiva Global ao Projeto'),'merito');assert.equal(classifyVote('Aprovado o Projeto de Lei'),'merito');
  assert.equal(classifyVote('Rejeitado o Recurso'),'outro');
  assert.equal(classifyVote('Aprovada a Proposta de Emenda à Constituição nº 45 em primeiro turno'),'merito');assert.equal(classifyVote('Aprovado o Projeto de Lei com emendas do Senado'),'merito');assert.equal(classifyVote('Aprovada a Emenda ao Projeto de Lei'),'destaque');
});
test('votes stay inactive until approved and the audit recounts each category from SQL',async()=>{
  const db=await openDB(true);
  try{
    const ballots:Ballot[]=[['a',1,'Sim'],['b',1,'Não']],r=report([vote('a',{Sim:1}),vote('b',{Não:1})],ballots),part={report:r,ballots,audit:{status:'passed',contentSha256:r.contentSha256}},v=buildVotesVersion([part],now);
    await storeVotesVersion(db,v);await storeVotesVersion(db,v);assert.equal(await activePublication(db,'votacoes'),null);assert.deepEqual(await readBallots(db,v.id,1),ballots);
    assert.deepEqual((await auditVotesVersion(db,v.id)).failures,[]);
    await db.query(`UPDATE vote_ballots_v1 SET category='Não' WHERE publication_id=$1 AND vote_id='a'`,[v.id]);
    const bad=await auditVotesVersion(db,v.id);assert.ok(bad.failures.includes('tally-a'));assert.ok(bad.failures.includes('content-id'));await assert.rejects(assertVotesMatchVersion(db,v.id),/diferem/);
    await db.query(`UPDATE vote_ballots_v1 SET category='Sim' WHERE publication_id=$1 AND vote_id='a'`,[v.id]);
    await recordDomainAudit(db,v.id,'passed',{checkedAt:now});assert.equal((await activePublication(db,'votacoes'))?.id,v.id);
  }finally{await db.close();}
});
test('an unaudited or altered votes report is refused',()=>{
  const r=report([vote('a',{Sim:1})]);
  assert.throws(()=>buildVotesVersion([{report:r,ballots:[],audit:{status:'failed',contentSha256:r.contentSha256}}],now),/auditoria/);
  assert.throws(()=>buildVotesVersion([{report:r,ballots:[['a',2,'Sim']],audit:{status:'passed',contentSha256:r.contentSha256}}],now),/auditoria/,'ballots changed after the audit');
  const edited=structuredClone(r);edited.votes[0].observed={Sim:9};assert.throws(()=>buildVotesVersion([{report:edited,ballots:[],audit:{status:'passed',contentSha256:r.contentSha256}}],now),/auditoria/);
});
const totals=(committed:number):Totals=>({rows:1,committed,liquidated:0,paid:0,carriedOver:0,carriedCancelled:0,carriedPaid:0});
function amendments():AmendmentsReport{
  const year={...totals(300),rows:2,destinations:{'SP':totals(100),'Nacional':totals(200)}},authors=[{code:'10',name:'ANA',names:['ANA'],years:{'2025':year}}],metrics={rows:2,selected:2,individual:2,unattributed:0,repeatedRows:0},body={schema:'clareia.amendments.v1' as const,fromYear:2023,authors,links:[{code:'10',name:'ANA',status:'proposed' as const,candidates:[1]}],excluded:{},metrics};
  return {...body,contentSha256:amendmentsContentId(body),status:'review-required',publicationEligible:false,createdAt:now,sources:[]};
}
const known=new Set([1]);
const reviewed={code:'10',deputyId:1,reviewer:'João',reviewedAt:now,evidence:'Conferido no portal'};
test('a proposed name link attributes nothing and only a reviewed link produces rows',()=>{
  const r=amendments(),audit={status:'passed',contentSha256:r.contentSha256};
  assert.equal(buildAmendmentsVersion(r,audit,[],known,now).rows.length,0);assert.equal(buildAmendmentsVersion(r,audit,[reviewed],known,now).rows.length,2);
  assert.throws(()=>buildAmendmentsVersion(r,audit,[{...reviewed,deputyId:2}],known,now),/candidatos/);assert.deepEqual(buildAmendmentsVersion(r,audit,[reviewed],known,now).reviews,[reviewed]);assert.equal(JSON.stringify(buildAmendmentsVersion(r,audit,[reviewed],known,now).scope).includes('João'),false);
  assert.throws(()=>buildAmendmentsVersion(r,audit,[reviewed],new Set([9]),now),/desconhecido/);
  const two=structuredClone(r);two.authors[0].names=['ANA','OUTRA'];two.links[0].candidates=[];two.links[0].status='ambiguous';two.contentSha256=amendmentsContentId(two);assert.throws(()=>buildAmendmentsVersion(two,{status:'passed',contentSha256:two.contentSha256},[reviewed],known,now),/mais de um nome/);
  const repeated=structuredClone(r);repeated.metrics.repeatedRows=1;repeated.contentSha256=amendmentsContentId(repeated);assert.throws(()=>buildAmendmentsVersion(repeated,{status:'passed',contentSha256:repeated.contentSha256},[],known,now),/repetidas/);
  assert.throws(()=>buildAmendmentsVersion(r,audit,[{...reviewed,reviewer:''}],known,now),/revisão/);assert.throws(()=>buildAmendmentsVersion(r,audit,[{...reviewed,code:'99'}],known,now),/inexistente/);
});
test('amendment publication requires reviewed, unambiguous links and counts excluded rows separately',async()=>{
  const r=amendments();
  r.excluded={'Emenda de Bancada':{...totals(400),rows:4},'Emenda individual sem autor identificado':{...totals(300),rows:3}};
  r.metrics={...r.metrics,rows:9,selected:9,individual:5,unattributed:3};
  r.contentSha256=amendmentsContentId(r);
  const audit={status:'passed',contentSha256:r.contentSha256};
  const empty=buildAmendmentsVersion(r,audit,await loadReviewedLinks(),known,now);
  assert.equal(empty.rows.length,0);
  assert.throws(()=>assertApprovable(empty),/sem linhas atribuídas/);

  const version=buildAmendmentsVersion(r,audit,[reviewed],known,now);
  assert.equal(version.scope.unattributedRows,7);
  assert.deepEqual(version.rows.map(({code,deputyId})=>({code,deputyId})),[{code:'10',deputyId:1},{code:'10',deputyId:1}]);
  assert.doesNotThrow(()=>assertApprovable(version));

  const ambiguous=structuredClone(r);
  ambiguous.links[0].status='ambiguous';
  ambiguous.links[0].candidates=[1,2];
  ambiguous.contentSha256=amendmentsContentId(ambiguous);
  for(const deputyId of [1,3]){
    assert.throws(()=>buildAmendmentsVersion(ambiguous,{status:'passed',contentSha256:ambiguous.contentSha256},[{...reviewed,deputyId}],known,now),/ambígua/);
  }

  const duplicate=structuredClone(r);
  duplicate.links.push({...duplicate.links[0]});
  duplicate.contentSha256=amendmentsContentId(duplicate);
  assert.throws(()=>buildAmendmentsVersion(duplicate,{status:'passed',contentSha256:duplicate.contentSha256},[reviewed],known,now),/proposta repetida/);

  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-amendment-links-'));
  try{
    const file=path.join(dir,'links.json');
    for(const invalid of [{},[{...reviewed,reviewer:''}],[{...reviewed,deputyId:'1'}]]){
      await fs.writeFile(file,JSON.stringify(invalid));
      await assert.rejects(loadReviewedLinks(file),/deve ser uma lista/);
    }
    await fs.writeFile(file,JSON.stringify([reviewed]));
    assert.deepEqual(await loadReviewedLinks(file),[reviewed]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('stored destinations must add back up to the audited author totals',async()=>{
  const db=await openDB(true);
  try{
    const r=amendments(),v=buildAmendmentsVersion(r,{status:'passed',contentSha256:r.contentSha256},[reviewed],known,now);await storeAmendmentsVersion(db,v);
    assert.equal((await readAmendmentRows(db,v.id)).length,2);assert.deepEqual((await auditAmendmentsVersion(db,v.id,r)).failures,[]);assert.equal(await activePublication(db,'emendas'),null);
    await db.query(`UPDATE amendments_v1 SET record=jsonb_set(record,'{totals,committed}','999') WHERE publication_id=$1 AND position=0`,[v.id]);
    const bad=await auditAmendmentsVersion(db,v.id,r);assert.ok(bad.failures.includes('totals-10|2025'));assert.ok(bad.failures.includes('content-id'));
  }finally{await db.close();}
});
