import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import type {AddressInfo} from 'node:net';
import {createApp} from '../src/app.ts';
import {lock} from '../src/lock.ts';
import {maskPersonalId,readLimited,snapshotId} from '../src/model.ts';
import {csv,parseFilters} from '../src/view.ts';
import type {Snapshot,Expense} from '../src/model.ts';

function version(cents:number):Snapshot{
  const record={id:'r'+cents,personId:1,year:2025,month:1,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:0,fetchedAt:'2025-03-01T00:00:00Z'}} as Expense;
  const body={metric:'camara.ceap.valor-liquido-arquivo-anual.v1',scope:{year:2025,months:[1,2],ids:[1],legislature:57},people:[{id:1,name:'Pessoa'}],records:[record],collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{sourceKind:'annual-csv',stablePasses:2,recordCount:1,totalCents:cents,independentTotalCents:String(cents),duplicatePolicy:'x',limitations:[]}} as unknown as Snapshot;
  return {...body,id:snapshotId(body)};
}
async function serving<T>(root:string,fn:(base:string,port:number)=>Promise<T>){
  const server=createApp(root,0);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as AddressInfo).port;
  try{return await fn(`http://127.0.0.1:${port}`,port);}finally{await new Promise(r=>server.close(r));}
}
const rawGet=(port:number,target:string)=>new Promise<string>((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));let out='';s.on('data',d=>out+=d);s.on('end',()=>resolve(out));s.on('error',reject);});

test('the static server answers bad requests, stays inside its folder and hides _headers',async()=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-static-')),root=path.join(parent,'dist');
  await fs.mkdir(root);await fs.writeFile(path.join(root,'index.html'),'ok');await fs.writeFile(path.join(root,'_headers'),'/*\n  X-Test: 1\n');await fs.writeFile(path.join(parent,'secret.txt'),'x');
  try{await serving(root,async(base,port)=>{
    assert.match(await rawGet(port,'//'),/^HTTP\/1\.1 (400|404)/);
    const home=await fetch(base+'/');assert.equal(home.status,200);assert.equal(home.headers.get('x-test'),'1');
    assert.match(await rawGet(port,'/../secret.txt'),/^HTTP\/1\.1 404/);assert.match(await rawGet(port,'/%2e%2e/secret.txt'),/^HTTP\/1\.1 404/);
    assert.equal((await fetch(base+'/_headers')).status,404);assert.equal((await fetch(base+'/index.html',{method:'POST'})).status,405);
  });}finally{await fs.rm(parent,{recursive:true,force:true});}
});
test('a lock owned by a dead process is taken over; a live owner keeps it',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-lock-')),file=path.join(dir,'pilot.lock');
  try{
    const child=spawn(process.execPath,['-e','']);const pid=child.pid;await new Promise(r=>child.on('exit',r));
    await fs.writeFile(file,JSON.stringify({pid}));const release=await lock(file);await assert.rejects(lock(file),/Outra tarefa/);await release();
    await fs.writeFile(file,'not json');await assert.rejects(lock(file),/Outra tarefa/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('oversized responses stop while streaming, before the whole body is held',async()=>{
  let pulled=0;const big=new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array(1024));if(pulled>1000)c.close();}});
  await assert.rejects(readLimited(new Response(big),4096),/excede limite/);assert.ok(pulled<20);
  await assert.rejects(readLimited(new Response('x',{headers:{'content-length':'999999'}}),10),/excede limite/);
  assert.equal((await readLimited(new Response('abc'),10)).length,3);
});
test('CPF inside a supplier name is masked; CNPJ and ordinary numbers stay',()=>{
  assert.equal(maskPersonalId('JOAO DA SILVA 12345678900'),'JOAO DA SILVA [CPF oculto]');
  assert.equal(maskPersonalId('MARIA 123.456.789-00 ME'),'MARIA [CPF oculto] ME');
  for(const safe of ['EMPRESA 12.345.678/0001-90','ACME 12345678000190','LOJA 123','FONE 6133334444'])assert.equal(maskPersonalId(safe),safe);
});
test('filters accept digits only and CSV neutralizes formulas behind leading whitespace',()=>{
  const s=version(100);
  assert.throws(()=>parseFilters(new URLSearchParams('from=0x1'),{...s,scope:{...s.scope,months:[1,2]}}));assert.throws(()=>parseFilters(new URLSearchParams('person=1e0'),s));
  assert.match(csv([{...s.records[0],supplier:' =HYPERLINK("x")'}]),/' =HYPERLINK/);assert.match(csv([{...s.records[0],supplier:'\n=cmd'}]),/'\n=cmd/);
});
