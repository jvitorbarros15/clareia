import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {BASE,canonical,hash} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import type {DiscoveryReport} from '../src/people-discovery.ts';
import {collectHistory,readAuditedPeopleDiscovery} from '../src/people-history.ts';
import {deriveTemporalHistory} from '../src/people-temporal.ts';
import {auditTemporalHistory} from '../src/people-temporal-audit.ts';
import {open} from '../src/vault.ts';

const scope={legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]};
const historyEvent=(id:number,overrides:Record<string,unknown>={})=>({id,idLegislatura:57,dataHora:'2023-02-01T12:05',situacao:'Exercício',condicaoEleitoral:'Titular',siglaPartido:'PL',siglaUf:'SP',descricaoStatus:'Posse',...overrides});
const sourceContract={paths:Object.fromEntries(['/deputados','/deputados/{id}','/deputados/{id}/historico'].map(route=>[route,{get:{parameters:route==='/deputados'?['idLegislatura','dataInicio','dataFim','pagina','itens','ordem','ordenarPor'].map(name=>({name,in:'query'})):[],responses:{200:{}}}}])),components:{schemas:{DeputadoHistorico:{properties:Object.fromEntries(Object.keys(historyEvent(1)).map(name=>[name,{}]))}}}};
function discovery(ids=[1,2]):DiscoveryReport{return {schema:'clareia.people-discovery.v1',scope,candidates:ids.map(id=>({id}))} as DiscoveryReport;}
async function setup(t:test.TestContext,change?:(url:string,pass:number)=>unknown){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-history-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const key=randomBytes(32);
  const fetcher=(pass:number)=>async(url:string)=>{
    const changed=change?.(url,pass);if(changed!==undefined)return changed===null?new Response('',{status:404}):new Response(JSON.stringify(changed));
    let body:unknown;
    if(url.endsWith('/api-docs'))body=sourceContract;
    else if(url.endsWith('/legislaturas/57'))body={dados:{id:57,dataInicio:'2023-02-01',dataFim:'2027-01-31'}};
    else if(url.endsWith('/codSituacao'))body={dados:[{sigla:'E',nome:'Exercício'},{sigla:'L',nome:'Licença'}]};
    else {const id=Number(/deputados\/(\d+)/.exec(url)?.[1]);body=url.endsWith('/historico')?{dados:[historyEvent(id)],links:[]}:{dados:{id,cpf:'not-for-report',ultimoStatus:{nome:'Pessoa '+id,urlFoto:'https://www.camara.leg.br/photo.jpg'}}};}
    return new Response(JSON.stringify(body));
  };
  return {one:new PeopleCapture(path.join(directory,'pass-1'),key,fetcher(1),async()=>{}),two:new PeopleCapture(path.join(directory,'pass-2'),key,fetcher(2),async()=>{}),read:async(source:{pass:number;file:string})=>open(await fs.readFile(path.join(directory,'pass-'+source.pass,source.file)),key)};
}
test('history collection covers every candidate in two distinct encrypted passes and strips private fields',async t=>{
  const {one,two}=await setup(t);const report=await collectHistory(discovery(),one,two,{wait:async()=>{}});
  assert.deepEqual(report.coverage,{expected:2,stable:2,changed:0,failed:0});assert.equal(report.status,'review-required');assert.equal(report.dateMeaning,'reported-change-not-independently-confirmed');assert.equal(JSON.stringify(report).includes('not-for-report'),false);assert.equal(report.people[0].sources.length,2);assert.equal(report.people[0].sources[1].pass,2);
});
test('history order is not semantic but changes in party and multiplicity retain the person for review',async t=>{
  const {one,two}=await setup(t,(url,pass)=>url.endsWith('/historico')?{dados:pass===1?[historyEvent(1),historyEvent(1,{dataHora:'2024-01-01T00:00',siglaPartido:'B'})]:[historyEvent(1,{dataHora:'2024-01-01T00:00',siglaPartido:'B'}),historyEvent(1)],links:[]}:undefined);
  const same=await collectHistory(discovery([1]),one,two,{wait:async()=>{}});assert.equal(same.people[0].status,'stable');
  const changed=await setup(t,(url,pass)=>url.endsWith('/historico')?{dados:[historyEvent(1,{siglaPartido:pass===1?'A':'B'})],links:[]}:undefined);
  const report=await collectHistory(discovery([1]),changed.one,changed.two,{wait:async()=>{}});assert.equal(report.people[0].status,'changed');assert.ok(report.people[0].issues.includes('history-changed-between-passes'));
  const duplicates=await setup(t,(url,pass)=>url.endsWith('/historico')?{dados:Array.from({length:pass},()=>historyEvent(1)),links:[]}:undefined);
  assert.equal((await collectHistory(discovery([1]),duplicates.one,duplicates.two,{wait:async()=>{}})).people[0].status,'changed');
});
test('one failed identity or missing history never becomes an empty successful person and does not discard other candidates',async t=>{
  const {one,two}=await setup(t,(url,pass)=>url===BASE+'/deputados/1'&&pass===1?{dados:{id:999,ultimoStatus:{nome:'Wrong',urlFoto:null}}}:undefined);
  const report=await collectHistory(discovery(),one,two,{wait:async()=>{}});assert.equal(report.people[0].status,'failed');assert.equal(report.people[1].status,'stable');assert.equal(report.coverage.expected,2);
  const missing=await setup(t,url=>url.endsWith('/1/historico')?null:undefined);
  const failed=await collectHistory(discovery([1]),missing.one,missing.two,{wait:async()=>{}});assert.equal(failed.people[0].status,'failed');assert.equal(failed.coverage.stable,0);
});
test('source pagination in history, missing references and a cross-legislature scope stop or retain collection',async t=>{
  const paged=await setup(t,url=>url.endsWith('/historico')?{dados:[historyEvent(1)],links:[{rel:'next',href:BASE+'/deputados/1/historico?pagina=2'}]}:undefined);
  const report=await collectHistory(discovery([1]),paged.one,paged.two,{wait:async()=>{}});assert.equal(report.people[0].status,'failed');
  const bad=await setup(t,url=>url.endsWith('/codSituacao')?{dados:[]}:undefined);await assert.rejects(collectHistory(discovery([1]),bad.one,bad.two),/situações/);
  const normal=await setup(t);await assert.rejects(collectHistory({...discovery([1]),scope:{...scope,end:'2028-01-01'}},normal.one,normal.two),/Período/);
  await assert.rejects(collectHistory(discovery([1]),normal.one,normal.two,{workers:99}),/Concorrência/);
  const invalidDate=await setup(t,url=>url.endsWith('/legislaturas/57')?{dados:{id:57,dataInicio:'2023-02-30',dataFim:'2027-01-31'}}:undefined);await assert.rejects(collectHistory(discovery([1]),invalidDate.one,invalidDate.two),/Datas/);
});
test('a personal identifier in an allowed text field blocks plaintext history output',async t=>{
  const captured=await setup(t,url=>url===BASE+'/deputados/1'?{dados:{id:1,cpf:'12345678901',ultimoStatus:{nome:'Pessoa 12345678901',urlFoto:null}}}:undefined);
  await assert.rejects(collectHistory(discovery([1]),captured.one,captured.two,{wait:async()=>{}}),/Identificador privado/);
});
test('independent temporal audit checks raw events, monthly affiliations, evidence and publication gate',async t=>{
  const captured=await setup(t,url=>url.endsWith('/historico')?{dados:[historyEvent(Number(/deputados\/(\d+)/.exec(url)![1])),historyEvent(Number(/deputados\/(\d+)/.exec(url)![1]),{dataHora:'2025-11-13T09:00',siglaPartido:'PSD'})],links:[]}:undefined);
  const history=await collectHistory(discovery(),captured.one,captured.two,{wait:async()=>{}}),temporal=deriveTemporalHistory(history);
  assert.equal((await auditTemporalHistory(history,temporal,captured.read,discovery())).status,'passed');
  const wrong=structuredClone(temporal);wrong.people[0].months[10].party={status:'single',value:'PSD',values:['PSD'],rows:[1]};assert.ok((await auditTemporalHistory(history,wrong,captured.read,discovery())).failures.some(f=>f.code==='monthly-coverage-or-affiliation'));
  const evidence=structuredClone(temporal);evidence.people[0].intervals[0].party.rows=[999];assert.ok((await auditTemporalHistory(history,evidence,captured.read,discovery())).failures.some(f=>f.code==='interval-state-or-evidence'));
  const raw=structuredClone(history);raw.people[0].events[0].siglaPartido='FAKE';const rawResolved=deriveTemporalHistory(raw);assert.ok((await auditTemporalHistory(raw,rawResolved,captured.read,discovery())).failures.some(f=>f.code==='normalized-history-events'));
  const missing=structuredClone(temporal);missing.people.pop();assert.equal((await auditTemporalHistory(history,missing,captured.read,discovery())).status,'failed');
  const publish=structuredClone(temporal);Object.assign(publish,{publicAttributionEnabled:true});assert.ok((await auditTemporalHistory(history,publish,captured.read,discovery())).failures.some(f=>f.code==='unapproved-public-attribution'));
  const partial=structuredClone(history);partial.people.pop();partial.coverage.expected--;partial.coverage.stable--;assert.ok((await auditTemporalHistory(partial,deriveTemporalHistory(partial),captured.read,discovery())).failures.some(f=>f.code==='person-coverage'));
  const otherDiscovery=discovery([1]);assert.ok((await auditTemporalHistory(history,temporal,captured.read,otherDiscovery)).failures.some(f=>f.code==='discovery-version-or-scope'));
});
test('CLI refuses a different discovery without overwriting the existing history run manifest',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-history-cli-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const d=discovery([1]),discoveryDir=path.join(cwd,'data/private/people-discovery/test-discovery'),historyDir=path.join(cwd,'data/private/people-history/test-history');
  await fs.mkdir(discoveryDir,{recursive:true});await fs.mkdir(historyDir,{recursive:true});
  await fs.writeFile(path.join(discoveryDir,'discovery.json'),JSON.stringify(d));await fs.writeFile(path.join(discoveryDir,'audit.json'),JSON.stringify({schema:'clareia.people-discovery-audit.v1',status:'passed',reportSha256:hash(canonical(d))}));
  await fs.writeFile(path.join(discoveryDir,'../local-vault-key'),randomBytes(32));
  const original=Buffer.from(JSON.stringify({runId:'test-history',discoverySha256:hash('another-discovery'),status:'collected',scope:{preserve:true}}));
  await fs.writeFile(path.join(historyDir,'run.json'),original);
  const script=fileURLToPath(new URL('../scripts/collect-people-history.ts',import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath,['--import',import.meta.resolve('tsx'),script,'--local','--discovery-run','test-discovery','--run','test-history'],{cwd}));
  assert.deepEqual(await fs.readFile(path.join(historyDir,'run.json')),original);await assert.rejects(fs.stat(path.join(historyDir,'running.lock')),{code:'ENOENT'});
});
test('discovery loader pins an approved archived version and refuses missing or mismatched audits',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-approved-discovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'test-run'),reports=path.join(folder,'reports');await fs.mkdir(reports,{recursive:true});
  const old=discovery([1]),current=discovery([1,2]),oldHash=hash(canonical(old)),currentHash=hash(canonical(current));
  const audit=(version:string)=>({schema:'clareia.people-discovery-audit.v1',status:'passed',reportSha256:version});
  await fs.writeFile(path.join(folder,'discovery.json'),JSON.stringify(current));await fs.writeFile(path.join(folder,'audit.json'),JSON.stringify(audit(currentHash)));
  await fs.writeFile(path.join(reports,oldHash+'.json'),JSON.stringify(old));await fs.writeFile(path.join(reports,oldHash+'.audit.json'),JSON.stringify(audit(oldHash)));
  assert.deepEqual(await readAuditedPeopleDiscovery('test-run',undefined,root),current);assert.deepEqual(await readAuditedPeopleDiscovery('test-run',oldHash,root),old);
  await fs.writeFile(path.join(reports,oldHash+'.audit.json'),JSON.stringify(audit(currentHash)));await assert.rejects(readAuditedPeopleDiscovery('test-run',oldHash,root),/auditoria/);
  await fs.unlink(path.join(reports,oldHash+'.audit.json'));await assert.rejects(readAuditedPeopleDiscovery('test-run',oldHash,root),{code:'ENOENT'});
});
test('resolver takes the run lock before attempting to read the mutable input manifests',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-resolver-lock-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const historyDir=path.join(cwd,'data/private/people-history/locked-run'),keys=path.join(cwd,'data/private/people-discovery');await fs.mkdir(historyDir,{recursive:true});await fs.mkdir(keys,{recursive:true});
  await fs.writeFile(path.join(keys,'local-vault-key'),randomBytes(32));await fs.writeFile(path.join(historyDir,'running.lock'),'keep');
  const script=fileURLToPath(new URL('../scripts/resolve-people-history.ts',import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath,['--import',import.meta.resolve('tsx'),script,'--local','--run','locked-run'],{cwd}),e=>typeof e==='object'&&e!==null&&'stderr' in e&&String(e.stderr).includes('EEXIST'));
  assert.equal(await fs.readFile(path.join(historyDir,'running.lock'),'utf8'),'keep');
});
