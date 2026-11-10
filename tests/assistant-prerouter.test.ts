import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPublication} from '../src/assistant/data.ts';
import type {Publication} from '../src/assistant/data.ts';
import {preroute} from '../src/assistant/prerouter.ts';
import {makeFixture} from './helpers/assistant-fixture.ts';

let promise:Promise<Publication>|null=null;
const pub=()=>promise??=loadPublication(makeFixture().source);
const plan=async(q:string)=>{const r=preroute(await pub(),q);assert.equal(r?.kind,'plan',`${q} -> ${JSON.stringify(r)}`);return (r as any).plan;};

test('ranking intents map to rank_spending with metric, order, category, UF and period',async()=>{
  assert.deepEqual(await plan('Quem mais gastou?'),[{tool:'rank_spending',args:{metric:'total',order:'desc',category:null,uf:null,months:null,limit:5}}]);
  assert.equal((await plan('Quem mais gastou por mês?'))[0].args.metric,'monthly');
  assert.equal((await plan('quem gastou menos'))[0].args.order,'asc');
  assert.equal((await plan('Quem mais gastou com passagens?'))[0].args.category,'PASSAGENS AÉREAS');
  assert.equal((await plan('Quem mais gastou com combustível?'))[0].args.category,'COMBUSTÍVEIS E LUBRIFICANTES.');
  assert.equal((await plan('Quem mais gastou em SP no primeiro trimestre?'))[0].args.uf,'SP');
  assert.deepEqual((await plan('Quem mais gastou em março?'))[0].args.months,{from:3,to:3});
  assert.equal((await plan('maiores gastos'))[0].tool,'rank_spending');
  assert.equal((await plan('despesas'))[0].tool,'rank_spending');
});

test('one name is a profile, two names a comparison in order of appearance',async()=>{
  assert.deepEqual(await plan('Quanto a Tabata gastou?'),[{tool:'deputy_spending',args:{deputy_id:101,category:null,months:null}}]);
  assert.equal((await plan('quanto tiririca gastou com passagem em abril'))[0].args.category,'PASSAGENS AÉREAS');
  const c=await plan('Tiririca gastou mais que a Tabata?');
  assert.deepEqual(c[0],{tool:'compare_spending',args:{a:102,b:101,metric:'total',category:null,months:null}});
  assert.equal((await plan('compare Tabata e Tiririca por mês'))[0].args.metric,'monthly');
});

test('ambiguity asks back instead of guessing',async()=>{
  const p=await pub();
  const r=preroute(p,'Quanto gastou o João?') as any;
  assert.equal(r.kind,'final');assert.equal(r.rendered.kind,'clarify');
  assert.deepEqual(r.rendered.clarify.options.map((o:any)=>o.deputyId).sort(),[103,104]);
  const typo=preroute(p,'Quanto gastou a Tabbata?') as any;
  assert.equal(typo.rendered.clarify.options[0].deputyId,101);
  assert.equal((preroute(p,'Tabata gastou mais que quem?') as any).rendered.clarify.code,'missing_second_person');
  assert.equal((preroute(p,'compare Tabata, Tiririca e Maria') as any).rendered.clarify.code,'too_many_people');
  assert.equal((preroute(p,'gasto com combustível e telefone') as any).rendered.clarify.code,'ambiguous_category');
  assert.equal((preroute(p,'quem gastou com correios') as any).rendered.refusal.code,'category_not_in_version');
});

test('questions about other domains or without a recognised intent go to the planner (null)',async()=>{
  const p=await pub();
  for(const q of ['Quem mais apresentou projetos?','Como a Tabata votou?','Maiores fornecedores','Qual a capital da França?','oi','','Qual partido gastou mais?'])assert.equal(preroute(p,q),null,q);
});
