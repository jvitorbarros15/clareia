import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import type {AddressInfo} from 'node:net';
import {openDB,publish,recordAudit,servedSnapshot} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {createApp} from '../src/app.ts';
import {lock} from '../src/lock.ts';
import {maskPersonalId,readLimited,snapshotId} from '../src/model.ts';
import {csv,parseFilters} from '../src/queries.ts';
import type {Snapshot,Expense} from '../src/model.ts';

function version(cents:number):Snapshot{
  const record={id:'r'+cents,personId:1,year:2025,month:1,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:0,fetchedAt:'2025-03-01T00:00:00Z'}} as Expense;
  const body={metric:'camara.ceap.valor-liquido-arquivo-anual.v1',scope:{year:2025,months:[1,2],ids:[1],legislature:57},people:[{id:1,name:'Pessoa'}],records:[record],collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{sourceKind:'annual-csv',stablePasses:2,recordCount:1,totalCents:cents,independentTotalCents:String(cents),duplicatePolicy:'x',limitations:[]}} as unknown as Snapshot;
  return {...body,id:snapshotId(body)};
}
const audit=(snapshot:Snapshot,status:'passed'|'failed',checkedAt='2025-03-02T00:00:00Z')=>({snapshotId:snapshot.id,status,checkedAt});
async function serving<T>(db:DB,fn:(base:string,port:number)=>Promise<T>){
  const server=createApp(db,0);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as AddressInfo).port;
  try{return await fn(`http://127.0.0.1:${port}`,port);}finally{await new Promise(r=>server.close(r));}
}
const rawGet=(port:number,target:string)=>new Promise<string>((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));let out='';s.on('data',d=>out+=d);s.on('end',()=>resolve(out));s.on('error',reject);});

test('a malformed request target gets 400 and the server keeps answering',async()=>{
  const db=await openDB(true);
  try{await serving(db,async(base,port)=>{
    assert.match(await rawGet(port,'//'),/^HTTP\/1\.1 400/);
    assert.equal((await fetch(base+'/api/status')).status,200);
    assert.equal((await fetch(base+'/portraits/999.jpg')).status,404);
  });}finally{await db.close();}
});
test('only versions with a passing audit are served; an unaudited or failed one is never reachable, even by id',async()=>{
  const db=await openDB(true),a=version(100),b=version(200);
  try{
    await publish(db,a);assert.equal(await servedSnapshot(db),null);assert.equal(await servedSnapshot(db,a.id),null);
    await recordAudit(db,audit(a,'passed'));assert.equal((await servedSnapshot(db))?.snapshot.id,a.id);
    await publish(db,b);
    const stillA=await servedSnapshot(db);assert.equal(stillA?.snapshot.id,a.id);assert.equal(stillA?.current,true);assert.equal(await servedSnapshot(db,b.id),null);
    await recordAudit(db,audit(b,'failed'));assert.equal(await servedSnapshot(db,b.id),null);assert.equal((await servedSnapshot(db))?.snapshot.id,a.id);
    await recordAudit(db,audit(b,'passed','2025-03-03T00:00:00Z'));assert.equal((await servedSnapshot(db))?.snapshot.id,b.id);
    const pinned=await servedSnapshot(db,a.id);assert.equal(pinned?.snapshot.id,a.id);assert.equal(pinned?.current,false);
    await recordAudit(db,audit(a,'failed','2025-03-04T00:00:00Z'));assert.equal(await servedSnapshot(db,a.id),null);
    await serving(db,async base=>{
      assert.equal((await fetch(`${base}/api/spending?snapshot=${a.id}`)).status,503);assert.equal((await fetch(`${base}/api/export?snapshot=${a.id}`)).status,503);
      const body=await (await fetch(base+'/api/spending')).json();assert.equal(body.snapshotId,b.id);assert.equal(body.current,true);assert.equal(body.externalReconciliation.status,'passed');
    });
  }finally{await db.close();}
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
