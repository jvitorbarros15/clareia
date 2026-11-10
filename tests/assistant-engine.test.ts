import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPublication} from '../src/assistant/data.ts';
import type {Publication} from '../src/assistant/data.ts';
import {runTool,toolDefinitions} from '../src/assistant/engine.ts';
import {findMentions,resolveDeputy,resolveSupplier} from '../src/assistant/resolve.ts';
import {matchCategory,matchUF,parsePeriod} from '../src/assistant/vocabulary.ts';
import {renderOutput,renderOutputs,strayNumbers,toText} from '../src/assistant/render.ts';
import {money,percent} from '../src/assistant/format.ts';
import {makeFixture,PEOPLE} from './helpers/assistant-fixture.ts';

const fx=makeFixture();
let pubPromise:Promise<Publication>|null=null;
const pub=()=>pubPromise??=loadPublication(fx.source);
const raw=(id:number,f:{category?:string[];from?:number;to?:number}={})=>fx.records.get(id)!.filter(r=>(!f.category||f.category.includes(r.category))&&r.month>=(f.from??1)&&r.month<=(f.to??12));
const total=(id:number,f?:Parameters<typeof raw>[1])=>raw(id,f).reduce((s,r)=>s+r.cents,0);
const AIR=['PASSAGEM AÉREA - RPA','PASSAGEM AÉREA - SIGEPA'];
const ok=(o:any)=>{assert.equal(o.ok,true,JSON.stringify(o));return o;};

test('publication replicates exercise rules of the site',async()=>{
  const p=await pub(),by=(id:number)=>p.people.find(x=>x.id===id)!;
  assert.equal(by(106).noExercise,true);
  assert.equal(by(101).noExercise,false);
  assert.equal(by(103).servedMonths,10);
  assert.equal(by(108).servedMonths,10);
  assert.equal(by(101).servedMonths,12);
  assert.equal(by(101).partyLabel,'PSB');
});

test('deputy_spending totals, categories and months match the raw records',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'deputy_spending',{deputy_id:101,category:null,months:null}));
  assert.equal(o.data.totalCents,total(101));
  assert.equal(o.data.records,raw(101).length);
  assert.equal(o.data.monthlyAverageCents,Math.round(total(101)/12));
  const cats=new Map<string,number>();for(const r of raw(101))cats.set(r.category,(cats.get(r.category)??0)+r.cents);
  assert.deepEqual(o.data.byCategory.map((c:any)=>[c.category,c.cents]),[...cats].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')));
  const ranged=ok(await runTool(p,'deputy_spending',{deputy_id:101,category:null,months:{from:3,to:5}}));
  assert.equal(ranged.data.totalCents,total(101,{from:3,to:5}));
  assert.equal(ranged.data.monthlyAverageCents,Math.round(total(101,{from:3,to:5})/3));
});

test('a category group sums every official category and states them in the scope',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'deputy_spending',{deputy_id:101,category:'PASSAGENS AÉREAS',months:null}));
  assert.equal(o.data.totalCents,total(101,{category:AIR}));
  assert.deepEqual(o.scope.category.officials,AIR);
  assert.match(toText(renderOutput(p,o)),/PASSAGEM AÉREA - RPA; PASSAGEM AÉREA - SIGEPA/);
});

test('deputy without confirmed exercise is never shown as zero',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'deputy_spending',{deputy_id:106,category:null,months:null}));
  assert.equal(o.data.noExercise,true);
  const text=toText(renderOutput(p,o));
  assert.match(text,/não tem exercício de mandato confirmado em 2025/);
  assert.doesNotMatch(text,/R\$/);
});

test('ranking excludes no-exercise, uses served months for the monthly metric and breaks ties by name',async()=>{
  const p=await pub();
  const ids=PEOPLE.filter(x=>x.id!==106);
  const served=(id:number)=>p.people.find(x=>x.id===id)!.servedMonths;
  const totalRank=ids.map(x=>[x.id,total(x.id)] as const).sort((a,b)=>b[1]-a[1]||PEOPLE.find(x=>x.id===a[0])!.name.localeCompare(PEOPLE.find(x=>x.id===b[0])!.name,'pt-BR'));
  const o=ok(await runTool(p,'rank_spending',{metric:'total',order:'desc',category:null,uf:null,months:null,limit:10}));
  assert.deepEqual(o.data.rows.map((r:any)=>[r.id,r.cents]),totalRank);
  assert.equal(o.data.excludedNoExercise,1);
  const monthly=ids.map(x=>[x.id,total(x.id)/served(x.id)] as const).sort((a,b)=>a[1]-b[1]);
  const m=ok(await runTool(p,'rank_spending',{metric:'monthly',order:'asc',category:null,uf:null,months:null,limit:10}));
  assert.deepEqual(m.data.rows.map((r:any)=>r.id),monthly.map(x=>x[0]));
  assert.equal(m.data.rows[0].valueCents,Math.round(monthly[0][1]));
  const sp=ok(await runTool(p,'rank_spending',{metric:'total',order:'desc',category:null,uf:'sp',months:null,limit:10}));
  assert.deepEqual(sp.data.rows.map((r:any)=>r.id).sort(),[101,102]);
});

test('a month range excludes people whose held month makes the average unknowable',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'rank_spending',{metric:'monthly',order:'desc',category:null,uf:null,months:{from:3,to:6},limit:10}));
  assert.equal(o.data.excludedHeld,1);
  assert.ok(!o.data.rows.some((r:any)=>r.id===108));
  const joao=o.data.rows.find((r:any)=>r.id===103);
  assert.equal(joao.monthsServed,4);
  assert.equal(joao.cents,total(103,{from:3,to:6}));
});

test('compare_spending keeps direction, percent over the second value and drops percent for a non-positive base',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'compare_spending',{a:101,b:102,metric:'total',category:null,months:null}));
  const a=total(101),b=total(102);
  assert.equal(o.data.diffCents,Math.abs(a-b));
  assert.equal(o.data.more,a>b?'a':'b');
  assert.equal(o.data.percent,Math.abs(a-b)/b*100);
  const z=ok(await runTool(p,'compare_spending',{a:101,b:107,metric:'total',category:null,months:null}));
  assert.equal(z.data.percent,null);
  assert.equal(z.data.b.cents,-50000);
  assert.match(toText(renderOutput(p,z)),/Sem percentual: o valor de Carlos é negativo/);
  const none=ok(await runTool(p,'compare_spending',{a:101,b:106,metric:'total',category:null,months:null}));
  assert.equal(none.data.status,'no_exercise');
  const diff=ok(await runTool(p,'compare_spending',{a:101,b:103,metric:'total',category:null,months:null}));
  assert.equal(diff.data.monthsDiffer,true);
});

test('suppliers: top list, single supplier and the private-person label',async()=>{
  const p=await pub();
  const sup=new Map<string,number>();for(const r of raw(102))sup.set(r.supplier,(sup.get(r.supplier)??0)+r.cents);
  const top=[...sup].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0],'pt-BR'));
  const o=ok(await runTool(p,'top_suppliers',{deputy_id:102,category:null,months:null,limit:3}));
  assert.deepEqual(o.data.rows.map((r:any)=>[r.supplier,r.cents]),top.slice(0,3));
  const s=ok(await runTool(p,'supplier_spending',{supplier_query:'posto beta',deputy_id:null}));
  const expected=PEOPLE.reduce((n,x)=>n+raw(x.id).filter(r=>r.supplier==='Posto Beta').reduce((a,r)=>a+r.cents,0),0);
  assert.equal(s.data.totalCents,expected);
  const text=toText(renderOutput(p,ok(await runTool(p,'top_suppliers',{deputy_id:null,category:null,months:null,limit:10}))));
  assert.match(text,/Fornecedor pessoa física/);
  assert.match(text,/o nome individual não é publicado/);
});

test('category_totals and uf_totals match independent sums; shares use positive categories only',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'category_totals',{uf:null,months:null}));
  const all=PEOPLE.flatMap(x=>raw(x.id));
  assert.equal(o.data.totalCents,all.reduce((s,r)=>s+r.cents,0));
  assert.equal(o.data.negativeAdjustmentsCents,all.filter(r=>r.cents<0).length?o.data.negativeAdjustmentsCents:0);
  const positive=o.data.rows.filter((r:any)=>r.cents>0).reduce((s:number,r:any)=>s+r.cents,0);
  assert.equal(o.data.rows[0].sharePercent,o.data.rows[0].cents/positive*100);
  const u=ok(await runTool(p,'uf_totals',{metric:'total',category:null,limit:null}));
  const mg=PEOPLE.filter(x=>x.uf==='MG').reduce((s,x)=>s+total(x.id),0);
  assert.equal(u.data.rows.find((r:any)=>r.uf==='MG').cents,mg);
  assert.equal(u.data.rows.find((r:any)=>r.uf==='RJ'),undefined);
});

test('expense_records returns the largest records from the on-demand file',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'expense_records',{deputy_id:101,category:null,month:null,supplier:null,order:'desc',limit:3}));
  const sorted=[...raw(101)].sort((a,b)=>b.cents-a.cents);
  assert.deepEqual(o.data.rows.map((r:any)=>r.cents),sorted.slice(0,3).map(r=>r.cents));
  assert.equal(o.data.matched,raw(101).length);
  assert.equal(o.data.sumCents,total(101));
});

test('bills, votes and bill ranking come from the activity files and summary counts',async()=>{
  const p=await pub(),act=fx.activity.get(102);
  const b=ok(await runTool(p,'deputy_bills',{deputy_id:102,type:null,role:null,query:null,limit:10}));
  assert.equal(b.data.counts.proposed,act.bills.filter((x:any)=>x.proponent).length);
  assert.equal(b.data.matched,act.bills.length);
  const pl=ok(await runTool(p,'deputy_bills',{deputy_id:102,type:'PL',role:'proponent',query:null,limit:10}));
  assert.equal(pl.data.matched,act.bills.filter((x:any)=>x.type==='PL'&&x.proponent).length);
  const v=ok(await runTool(p,'deputy_votes',{deputy_id:102,query:null,category:'Sim',kind:null,date_from:null,date_to:null,limit:10}));
  assert.equal(v.data.matched,act.votes.filter((x:any)=>x.category==='Sim').length);
  assert.equal(v.data.totalVotes,act.votes.length);
  assert.equal(v.data.votesHeld,1);
  const r=ok(await runTool(p,'rank_bills',{metric:'proposed',order:'desc',uf:null,limit:3}));
  const counts=PEOPLE.map(x=>[x.id,fx.activity.get(x.id).bills.filter((y:any)=>y.proponent).length] as const).sort((a,c)=>c[1]-a[1]);
  assert.equal(r.data.rows[0].n,counts[0][1]);
  assert.match(toText(renderOutput(p,b)),/Quantidade mostra atividade, não qualidade, e não é comparada com gastos\./);
});

test('invalid arguments, months outside the version and unknown categories are refused, never guessed',async()=>{
  const p=await pub();
  assert.equal((await runTool(p,'deputy_spending',{deputy_id:'x'}) as any).error.code,'invalid_args');
  assert.equal((await runTool(p,'nope',{}) as any).error.code,'invalid_args');
  const m=await runTool(p,'deputy_spending',{deputy_id:101,category:null,months:{from:1,to:13}}) as any;
  assert.equal(m.error.code,'period_out_of_scope');
  assert.match(renderOutput(p,m).refusal!.text,/Esta versão cobre Jan–Dez 2025/);
  const c=await runTool(p,'deputy_spending',{deputy_id:101,category:'SERVIÇOS POSTAIS',months:null}) as any;
  assert.equal(c.error.code,'category_not_in_version');
  assert.equal((await runTool(p,'deputy_spending',{deputy_id:999,category:null,months:null}) as any).error.code,'unknown_person');
});

test('tool definitions expose only the closed catalog with strict, nullable schemas',async()=>{
  const defs=toolDefinitions(await pub());
  assert.equal(defs.length,13);
  for(const d of defs){
    const s=d.parameters as any;
    assert.equal(s.additionalProperties,false);
    assert.deepEqual([...s.required].sort(),Object.keys(s.properties).sort());
  }
  const rank=defs.find(d=>d.name==='rank_spending')!.parameters as any;
  assert.ok(rank.properties.category.anyOf[0].enum.includes('PASSAGENS AÉREAS'));
});

test('entity resolution handles accents, nicknames, shared first names, UF and spelling slips',async()=>{
  const p=await pub();
  assert.equal((resolveDeputy(p,'tiririca') as any).match.id,102);
  assert.equal((resolveDeputy(p,'TABATA') as any).match.id,101);
  assert.equal(resolveDeputy(p,'joao').status,'many');
  assert.equal((resolveDeputy(p,'João Silva') as any).match.id,103);
  assert.equal((resolveDeputy(p,'joao','GO') as any).match.id,104);
  assert.equal((resolveDeputy(p,'souza') as any).candidates.length,2);
  assert.equal(resolveDeputy(p,'Zé Ninguém').status,'none');
  assert.equal(resolveSupplier(p,'posto').status,'one');
  assert.equal(resolveSupplier(p,'zzz').status,'none');
  const m=findMentions(p,'Quanto Tabata Amaral gastou a mais que o Tiririca?');
  assert.deepEqual(m.map(x=>[x.status,x.candidates[0].id]),[['one',101],['one',102]]);
  const amb=findMentions(p,'Quanto gastou o João?');
  assert.equal(amb[0].status,'many');
  assert.equal(amb[0].candidates.length,2);
  const fuzzy=findMentions(p,'Quanto gastou a Tabbata?');
  assert.equal(fuzzy[0].status,'fuzzy');
  const stray=findMentions(p,'Quanto gastou Tabata Pereira?');
  assert.ok(stray.length>=1);
  assert.equal(findMentions(p,'Quem mais gastou por mês?').length,0);
});

test('vocabulary: categories, UF and periods',async()=>{
  const p=await pub();
  assert.equal((matchCategory(p.categories,'quem mais gastou com passagens?') as any).category.key,'PASSAGENS AÉREAS');
  assert.equal(matchCategory(p.categories,'gasto com combustível').status,'one');
  assert.equal(matchCategory(p.categories,'gasto parlamentar na atividade').status,'none');
  assert.equal(matchCategory(p.categories,'gasto com correios').status,'absent');
  assert.equal(matchCategory(p.categories,'combustível e telefone').status,'many');
  assert.equal(matchUF('deputados de SP'),'SP');
  assert.equal(matchUF('gastos dos paulistas'),'SP');
  assert.equal(matchUF('quem gastou menos no Rio Grande do Sul'),'RS');
  assert.equal(matchUF('se eu pagar'),null);
  assert.deepEqual(parsePeriod('gastos em março'),{from:3,to:3});
  assert.deepEqual(parsePeriod('de jan a mar'),{from:1,to:3});
  assert.deepEqual(parsePeriod('no primeiro trimestre'),{from:1,to:3});
  assert.deepEqual(parsePeriod('até abril'),{from:1,to:4});
  assert.deepEqual(parsePeriod('segundo semestre'),{from:7,to:12});
  assert.equal(parsePeriod('quem mais gastou'),null);
});

test('every rendered number exists in the tool results',async()=>{
  const p=await pub();
  const calls:[string,unknown][]=[
    ['rank_spending',{metric:'monthly',order:'desc',category:null,uf:null,months:null,limit:5}],
    ['rank_spending',{metric:'total',order:'asc',category:'PASSAGENS AÉREAS',uf:'SP',months:{from:2,to:6},limit:5}],
    ['deputy_spending',{deputy_id:103,category:null,months:null}],
    ['deputy_spending',{deputy_id:106,category:null,months:null}],
    ['compare_spending',{a:101,b:102,metric:'monthly',category:null,months:null}],
    ['compare_spending',{a:101,b:107,metric:'total',category:null,months:null}],
    ['top_suppliers',{deputy_id:null,category:null,months:null,limit:5}],
    ['supplier_spending',{supplier_query:'delta',deputy_id:null}],
    ['category_totals',{uf:null,months:null}],
    ['uf_totals',{metric:'average',category:null,limit:null}],
    ['expense_records',{deputy_id:101,category:null,month:null,supplier:null,order:'desc',limit:5}],
    ['deputy_coverage',{deputy_id:103}],
    ['deputy_bills',{deputy_id:104,type:null,role:null,query:null,limit:5}],
    ['deputy_votes',{deputy_id:104,query:null,category:null,kind:null,date_from:null,date_to:null,limit:5}],
    ['rank_bills',{metric:'coauthored',order:'desc',uf:null,limit:5}]
  ];
  for(const [name,args] of calls){
    const out=await runTool(p,name,args),text=toText(renderOutput(p,out));
    assert.deepEqual(strayNumbers(text,[out]),[],`${name}: ${text}`);
  }
  const two=[await runTool(p,'deputy_spending',{deputy_id:101,category:null,months:null}),await runTool(p,'deputy_spending',{deputy_id:102,category:null,months:null})];
  assert.deepEqual(strayNumbers(toText(renderOutputs(p,two)),two),[]);
  assert.deepEqual(strayNumbers('Gastou R$ 123,45 a mais',two),['123,45']);
});

test('the rendered ranking carries the editorial sentences and exact money formatting',async()=>{
  const p=await pub();
  const o=ok(await runTool(p,'rank_spending',{metric:'total',order:'desc',category:null,uf:null,months:null,limit:2}));
  const text=toText(renderOutput(p,o));
  assert.match(text,/Ranking de despesas da cota parlamentar; não mede qualidade do mandato\./);
  assert.match(text,/Gasto maior não indica irregularidade\./);
  assert.ok(text.includes(money(o.data.rows[0].cents)));
  assert.match(text,/Não entram 1 deputado sem exercício confirmado em 2025\./);
  assert.equal(percent(12.34),'12,3%');
});
