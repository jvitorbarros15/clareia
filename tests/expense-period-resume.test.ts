import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonical,hash} from '../src/model.ts';
import {expensePeriod,parseExpensePeriodArgs} from '../src/expense-period.ts';

test('civil competences preserve January 2023 and the closed October 2026 cutoff',()=>{
  const today=new Date('2026-11-11T00:00:00Z');
  assert.deepEqual(expensePeriod(2023,[1],today),{start:'2023-01-01',end:'2023-01-31'});
  assert.deepEqual(expensePeriod(2023,[2,3,4,5,6,7,8,9,10,11,12],today),{start:'2023-02-01',end:'2023-12-31'});
  assert.deepEqual(expensePeriod(2026,[1,2,3,4,5,6,7,8,9,10],today),{start:'2026-01-01',end:'2026-10-31'});
  for(const months of [[],[1,1],[2,1],[1,3],[0],[13],[11],[12]])assert.throws(()=>expensePeriod(2026,months,today));
  assert.throws(()=>parseExpensePeriodArgs(['--year','2023','--year','2024']));
  assert.throws(()=>parseExpensePeriodArgs(['--year','2023','--months','1,,2']));
  assert.deepEqual(parseExpensePeriodArgs([]),{year:2025,months:[1,2,3,4,5,6,7,8,9,10,11,12]});
});

test('a financial resume with another year or month fails before key access or any write',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-period-resume-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const root=path.join(cwd,'data/private/expense-intermediate/preserved');
  await fs.mkdir(root,{recursive:true});
  const input={schema:'clareia.expense-lot-input.v1',proposal:{year:2023,months:[1],lot:0,lotSize:50}};
  const files={'input.json':JSON.stringify(input),'run.json':JSON.stringify({selectionRun:'selection',inputSha256:hash(canonical(input))}),'original.sealed':'immutable synthetic ciphertext'};
  for(const [name,body] of Object.entries(files))await fs.writeFile(path.join(root,name),body);
  const script=fileURLToPath(new URL('../scripts/collect-expense-intermediate.ts',import.meta.url));
  const tsx=import.meta.resolve('tsx');
  const env={...process.env};delete env.CLAREIA_VAULT_KEY;
  for(const flags of [['--year','2024','--months','1'],['--year','2023','--months','2']]){
    await assert.rejects(promisify(execFile)(process.execPath,['--import',tsx,script,'--selection-run','selection','--run','preserved','--lot','0',...flags],{cwd,env}),error=>{
      assert.match(String((error as {stderr?:string}).stderr),/Retomada incompatível/);return true;
    });
    assert.deepEqual((await fs.readdir(root)).sort(),Object.keys(files).sort());
    for(const [name,body] of Object.entries(files))assert.equal(await fs.readFile(path.join(root,name),'utf8'),body);
  }
});
