import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadPublication} from '../src/assistant/data.ts';
import type {Publication} from '../src/assistant/data.ts';
import {dirSource} from '../src/assistant/node-source.ts';
import {answerQuestion} from '../src/assistant/pipeline.ts';
import type {Completion} from '../src/assistant/providers/types.ts';
import {check} from '../scripts/lume-check.ts';
import {buildGold} from '../scripts/lume-gold-expected.ts';
import type {GoldItem,GoldLine} from '../scripts/lume-gold-expected.ts';
import {call,fakeProvider,finalAnswer,turn} from './helpers/fake-provider.ts';
import {makeFixture} from './helpers/assistant-fixture.ts';

const KEYS:Record<string,string>={passagens:'PASSAGENS AÉREAS','combustível':'COMBUSTÍVEIS E LUBRIFICANTES.','divulgação':'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.',telefonia:'TELEFONIA','escritório':'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR',hospedagem:'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.','táxi':'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO','locação':'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES'};

function oracle(item:GoldItem,line:GoldLine,pub:Publication):Completion[]{
  const e=line.expect,vars=item.vars!,id=(k:string)=>pub.people.find(p=>p.name===vars[k])!.id;
  const who=(e.who??[]) as string[];
  const months=e.months?{from:e.months[0],to:e.months[1]}:null,category=e.category?KEYS[e.category]:null;
  const resolve=(k:string)=>turn(call('resolve_deputy',{query:vars[k],uf:null}));
  const done=finalAnswer({kind:'answer',connective:'Veja o resultado.'});
  switch(e.type){
    case 'refuse':return [finalAnswer({kind:'refuse',refusal_code:e.codes[0]})];
    case 'supplier_top':return [...(who[0]?[resolve(who[0])]:[]),turn(call('top_suppliers',{deputy_id:who[0]?id(who[0]):null,category,months:null,limit:3})),done];
    case 'supplier_one':return [turn(call('supplier_spending',{supplier_query:vars.SUP,deputy_id:who[0]?id(who[0]):null})),done];
    case 'categories':return [turn(call('category_totals',{uf:null,months:null})),done];
    case 'uf':return [turn(call('uf_totals',{metric:'total',category:null,limit:null})),done];
    case 'largest':return [resolve(who[0]),turn(call('expense_records',{deputy_id:id(who[0]),category:null,month:null,supplier:null,order:'desc',limit:3})),done];
    case 'bills_count':return [resolve(who[0]),turn(call('deputy_bills',{deputy_id:id(who[0]),type:null,role:null,query:null,limit:3})),done];
    case 'bills_type':return [resolve(who[0]),turn(call('deputy_bills',{deputy_id:id(who[0]),type:e.billType,role:null,query:null,limit:3})),done];
    case 'bills_rank':return [turn(call('rank_bills',{metric:'proposed',order:'desc',uf:null,limit:3})),done];
    case 'votes':case 'votes_cat':return [resolve(who[0]),turn(call('deputy_votes',{deputy_id:id(who[0]),query:null,category:null,kind:null,date_from:null,date_to:null,limit:3})),done];
    case 'coverage':return [resolve(who[0]),turn(call('deputy_coverage',{deputy_id:id(who[0])})),done];
    case 'clarify':return [turn(call('supplier_spending',{supplier_query:'Cascol',deputy_id:null})),finalAnswer({kind:'clarify',clarify_code:'ambiguous_supplier'})];
    default:return [finalAnswer({kind:'refuse',refusal_code:'out_of_scope'})];
  }
}

async function runGold(dir:string,minRan:number){
  const gold=(await fs.readFile(path.join(import.meta.dirname,'lume','gold.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l) as GoldLine);
  assert.ok(gold.length>=100);
  const items=await buildGold(dir,gold),pub=await loadPublication(dirSource(dir));
  const failures:string[]=[];let numeric=0,ran=0;
  for(const [i,item] of items.entries()){
    if(item.kind==='skip')continue;
    ran++;if(item.numeric)numeric++;
    const reply=await answerQuestion(item.question,pub,{provider:fakeProvider(oracle(item,gold[i],pub))});
    const reasons=check(item,reply);
    if(reasons.length)failures.push(`${item.id} "${item.question}": ${reasons.join('; ')}\n${reply.text}`);
  }
  assert.deepEqual(failures,[]);
  assert.ok(ran>=minRan,`only ${ran} items ran`);
  assert.ok(numeric>=70,`only ${numeric} numeric items`);
  const kinds=new Set(items.map(i=>i.kind));
  for(const k of ['answer','refuse','clarify'])assert.ok(kinds.has(k as any));
}

test('the gold set, with expectations computed from the raw files, matches the assistant on a fixture publication',async()=>{
  const fx=makeFixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'lume-gold-'));
  try{
    for(const [file,content] of fx.files){await fs.mkdir(path.dirname(path.join(dir,file)),{recursive:true});await fs.writeFile(path.join(dir,file),JSON.stringify(content));}
    await runGold(dir,95);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the same holds on a real published build when LUME_GOLD_DIST points to one',{skip:!process.env.LUME_GOLD_DIST},async()=>{await runGold(process.env.LUME_GOLD_DIST!,95);});
