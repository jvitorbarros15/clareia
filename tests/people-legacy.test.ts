import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {canonical,hash} from '../src/model.ts';
import {PeopleCapture,sourceAllowed} from '../src/people-discovery.ts';
import type {DiscoveryReport} from '../src/people-discovery.ts';
import type {HistoryReport,HistoryEvent} from '../src/people-history.ts';
import {deriveTemporalHistory} from '../src/people-temporal.ts';
import {collectLegacy,compareLegacy,inspectLegacy,legacyDay,legacyUrl,safeLegacyXml} from '../src/people-legacy.ts';
import {auditLegacy} from '../src/people-legacy-audit.ts';
import {open} from '../src/vault.ts';
import {proposeIntermediate} from '../src/people-intermediate.ts';

const scope={legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]};
const event=(id:number,overrides:Partial<HistoryEvent>={}):HistoryEvent=>({id,idLegislatura:57,dataHora:'2023-02-01T00:00:00',situacao:'Exercício',condicaoEleitoral:'Titular',siglaPartido:'PL',siglaUf:'SP',descricaoStatus:'Posse',...overrides});
const discovery=()=>({schema:'clareia.people-discovery.v1',scope,candidates:[{id:1},{id:2}]} as DiscoveryReport);
const source={url:'https://example.invalid',sha256:'a'.repeat(64),file:'x.sealed',fetchedAt:'2026-11-08T12:00:00Z',bytes:1,pass:1 as const};
function history():HistoryReport{
  const people=[1,2].map(id=>({id,profile:null,status:'stable' as const,sources:[],issues:[],events:[event(id),event(id,{dataHora:'2025-11-13T09:00',siglaPartido:'PSD'})]}));
  return {schema:'clareia.people-history.v1',discoverySha256:hash(canonical(discovery())),scope,createdAt:'2026-11-08T12:00:00Z',ruleVersion:'camara.history-reported-change.v1',status:'review-required',dateMeaning:'reported-change-not-independently-confirmed',legislature:{id:57,start:'2023-02-01',end:'2027-01-31',source},references:{states:[{sigla:'Exercício',nome:'Exercício'}],source},people,sources:[],coverage:{expected:2,stable:2,changed:0,failed:0}};
}
const period=(start='01/02/2023',end='',kind='Titular')=>`<periodoExercicio><siglaUFRepresentacao>SP</siglaUFRepresentacao><situacaoExercicio>${kind}</situacaoExercicio><dataInicio>${start}</dataInicio><dataFim>${end}</dataFim><idCausaFimExercicio/><descricaoCausaFimExercicio/><idCadastroParlamentarAnterior/></periodoExercicio>`;
const affiliation=(time='09:11:00')=>`<filiacaoPartidaria><idPartidoAnterior>PL</idPartidoAnterior><siglaPartidoAnterior>PL</siglaPartidoAnterior><nomePartidoAnterior>Liberal</nomePartidoAnterior><idPartidoPosterior>PSD</idPartidoPosterior><siglaPartidoPosterior>PSD</siglaPartidoPosterior><nomePartidoPosterior>Social</nomePartidoPosterior><dataFiliacaoPartidoPosterior>13/11/2025</dataFiliacaoPartidoPosterior><horaFiliacaoPartidoPosterior>${time}</horaFiliacaoPartidoPosterior></filiacaoPartidaria>`;
const xml=(id=1,periods=period(),parties=affiliation(),extra='')=>`<?xml version="1.0" encoding="utf-8"?><Deputados><Deputado><ideCadastro>${id}</ideCadastro><numLegislatura>57</numLegislatura><email>private@example.org</email>${extra}<periodosExercicio>${periods}</periodosExercicio><filiacoesPartidarias>${parties}</filiacoesPartidarias></Deputado></Deputados>`;
const bytes=(text:string)=>new TextEncoder().encode(text);
async function setup(t:test.TestContext,reply:(id:number,pass:number)=>string|Response=(id)=>xml(id)){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-legacy-')),key=randomBytes(32);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const capture=(pass:number)=>new PeopleCapture(path.join(dir,'pass-'+pass),key,async(url,init)=>{
    assert.match(String((init?.headers as Record<string,string>).Accept),/xml/);assert.equal(init?.redirect,'error');
    const result=reply(Number(new URL(url).searchParams.get('ideCadastro')),pass);return result instanceof Response?result:new Response(result);
  },async()=>{});
  const first=capture(1),second=capture(2),h=history(),d=discovery(),temporal=deriveTemporalHistory(h);
  const legacy=await collectLegacy(d,h,first,second,{wait:async()=>{}}),cross=compareLegacy(legacy,h,temporal);
  const read=async(s:{pass:number;file:string})=>open(await fs.readFile(path.join(dir,'pass-'+s.pass,s.file)),key);
  return {dir,key,legacy,cross,h,d,temporal,read,first,second};
}

test('legacy URL contract accepts only exact official endpoint and two unique positive numeric parameters',()=>{
  assert.equal(sourceAllowed(legacyUrl(1,57)),true);
  for(const url of [legacyUrl(1,57)+'&ideCadastro=2',legacyUrl(1,57)+'&extra=x',legacyUrl(1,57)+'#x',legacyUrl(1,57).replace('https:','http:'),legacyUrl(1,57).replace('ideCadastro=1','ideCadastro=0'),legacyUrl(1,57).replace('www.camara.leg.br','example.org'),legacyUrl(1,57).replace('Deputados.asmx/','Other.asmx/')])assert.equal(sourceAllowed(url),false,url);
});
test('XML syntax rejects DTD, entities, malformed XML and encoding errors without leaking source text',()=>{
  for(const value of ['<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]>'+xml(),xml().replace('Liberal','&unresolved;'),xml().replace('</Deputados>',''),'<private@example.org>'])assert.throws(()=>safeLegacyXml(bytes(value)),e=>e instanceof Error&&e.message==='XML histórico inválido ou não permitido');
  assert.throws(()=>safeLegacyXml(Uint8Array.of(255,254,255)));
  assert.equal(safeLegacyXml(bytes(xml().replace('Liberal','A &amp; B'))).Deputados.Deputado.filiacoesPartidarias.filiacaoPartidaria.nomePartidoAnterior,'A & B');
});
test('legacy projection validates IDs, legislature, required blocks, dates, fields and multiplicities',()=>{
  const result=inspectLegacy(1,57,bytes(xml(1,period()+period())));assert.equal(result.periods.length,2);assert.equal(JSON.stringify(result).includes('private@example.org'),false);
  assert.deepEqual(inspectLegacy(1,57,bytes(xml().replaceAll('><','>\n  <'))),inspectLegacy(1,57,bytes(xml())));
  assert.deepEqual(inspectLegacy(1,57,bytes(xml(1,'',''))).periods,[]);
  for(const value of [xml(2),xml().replace('<numLegislatura>57','<numLegislatura>58'),xml().replace('<dataInicio>01/02/2023','<dataInicio>30/02/2023'),xml(1,period('10/01/2025','01/01/2025')),xml().replace('<dataInicio>01/02/2023</dataInicio>','<dataInicio>01/02/2023</dataInicio><dataInicio>02/02/2023</dataInicio>'),xml().replace('<idCausaFimExercicio/>','<newField/><idCausaFimExercicio/>'),xml().replace('<periodosExercicio>','<missingBlock>'),xml().replace('<siglaUFRepresentacao>SP','<siglaUFRepresentacao>ZZ'),xml().replace('<horaFiliacaoPartidoPosterior>09:11:00','<horaFiliacaoPartidoPosterior>25:00:00')])assert.throws(()=>inspectLegacy(1,57,bytes(value)));
  assert.equal(legacyDay('29/02/2024'),'2024-02-29');assert.equal(legacyDay('29/02/2025'),null);
});
test('two encrypted passes preserve stable fields, ignore row ordering and retain failed people',async t=>{
  const r=await setup(t,(id,pass)=>id===2?new Response('private@example.org',{status:404}):xml(id,pass===1?period()+period('01/01/2024','01/02/2024','Suplente'):period('01/01/2024','01/02/2024','Suplente')+period()));
  assert.deepEqual(r.legacy.people.map(p=>p.status),['stable','failed']);assert.equal(r.cross.people[1].months[0].comparison,'unavailable');
  const encrypted=await fs.readFile(path.join(r.dir,'pass-1',r.legacy.people[0].sources[0].file));assert.equal(encrypted.includes(Buffer.from('private@example.org')),false);
  assert.equal((await auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,r.read)).status,'passed');
  const noNetwork=new PeopleCapture(path.join(r.dir,'pass-1'),r.key,async()=>{throw Error('network forbidden');});assert.equal(hash((await noNetwork.get(legacyUrl(1,57))).bytes),r.legacy.people[0].sources[0].sha256);
});
test('changed exercise, affiliation and duplicate count between passes prevent use for crosscheck',async t=>{
  for(const change of [(id:number,p:number)=>xml(id,p===1?period():period()+period()),(id:number,p:number)=>xml(id,period(),affiliation(p===1?'09:11:00':'10:11:00'))]){
    const r=await setup(t,change);assert.equal(r.legacy.people[0].status,'changed');assert.equal(r.cross.people[0].months[0].legacy,'unknown');assert.equal((await auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,r.read)).status,'passed');
  }
});
test('month comparisons keep boundary days, open ends and unknown exercise separate without filling gaps',async t=>{
  const r=await setup(t,id=>xml(id,period('31/01/2025','01/02/2025')));
  assert.equal(r.cross.people[0].months[0].legacy,'boundary-only');assert.equal(r.cross.people[0].months[1].legacy,'boundary-only');assert.equal(r.cross.people[0].months[2].legacy,'no-listed-period');
  const h=structuredClone(r.h);h.people[0].events=h.people[0].events.map(e=>({...e,situacao:'CONVOCADO'}));h.references.states.push({nome:'Convocado',sigla:'CONVOCADO'});
  const temporal=deriveTemporalHistory(h),legacy=structuredClone(r.legacy);legacy.historySha256=hash(canonical(h));const cross=compareLegacy(legacy,h,temporal);
  assert.equal(cross.people[0].months[0].comparison,'no-automatic-resolution');
  const open=await setup(t);assert.equal(open.cross.people[0].months[0].openEnd,true);
  const unconfirmed=await setup(t,id=>xml(id,period('01/01/2025','','Efetivado')));assert.equal(unconfirmed.legacy.people[0].status,'stable');assert.ok(unconfirmed.legacy.people[0].issues.includes('unconfirmed-exercise-kind'));assert.equal(unconfirmed.cross.people[0].months[0].comparison,'unavailable');assert.equal((await auditLegacy(unconfirmed.legacy,unconfirmed.cross,unconfirmed.h,unconfirmed.temporal,unconfirmed.d,unconfirmed.read)).status,'passed');
  const openLegacy=structuredClone(open.legacy);openLegacy.historySha256=hash(canonical(h));assert.equal(compareLegacy(openLegacy,h,temporal).people[0].months[0].comparison,'corroborating-unknown');
  h.people[0].events=h.people[0].events.map(e=>({...e,situacao:'Suplência'}));h.references.states.push({nome:'Suplência',sigla:'SUPLENCIA'});
  const outside=deriveTemporalHistory(h);openLegacy.historySha256=hash(canonical(h));assert.equal(compareLegacy(openLegacy,h,outside).people[0].months[0].comparison,'potential-conflict');
});
test('party matches use date and pair of parties, preserve minute differences and keep unmatched changes',async t=>{
  const r=await setup(t);assert.equal(r.cross.people[0].partyChanges[0].status,'same-day-time-differs');assert.equal(r.cross.people[0].partyChanges[0].day,'2025-11-13');
  const unmatched=await setup(t,id=>xml(id,period(),affiliation().replace('13/11/2025','14/11/2025')));assert.deepEqual(unmatched.cross.people[0].partyChanges.map(c=>c.status),['legacy-only-change','v2-only-change']);
  const minute=await setup(t,id=>xml(id,period(),affiliation('09:00:30')));assert.equal(minute.cross.people[0].partyChanges[0].status,'same-day-minute-precision');assert.equal((await auditLegacy(minute.legacy,minute.cross,minute.h,minute.temporal,minute.d,minute.read)).status,'passed');
  assert.equal((await auditLegacy(unmatched.legacy,unmatched.cross,unmatched.h,unmatched.temporal,unmatched.d,unmatched.read)).status,'passed');
});
test('ineligible v2 histories do not manufacture legacy-only party changes',async t=>{
  const r=await setup(t),h=structuredClone(r.h);h.people[0].events.push(event(1,{dataHora:'2022-01-01T00:00:00'}));
  const temporal=deriveTemporalHistory(h),legacy=structuredClone(r.legacy);legacy.historySha256=hash(canonical(h));const cross=compareLegacy(legacy,h,temporal);
  assert.equal(cross.people[0].partyComparisonStatus,'unavailable');assert.deepEqual(cross.people[0].partyChanges,[]);assert.equal((await auditLegacy(legacy,cross,h,temporal,r.d,r.read)).status,'passed');
  cross.people[0].partyComparisonStatus='compared';assert.ok((await auditLegacy(legacy,cross,h,temporal,r.d,r.read)).failures.some(f=>f.code==='party-comparison-eligibility'));
});
test('intermediate proposal preserves pilot IDs, hard-case reasons and missing annual data without declaring zero or approval',async t=>{
  const r=await setup(t),d=structuredClone(r.d);d.annuals=[{year:2025,scanned:2,selected:2,people:[{id:1,months:[1,2],rows:2}],issues:[]}];
  const h=structuredClone(r.h);h.discoverySha256=hash(canonical(d));const temporal=deriveTemporalHistory(h),legacy=structuredClone(r.legacy);legacy.discoverySha256=h.discoverySha256;legacy.historySha256=hash(canonical(h));const cross=compareLegacy(legacy,h,temporal);
  const p=proposeIntermediate(d,h,temporal,legacy,cross);assert.equal(p.status,'proposed-not-approved');assert.equal(p.publicAttributionEnabled,false);assert.deepEqual(p.people.map(p=>p.id),[1,2]);assert.ok(p.people[0].reasons.includes('annual-month-absent-not-zero'));assert.ok(p.people[1].reasons.includes('annual-person-absent-not-zero'));assert.ok(p.unmetCriteria.includes('minimum-size'));assert.equal(p.months.length,12);
  const wrong=structuredClone(cross);wrong.legacySha256='x';assert.throws(()=>proposeIntermediate(d,h,temporal,legacy,wrong),/Versões/);
  legacy.people[0].first!.periods[0].situacaoExercicio='Suplente';legacy.people[0].first!.periods[0].dataFim='31/12/2024';
  const before2025=proposeIntermediate(d,h,temporal,legacy,compareLegacy(legacy,h,temporal));assert.equal(before2025.people[0].reasons.includes('explicit-substitute-period'),false);
});
test('independent audit rejects tampered raw projections, evidence, status, versions, coverage and publication',async t=>{
  const r=await setup(t),audit=()=>auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,r.read);assert.equal((await audit()).status,'passed');
  const edits=[()=>r.legacy.people[0].first!.periods[0].dataInicio='01/01/2025',()=>r.cross.people[0].months[0].periodRows.push(999),()=>r.cross.people[0].partyChanges[0].status='same-day-and-time',()=>r.legacy.people[0].status='failed',()=>Object.assign(r.cross,{publicAttributionEnabled:true}),()=>r.cross.historySha256='0'.repeat(64)];
  for(const edit of edits){const oldL=structuredClone(r.legacy),oldC=structuredClone(r.cross);edit();assert.equal((await audit()).status,'failed');Object.assign(r.legacy,oldL);Object.assign(r.cross,oldC);}
  r.legacy.people.pop();r.cross.people.pop();assert.ok((await audit()).failures.some(f=>f.code==='universe'));
});
test('hash corruption and private identifiers in allowed fields cannot pass audit or collection',async t=>{
  const r=await setup(t);await assert.rejects(auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,async()=>bytes('corrupted')),/Hash/);
  await assert.rejects(setup(t,id=>xml(id,period().replace('<descricaoCausaFimExercicio/>','<descricaoCausaFimExercicio>12345678901</descricaoCausaFimExercicio>'),affiliation(),'<cpf>12345678901</cpf>')),/Identificador privado/);
});
test('offline CLI resumes pinned inputs without network and refuses another history without overwriting the manifest',async t=>{
  const r=await setup(t),cwd=path.join(r.dir,'cli'),legacyRoot=path.join(cwd,'data/private/people-legacy/test-run'),discoveryRoot=path.join(cwd,'data/private/people-discovery/test-discovery');
  await fs.mkdir(legacyRoot,{recursive:true});await fs.mkdir(discoveryRoot,{recursive:true});
  await fs.writeFile(path.join(discoveryRoot,'../local-vault-key'),r.key);
  await fs.writeFile(path.join(discoveryRoot,'discovery.json'),JSON.stringify(r.d));await fs.writeFile(path.join(discoveryRoot,'audit.json'),JSON.stringify({schema:'clareia.people-discovery-audit.v1',status:'passed',reportSha256:hash(canonical(r.d))}));
  for(const pass of [1,2])await fs.cp(path.join(r.dir,'pass-'+pass),path.join(legacyRoot,'pass-'+pass),{recursive:true});
  await fs.writeFile(path.join(legacyRoot,'input-history.json'),JSON.stringify(r.h));await fs.writeFile(path.join(legacyRoot,'input-temporal.json'),JSON.stringify(r.temporal));
  await fs.writeFile(path.join(legacyRoot,'input-audit.json'),JSON.stringify({schema:'clareia.people-temporal-audit.v1',status:'passed',historySha256:hash(canonical(r.h)),temporalSha256:hash(canonical(r.temporal)),discoverySha256:hash(canonical(r.d))}));
  await fs.writeFile(path.join(legacyRoot,'run.json'),JSON.stringify({runId:'test-run',discoveryRun:'test-discovery',historyRun:'test-history',historySha256:hash(canonical(r.h)),temporalSha256:hash(canonical(r.temporal))}));
  const script=fileURLToPath(new URL('../scripts/collect-people-legacy.ts',import.meta.url)),args=['--import',import.meta.resolve('tsx'),script,'--local','--offline','--run','test-run','--history-run','test-history','--discovery-run','test-discovery'];
  // There is deliberately no current history folder. Resume must use immutable
  // input copies from the run and preserved encrypted XML only.
  await promisify(execFile)(process.execPath,args,{cwd});
  const manifest=await fs.readFile(path.join(legacyRoot,'run.json'));
  const bad=[...args];bad[bad.indexOf('test-history')]='another-history';await assert.rejects(promisify(execFile)(process.execPath,bad,{cwd}));assert.deepEqual(await fs.readFile(path.join(legacyRoot,'run.json')),manifest);
  const report=JSON.parse(await fs.readFile(path.join(legacyRoot,'legacy.json'),'utf8'));assert.deepEqual(report.people.map((p:any)=>p.status),['stable','stable']);
  await fs.writeFile(path.join(legacyRoot,'running.lock'),'keep');await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}),e=>typeof e==='object'&&e!==null&&'stderr' in e&&String(e.stderr).includes('EEXIST'));assert.equal(await fs.readFile(path.join(legacyRoot,'running.lock'),'utf8'),'keep');
});

test('a period of one or two days has no interior day and stays boundary-only',async t=>{
  const r=await setup(t,id=>xml(id,period('15/03/2025','16/03/2025')));assert.equal(r.cross.people[0].months[2].legacy,'boundary-only');
  assert.equal((await auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,r.read)).status,'passed');
});
test('API full exercise with no listed XML period is a conflict, not agreement',async t=>{
  const r=await setup(t,id=>xml(id,period('01/02/2023','31/12/2023')));const july=r.cross.people[0].months[6];
  assert.equal(july.legacy,'no-listed-period');assert.equal(july.v2Exercise,'full');assert.equal(july.comparison,'potential-conflict');
  assert.equal((await auditLegacy(r.legacy,r.cross,r.h,r.temporal,r.d,r.read)).status,'passed');
});
test('a blank party event does not erase a real transition across it',async t=>{
  const base=await setup(t),h=structuredClone(base.h);
  for(const p of h.people)p.events=[p.events[0],{...p.events[0],dataHora:'2025-06-01T09:00:00',siglaPartido:null},p.events[1]];
  const temporal=deriveTemporalHistory(h),legacy=structuredClone(base.legacy);legacy.historySha256=hash(canonical(h));
  const statuses=compareLegacy(legacy,h,temporal).people[0].partyChanges.map(c=>c.status);
  assert.ok(!statuses.includes('legacy-only-change'));assert.ok(!statuses.includes('v2-only-change'));
});

test('events conflicting at the same moment end the known party, unlike an all-blank event',async t=>{
  const base=await setup(t),h=structuredClone(base.h);
  for(const p of h.people)p.events=[p.events[0],{...p.events[0],dataHora:'2025-06-01T09:00:00',siglaPartido:'PSD'},{...p.events[0],dataHora:'2025-06-01T09:00:00',siglaPartido:'PL'},p.events[1]];
  const temporal=deriveTemporalHistory(h),legacy=structuredClone(base.legacy);legacy.historySha256=hash(canonical(h));
  assert.ok(!compareLegacy(legacy,h,temporal).people[0].partyChanges.some(c=>c.status==='same-day-time-differs'&&c.day==='2025-11-13'));
});
