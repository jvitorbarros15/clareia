import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {portalDelay,resumePortalSample} from '../src/expense-portal-checkpoint.ts';
import type {PortalComparison} from '../src/expense-portal-checkpoint.ts';
import type {Competence} from '../src/expense-portal-sample.ts';

const run={versionId:'published-version',seed:'sample-seed',size:3,sample:[1,2,3].map(month=>({personId:1,month}))};
const result=(c:Competence):PortalComparison=>({...c,status:'matched',oursCents:100,oursRecords:1,portalCents:100,portalRows:1,categories:1,emptyCategories:0,failedCategories:[]});
async function folder(t:test.TestContext){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-portal-checkpoint-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('interrupted fake queries resume only pending months and preserve the final comparisons',async t=>{
  const dir=await folder(t),calls:number[]=[],logs:string[]=[];
  await assert.rejects(resumePortalSample(dir,run,async c=>{
    calls.push(c.month);
    if(c.month===2)throw Error('simulated interruption');
    return result(c);
  },line=>logs.push(line)),/simulated interruption/);
  assert.deepEqual(calls,[1,2]);
  assert.equal(logs.length,1);assert.match(logs[0],/1\/01: matched/);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));
  assert.deepEqual(saved.comparisons,[result(run.sample[0])]);
  calls.length=0;logs.length=0;
  const comparisons=await resumePortalSample(dir,run,async c=>{calls.push(c.month);return result(c);},line=>logs.push(line));
  assert.deepEqual(calls,[2,3]);assert.deepEqual(comparisons,run.sample.map(result));
  assert.match(logs[0],/retomado/);assert.equal(logs.length,3);
  assert.deepEqual(await resumePortalSample(dir,run,async()=>{throw Error('completed months must not query');},()=>{}),comparisons);
});

test('changed version, seed, size or sample cannot reuse a checkpoint',async t=>{
  const dir=await folder(t);
  await resumePortalSample(dir,run,async c=>result(c),()=>{});
  for(const changed of [{...run,versionId:'other'},{...run,seed:'other'},{...run,size:2},{...run,sample:[...run.sample].reverse()}]){
    await assert.rejects(resumePortalSample(dir,changed,async()=>{assert.fail('must validate before querying');},()=>{}),/incompatível/);
  }
});

test('malformed and out-of-order checkpoints fail before querying',async t=>{
  const dir=await folder(t),file=path.join(dir,'checkpoint.json');
  for(const content of ['{',JSON.stringify({schema:'clareia.expense-portal-checkpoint.v1',run,comparisons:[result(run.sample[1])]}),JSON.stringify({schema:'clareia.expense-portal-checkpoint.v1',run,comparisons:[{...result(run.sample[0]),status:'invalid'}]})]){
    await fs.writeFile(file,content);
    await assert.rejects(resumePortalSample(dir,run,async()=>{assert.fail('must validate before querying');},()=>{}));
  }
});

test('completed unavailable and mismatch results retain their status after resume',async t=>{
  const dir=await folder(t);
  const expected=run.sample.map((c,i):PortalComparison=>i===0?{...result(c),status:'portal-unavailable',portalCents:null,portalRows:null,failedCategories:['1']}:i===1?{...result(c),status:'mismatch',portalCents:101}:result(c));
  await resumePortalSample(dir,run,async c=>expected[c.month-1],()=>{});
  assert.deepEqual(await resumePortalSample(dir,run,async()=>{assert.fail('completed results must be preserved');},()=>{}),expected);
});

test('rejects a result with the correct deputy but the wrong month',async t=>{
  const dir=await folder(t),calls:Competence[]=[],logs:string[]=[];
  const mockCheck=async(c:Competence):Promise<PortalComparison>=>{
    calls.push(c);
    return {...result(c),month:c.month+1};
  };
  await assert.rejects(resumePortalSample(dir,run,mockCheck,line=>logs.push(line)),/Resultado fora da competência solicitada/);
  assert.deepEqual(calls,[run.sample[0]]);
  assert.deepEqual(logs,[]);
  await assert.rejects(fs.readFile(path.join(dir,'checkpoint.json'),'utf8'),{code:'ENOENT'});
});

test('rejects a result with the correct month but the wrong deputy',async t=>{
  const dir=await folder(t),calls:Competence[]=[],logs:string[]=[];
  const mockCheck=async(c:Competence):Promise<PortalComparison>=>{
    calls.push(c);
    return {...result(c),personId:c.personId+1};
  };
  await assert.rejects(resumePortalSample(dir,run,mockCheck,line=>logs.push(line)),/Resultado fora da competência solicitada/);
  assert.deepEqual(calls,[run.sample[0]]);
  assert.deepEqual(logs,[]);
  await assert.rejects(fs.readFile(path.join(dir,'checkpoint.json'),'utf8'),{code:'ENOENT'});
});

test('delay defaults to 700 ms and accepts only nonnegative safe integer milliseconds',()=>{
  assert.equal(portalDelay(undefined),700);assert.equal(portalDelay('0'),0);assert.equal(portalDelay('1500'),1500);
  for(const value of ['', ' ', '-1','0.5','NaN','Infinity','9007199254740992'])assert.throws(()=>portalDelay(value),/Intervalo inválido/);
});
