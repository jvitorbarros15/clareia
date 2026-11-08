import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {BASE,canonical,hash} from '../src/model.ts';
import {open} from '../src/vault.ts';
import {PeopleCapture,parseDiscoveryScope,sourceAllowed,inspectPeopleContract,listPeople,annualIdentityIndex,compareUniverse,inspectSample,discoverPeople} from '../src/people-discovery.ts';
import {auditPeopleDiscovery} from '../src/people-discovery-audit.ts';

const scope={legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]};
const historyFields=['id','idLegislatura','dataHora','situacao','condicaoEleitoral','siglaPartido','siglaUf','descricaoStatus'];
const contract=()=>({paths:Object.fromEntries(['/deputados','/deputados/{id}','/deputados/{id}/historico'].map(route=>[route,{get:{parameters:route==='/deputados'?['idLegislatura','dataInicio','dataFim','pagina','itens','ordem','ordenarPor'].map(name=>({name,in:'query'})):[],responses:{200:{}}}}])),components:{schemas:{DeputadoHistorico:{properties:Object.fromEntries(historyFields.map(name=>[name,{}]))}}}});
const csv=(lines:string[])=>zipSync({'Ano-2025.csv':strToU8('ideCadastro;numAno;numMes;codLegislatura;txtFornecedor\n'+lines.join('\n')+'\n')});
const event=(overrides:Record<string,unknown>={})=>({id:1,idLegislatura:57,dataHora:'2023-02-01T12:05',situacao:'Exercício',condicaoEleitoral:'Titular',siglaPartido:'PL',siglaUf:'SP',descricaoStatus:'Posse',...overrides});
const listUrl=(page=1)=>`${BASE}/deputados?idLegislatura=57&dataInicio=2025-01-01&dataFim=2025-12-31&itens=2&ordem=ASC&ordenarPor=id&pagina=${page}`;
async function temp(t:test.TestContext){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-people-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function cache(dir:string,replies:Map<string,unknown>){return new PeopleCapture(dir,randomBytes(32),async url=>{if(!replies.has(url))return new Response('',{status:404});const value=replies.get(url);return new Response(value instanceof Uint8Array?Buffer.from(value):JSON.stringify(value));},async()=>{});}

test('discovery scope validates calendar dates, future dates and sample uniqueness',()=>{
  assert.deepEqual(parseDiscoveryScope(scope,'2026-11-07'),scope);
  for(const bad of [{...scope,start:'2025-02-30'},{...scope,end:'2027-01-01'},{...scope,start:'2026-01-01'},{...scope,sampleIds:[1,1]}])assert.throws(()=>parseDiscoveryScope(bad,'2026-11-07'));
});
test('source allowlist excludes redirects, credentials, unrelated APIs and foreign annual URLs',()=>{
  assert.equal(sourceAllowed(BASE+'/deputados/1/historico'),true);
  for(const url of ['not-a-url','https://example.org/api/v2/deputados','http://dadosabertos.camara.leg.br/api/v2/deputados','https://x@dadosabertos.camara.leg.br/api/v2/deputados',BASE+'/proposicoes','https://www.camara.leg.br/cotas/Ano-2025.csv.zip?target=x'])assert.equal(sourceAllowed(url),false);
});
test('contract refuses missing temporal filters, missing history fields and new pagination',()=>{
  const valid=inspectPeopleContract(contract());assert.equal(valid.temporalAttributionEnabled,false);
  const missing=contract();missing.paths['/deputados'].get.parameters=[];assert.throws(()=>inspectPeopleContract(missing),/filtros/);
  const fields=contract();delete fields.components.schemas.DeputadoHistorico.properties.dataHora;assert.throws(()=>inspectPeopleContract(fields),/campos/);
  const changed=contract();changed.paths['/deputados/{id}/historico'].get.parameters=[{name:'pagina',in:'query'}];assert.throws(()=>inspectPeopleContract(changed),/paginado/);
});
test('raw captures are encrypted, hash-checked and resumed without another request',async t=>{
  const dir=await temp(t),key=randomBytes(32),url=BASE+'/deputados/1',plain=JSON.stringify({dados:{id:1,privateField:'must-remain-encrypted'}});let requests=0;
  const reader=new PeopleCapture(dir,key,async()=>{requests++;return new Response(plain);},async()=>{});
  const first=await reader.get(url);assert.equal(requests,1);
  const encrypted=await fs.readFile(path.join(dir,first.source.file));assert.equal(encrypted.includes(Buffer.from('must-remain-encrypted')),false);assert.equal(Buffer.from(open(encrypted,key)).toString(),plain);
  const resumed=new PeopleCapture(dir,key,async()=>{throw Error('should not fetch');},async()=>{});assert.equal(hash((await resumed.get(url)).bytes),first.source.sha256);
  await fs.writeFile(path.join(dir,first.source.file),Buffer.from('tampered'));
  await assert.rejects(resumed.get(url),/não sobrescrever/);
});
test('a missing encryption key fails before a network call',()=>{
  assert.throws(()=>new PeopleCapture('unused',Buffer.alloc(0)),/Chave/);
});
test('HTTP 429 respects Retry-After once and errors never include source response bodies',async t=>{
  const waits:number[]=[],dir=await temp(t);let count=0;
  const reader=new PeopleCapture(dir,randomBytes(32),async()=>++count===1?new Response('private body',{status:429,headers:{'Retry-After':'2'}}):new Response('{}'),async ms=>{waits.push(ms);});
  await reader.get(BASE+'/deputados/1');assert.deepEqual(waits,[2000]);
  const bad=new PeopleCapture(path.join(dir,'bad'),randomBytes(32),async()=>new Response('do-not-log',{status:403}),async()=>{});
  await assert.rejects(bad.get(BASE+'/deputados/1'),e=>e instanceof Error&&/HTTP 403/.test(e.message)&&!e.message.includes('do-not-log'));
});
test('historical pagination completes all pages and keeps more than 513 people',async t=>{
  const replies=new Map<string,unknown>();
  for(let page=1;page<=6;page++){
    const url=new URL(listUrl(page));url.searchParams.set('itens','100');
    const last=new URL(url);last.searchParams.set('pagina','6');
    const next=new URL(url);next.searchParams.set('pagina',String(page+1));
    replies.set(url.href,{dados:Array.from({length:page===6?14:100},(_,i)=>({id:(page-1)*100+i+1})),links:[{rel:'last',href:last.href},...(page<6?[{rel:'next',href:next.href}]:[])]});
  }
  const first=new URL(listUrl());first.searchParams.set('itens','100');
  assert.equal((await listPeople(first.href,cache(await temp(t),replies))).ids.length,514);
});
test('historical identity multiplicity is retained without assigning list party attributes',async t=>{
  const result=await listPeople(listUrl(),cache(await temp(t),new Map([[listUrl(),{dados:[{id:1,siglaPartido:'A'},{id:1,siglaPartido:'B'}],links:[{rel:'last',href:listUrl()}]}]])));
  assert.deepEqual(result,{ids:[1],rows:2,repeatedIds:[{id:1,rows:2}]});
});
test('pagination blocks missing final pages, new filters, external links and empty results',async t=>{
  const first=listUrl(),next=listUrl(2);
  const cases=[
    new Map([[first,{dados:[{id:1}],links:[{rel:'last',href:next}]}]]),
    new Map([[first,{dados:[{id:1}],links:[{rel:'next',href:next+'&siglaUf=SP'}]}]]),
    new Map([[first,{dados:[{id:1}],links:[{rel:'next',href:'https://example.org/?pagina=2'}]}]]),
    new Map([[first,{dados:[{id:1}],links:[{rel:'next',href:next}]}],[next,{dados:[{id:1}],links:[{rel:'last',href:next}]}]]),
    new Map([[first,{dados:[],links:[]}]]),
    new Map([[first,{dados:[{id:1},{id:2}],links:[]}]])
  ];
  for(let i=0;i<cases.length;i++)await assert.rejects(listPeople(first,cache(path.join(await temp(t),String(i)),cases[i])));
});
test('annual discovery retains financial-only IDs and flags invalid identities without publishing source names',async()=>{
  const result=await annualIdentityIndex(csv(['1;2025;1;57;private name','2;2025;2;57;private name',';2025;2;57;private name','3;2025;2;56;private name']),2025,scope);
  assert.deepEqual(result.people.map(p=>p.id),[1,2,3]);assert.equal(result.selected,4);assert.deepEqual(result.issues,[{row:2,reason:'invalid-person-id'},{row:3,reason:'legislature-mismatch'}]);assert.equal(JSON.stringify(result).includes('private name'),false);
  const candidates=compareUniverse([1],[1,4],[result]);
  assert.deepEqual(candidates.map(c=>[c.id,c.classification]),[[1,'historical-list'],[2,'financial-only'],[3,'financial-only'],[4,'legislature-only']]);
  const all=compareUniverse([1],[1,4],[result],[5]);assert.equal(all.find(c=>c.id===5)?.classification,'combined-list-only');
});
test('annual discovery respects monthly boundaries, rejects invalid schemas and never accepts an empty scope',async()=>{
  const archive=csv(['1;2025;1;57;X','2;2025;2;57;X','3;2025;3;57;X']);
  const result=await annualIdentityIndex(archive,2025,{...scope,start:'2025-02-10',end:'2025-02-20'});assert.deepEqual(result.people.map(p=>p.id),[2]);
  await assert.rejects(annualIdentityIndex(archive,2025,{...scope,start:'2025-04-01'}),/vazio/);
  await assert.rejects(annualIdentityIndex(zipSync({'Ano-2025.csv':strToU8('id\n1\n')}),2025,scope),/Contrato/);
  await assert.rejects(annualIdentityIndex(zipSync({'Ano-2025.csv':strToU8('ideCadastro;numAno;numMes;codLegislatura;ideCadastro\n1;2025;1;57;2\n')}),2025,scope),/Contrato/);
});
test('history inspection preserves original dates and flags disorder and anomalous legislatures without assigning affiliation',()=>{
  const history={dados:[event({idLegislatura:58}),event({dataHora:'2025-11-13T09:00',siglaPartido:'PSD',privateField:'do-not-publish'}),event()],links:[]};
  const result=inspectSample(1,{dados:{id:1,privateField:'do-not-publish'}},history,scope);
  assert.equal(result.events[1].dataHora,'2025-11-13T09:00');assert.equal(result.events[1].siglaPartido,'PSD');assert.equal(result.temporalAttributionEnabled,false);assert.ok(result.issues.includes('source-not-chronological'));assert.ok(result.issues.includes('later-legislature-event-before-scope-cutoff'));assert.equal(JSON.stringify(result).includes('do-not-publish'),false);
  assert.throws(()=>inspectSample(1,{dados:{id:2}},history,scope),/ID/);
  assert.throws(()=>inspectSample(1,{dados:{id:1}},{dados:[event({id:2})],links:[]},scope),/Identidade/);
  assert.throws(()=>inspectSample(1,{dados:{id:1}},{dados:[],links:[{rel:'next',href:BASE+'/deputados/1/historico?pagina=2'}]},scope),/paginação/);
});
test('end-to-end discovery and independent audit catch changed universe and financial coverage',async t=>{
  const period=new URL(BASE+'/deputados');for(const [k,v]of Object.entries({idLegislatura:'57',dataInicio:scope.start,dataFim:scope.end,itens:'100',ordem:'ASC',ordenarPor:'id',pagina:'1'}))period.searchParams.set(k,v);
  const combined=new URL(period);period.searchParams.delete('idLegislatura');
  const members=new URL(combined);members.searchParams.delete('dataInicio');members.searchParams.delete('dataFim');
  const archive=csv(['1;2025;1;57;private','2;2025;2;57;private']);
  const replies=new Map<string,unknown>([[BASE+'/api-docs',contract()],[period.href,{dados:[{id:1}],links:[]}],[combined.href,{dados:[{id:1},{id:3}],links:[]}],[members.href,{dados:[{id:1},{id:3}],links:[]}],['https://www.camara.leg.br/cotas/Ano-2025.csv.zip',archive]]);
  for(const id of [1,2]){replies.set(BASE+'/deputados/'+id,{dados:{id,privateField:'not-in-report',cpf:'12345678901'}});replies.set(BASE+'/deputados/'+id+'/historico',{dados:[event({id})],links:[]});}
  const key=randomBytes(32),dir=await temp(t),capture=new PeopleCapture(dir,key,async url=>{const data=replies.get(url);assert.notEqual(data,undefined);return new Response(data instanceof Uint8Array?Buffer.from(data):JSON.stringify(data));},async()=>{});
  const report=await discoverPeople(scope,capture);
  assert.equal(report.status,'discovery-only');assert.equal(report.candidates.length,3);assert.deepEqual(report.samples.map(s=>s.id),[1,2]);assert.equal(JSON.stringify(report).includes('not-in-report'),false);
  assert.deepEqual(report.sets.period,[1]);assert.deepEqual(report.sets.combined,[1,3]);
  const read=async(source:{file:string})=>open(await fs.readFile(path.join(dir,source.file)),key);
  const audit=await auditPeopleDiscovery(report,read);assert.equal(audit.status,'passed');assert.equal(audit.reportSha256,hash(canonical(report)));
  const edited=structuredClone(report);edited.candidates.pop();assert.equal((await auditPeopleDiscovery(edited,read)).status,'failed');
  const rows=structuredClone(report);rows.annuals[0].people[0].rows++;assert.equal((await auditPeopleDiscovery(rows,read)).status,'failed');
  const coverage=structuredClone(report);coverage.annuals=[];assert.equal((await auditPeopleDiscovery(coverage,read)).status,'failed');
  const multiplicity=structuredClone(report);multiplicity.listRows.period.rows++;assert.equal((await auditPeopleDiscovery(multiplicity,read)).status,'failed');
  const sampleEvents=structuredClone(report);sampleEvents.samples[0].events[0].siglaPartido='XX';assert.ok((await auditPeopleDiscovery(sampleEvents,read)).failures.includes('sample-events-1'));
  const sampleIssues=structuredClone(report);sampleIssues.samples[0].issues.push('later-legislature-event-before-scope-cutoff');assert.ok((await auditPeopleDiscovery(sampleIssues,read)).failures.includes('sample-issues-1'));
  const leak=structuredClone(report);leak.limitations.push('12345678901');assert.ok((await auditPeopleDiscovery(leak,read)).failures.includes('private-identifier-in-report'));
  const missing=structuredClone(report);missing.sources=missing.sources.filter(s=>s.url!==period.href);missing.sets.period=[];missing.listRows.period={rows:0,repeatedIds:[]};assert.ok((await auditPeopleDiscovery(missing,read)).failures.includes('list-pagination-period'));
});
