import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {buildExpenseAnnualCandidate} from '../src/expense-annual-candidate.ts';
import {buildExpenseVersion} from '../src/expense-publication.ts';
import {expensePeriod} from '../src/expense-period.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const all=Array.from({length:12},(_,i)=>i+1);
function segment(year:number,months:number[],legislature:number,ids=[1]){
  const period=expensePeriod(year,months),scope={year,months,legislature,ids};
  const history:any={scope:{legislature},legislature:{id:legislature,...period},people:ids.map(id=>({id,profile:{name:'Pessoa '+id,photo:null,source:{fetchedAt:'2026-11-10T00:00:00Z'}}}))};
  const temporal:any={scope:{legislature,...period},historySha256:hash(canonical(history)),people:ids.map(id=>({id,months:months.map(month=>({year,month,partialScope:false,exercise:'full',uf:{status:'single',value:'SP'},party:{status:'single',value:legislature===56?'A':'B'}}))}))};
  const proposal={schema:'clareia.expense-lot.v1',year,months,lot:0,lotSize:50,lots:1,universeSize:ids.length,universeSha256:hash(canonical(ids)),people:ids.map(id=>({id})),temporalSha256:hash(canonical(temporal)),crosscheckSha256:'c'};
  const proposalSha256=hash(canonical(proposal)),input={schema:'clareia.expense-lot-input.v1',proposal,temporal};
  const cells=ids.flatMap(personId=>months.map(month=>({personId,year,month,status:month===3?'held-review':'complete',reasons:month===3?['unknown-exercise']:[],totalCents:month===3?null:month===2?-25:100,records:month===3?[]:[{id:`${year}-${month}-${personId}`,personId,year,month,cents:month===2?-25:100}]})));
  const report:any={scope,proposalSha256,peopleVersion:hash(canonical(temporal)),createdAt:'2026-11-10T00:00:00Z',contentSha256:'c',cells};
  const runId=`run-${year}-${months[0]}`,reportSha256=hash(canonical(report));
  const lots:any[]=[{runId,manifest:{runId,status:'review-required',reportSha256,proposalSha256,inputSha256:hash(canonical(input))},input,report,audit:{status:'passed',reportSha256,proposalSha256,peopleVersion:report.peopleVersion,scope,competences:cells.length,checkedAt:'2026-11-10T00:00:00Z'}}];
  return {lots,history};
}
function reseal(group:ReturnType<typeof segment>){
  for(const l of group.lots){l.manifest.reportSha256=hash(canonical(l.report));l.audit.reportSha256=l.manifest.reportSha256;}
  return group;
}
test('2023 private composition preserves both legislatures, re-election, adjustments and unavailable cells',()=>{
  const a=segment(2023,[1],56,[1,2]),b=segment(2023,all.slice(1),57,[1]);
  const v=buildExpenseAnnualCandidate([b,a],'2026-11-11T00:00:00Z');
  assert.deepEqual(v.segments.map(s=>s.snapshot.scope.legislature),[56,57]);
  assert.equal(v.publicationEligible,false);assert.equal(v.completeCalendarYear,true);
  assert.equal(v.perPerson.find(p=>p.personId===1)?.totalCents,975);
  assert.equal(v.totalCents,1075);assert.equal(v.recordCount,12);
  assert.equal(v.coverage[0].months[2].totalCents,null);
  assert.equal(v.coverage[1].months[1].status,'not-in-segment-universe');
  assert.equal(v.coverage[1].months[1].totalCents,null);
  assert.equal(v.segments[0].snapshot.people[0].party,'A');assert.equal(v.segments[1].snapshot.people[0].party,'B');
  assert.equal(v.id,buildExpenseAnnualCandidate([a,b],'2026-11-12T00:00:00Z').id);
});
test('annual composition rejects missing, overlapping and cross-year segments',()=>{
  const a=segment(2023,[1],56),b=segment(2023,all.slice(1),57);
  assert.throws(()=>buildExpenseAnnualCandidate([b],'t'),/incompleto/);
  assert.throws(()=>buildExpenseAnnualCandidate([a,a,b],'t'),/incompleto/);
  assert.throws(()=>buildExpenseAnnualCandidate([a,segment(2024,all.slice(1),57)],'t'),/divergente/);
});
test('partial 2026 requires explicit closed months and has no future zero cells',()=>{
  const months=all.slice(0,10),group=segment(2026,months,57);
  assert.throws(()=>buildExpenseAnnualCandidate([group],'t'),/encerrado|incompleto/);
  const v=buildExpenseAnnualCandidate([group],'t',months);
  assert.equal(v.completeCalendarYear,false);assert.equal(v.period.end,'2026-10-31');
  assert.equal(v.coverage[0].months.length,10);
});
test('matching report hashes cannot hide duplicated coverage, wrong years, scope or sums',()=>{
  let g=segment(2024,all,57);g.lots[0].report.cells[1]=structuredClone(g.lots[0].report.cells[0]);
  assert.throws(()=>buildExpenseVersion(reseal(g).lots,g.history,'t'),/incompletas ou repetidas/);
  g=segment(2024,all,57);g.lots[0].report.cells[0].year=2023;
  assert.throws(()=>buildExpenseVersion(reseal(g).lots,g.history,'t'),/fora da competência/);
  g=segment(2024,all,57);g.lots[0].report.scope={...g.lots[0].report.scope,year:2023};
  assert.throws(()=>buildExpenseVersion(reseal(g).lots,g.history,'t'),/Escopo/);
  g=segment(2024,all,57);g.lots[0].report.cells[0].totalCents=99;
  assert.throws(()=>buildExpenseVersion(reseal(g).lots,g.history,'t'),/Soma/);
});

test('private composition CLI exports deterministically, refuses tampered existing content and never creates a database',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-annual-cli-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const group=segment(2024,all,57),lot=group.lots[0];
  const write=async(folder:string,name:string,value:unknown)=>{await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,name),JSON.stringify(value));};
  const root=path.join(cwd,'data/private');
  await write(path.join(root,'people-history/history'),'history.json',group.history);
  for(const [file,value] of Object.entries({'run.json':lot.manifest,'input.json':lot.input,'batch.json':lot.report,'audit.json':lot.audit}))await write(path.join(root,'expense-intermediate',lot.runId),file,value);
  const script=fileURLToPath(new URL('../scripts/compose-expense-annual.ts',import.meta.url));
  const args=['--import',import.meta.resolve('tsx'),script,'--year','2024','--segment',`history:${lot.runId}`];
  const run=()=>promisify(execFile)(process.execPath,args,{cwd});
  const first=JSON.parse((await run()).stdout),bytes=await fs.readFile(first.file,'utf8');
  assert.equal(JSON.parse((await run()).stdout).id,first.id);assert.equal(await fs.readFile(first.file,'utf8'),bytes);
  const tampered=JSON.parse(bytes);tampered.totalCents++;
  await fs.writeFile(first.file,JSON.stringify(tampered));
  await assert.rejects(run(),e=>String((e as {stderr?:string}).stderr).includes('Candidato existente diverge'));
  assert.equal(JSON.parse(await fs.readFile(first.file,'utf8')).totalCents,tampered.totalCents);
  await assert.rejects(fs.stat(path.join(cwd,'data/local')),{code:'ENOENT'});
});
