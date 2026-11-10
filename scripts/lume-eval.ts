import fs from 'node:fs/promises';
import path from 'node:path';
import {loadPublication} from '../src/assistant/data.ts';
import {dirSource} from '../src/assistant/node-source.ts';
import {answerQuestion} from '../src/assistant/pipeline.ts';
import type {Reply} from '../src/assistant/pipeline.ts';
import {priceOf} from '../src/assistant/pricing.ts';
import {createProvider} from '../src/assistant/providers/index.ts';
import type {ProviderFamily} from '../src/assistant/providers/index.ts';
import type {Provider} from '../src/assistant/providers/types.ts';
import {check} from './lume-check.ts';
import {buildGold} from './lume-gold-expected.ts';
import type {GoldItem,GoldLine} from './lume-gold-expected.ts';

interface Target{family:ProviderFamily|'rules';model:string}
export interface ItemResult{id:string;category:string;status:'pass'|'fail'|'skipped';reasons:string[];numeric:boolean;route:string;latencyMs:number;costUsd:number|null}


const percentile=(xs:number[],p:number)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]:0;

async function pool<T,R>(items:T[],size:number,fn:(x:T)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));
  return out;
}

function parseArgs(argv:string[],env:Record<string,string|undefined>){
  const targets:Target[]=[];let dist=env.LUME_DIST??'dist',runs=1,all=false,pendingFamily:string|null=null;
  const take=(i:number)=>argv[i+1];
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--dist')dist=take(i++);
    else if(a==='--runs')runs=Number(take(i++));
    else if(a==='--all')all=true;
    else if(a==='--provider'){pendingFamily=take(i++);if(pendingFamily==='rules')targets.push({family:'rules',model:'-'});}
    else if(a==='--model'){
      if(!pendingFamily)throw new Error('--model precisa vir depois de --provider');
      targets.push({family:pendingFamily as ProviderFamily,model:take(i++)});pendingFamily=null;
    }
  }
  if(pendingFamily&&pendingFamily!=='rules')throw new Error(`--provider ${pendingFamily} sem --model`);
  if(all||!targets.length){
    targets.push({family:'rules',model:'-'},
      ...['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'].map(model=>({family:'anthropic' as const,model})),
      {family:'openai',model:env.LUME_OPENAI_MODEL??''},{family:'local',model:env.LUME_LOCAL_MODEL??''});
  }
  return {targets,dist,runs};
}

interface Row{target:string;status:'ran'|'skipped';reason?:string;results:ItemResult[];total:number;pass:number;numericTotal:number;numericPass:number;refuseTotal:number;refusePass:number;clarifyTotal:number;clarifyPass:number;costUsd:number|null;priceChecked:string|null;p50:number;p95:number;skippedItems:number;failures:{id:string;question:string;reasons:string[]}[]}

async function main(){
  const {targets,dist,runs}=parseArgs(process.argv.slice(2),process.env);
  const gold=(await fs.readFile(path.join(import.meta.dirname,'..','tests','lume','gold.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l) as GoldLine);
  const items=await buildGold(dist,gold);
  const pub=await loadPublication(dirSource(dist));
  console.log(`Publicação ${pub.id.slice(0,12)} · ${pub.people.length} deputados · ${items.filter(i=>i.kind!=='skip').length} itens (${items.filter(i=>i.kind==='skip').length} pulados) · ${runs} execução(ões)`);
  const rows:Row[]=[];
  for(const target of targets){
    const label=target.family==='rules'?'rules (sem modelo)':`${target.family}/${target.model||'?'}`;
    let provider:Provider|undefined;
    if(target.family!=='rules'){
      if(!target.model){rows.push(empty(label,'skipped','modelo não informado (variável de ambiente do modelo ausente)'));continue;}
      const found=createProvider(target.family,target.model);
      if(found.status==='skipped'){rows.push(empty(label,'skipped',found.reason));continue;}
      provider=found.provider;
    }
    const results:ItemResult[]=[],failures:Row['failures']=[];
    for(let run=0;run<runs;run++){
      const out=await pool(items,target.family==='local'?1:4,async item=>{
        if(item.kind==='skip')return {r:{id:item.id,category:item.category,status:'skipped' as const,reasons:[item.note??''],numeric:false,route:'-',latencyMs:0,costUsd:0},item,reply:null};
        let reply:Reply;
        try{reply=await answerQuestion(item.question,pub,{provider});}
        catch(error){return {r:{id:item.id,category:item.category,status:'fail' as const,reasons:[`exceção: ${(error as Error).message}`],numeric:item.numeric,route:'-',latencyMs:0,costUsd:null},item,reply:null};}
        const reasons=check(item,reply);
        return {r:{id:item.id,category:item.category,status:reasons.length?'fail' as const:'pass' as const,reasons,numeric:item.numeric,route:reply.route,latencyMs:reply.latencyMs,costUsd:reply.costUsd},item,reply};
      });
      for(const o of out){results.push(o.r);if(o.r.status==='fail')failures.push({id:`${o.r.id}#${run+1}`,question:o.item.question,reasons:o.r.reasons});}
    }
    rows.push(summarize(label,target,items,results,failures));
  }
  report(rows,pub.id,dist,runs);
}

const empty=(target:string,status:'skipped',reason:string):Row=>({target,status,reason,results:[],total:0,pass:0,numericTotal:0,numericPass:0,refuseTotal:0,refusePass:0,clarifyTotal:0,clarifyPass:0,costUsd:null,priceChecked:null,p50:0,p95:0,skippedItems:0,failures:[]});

function summarize(label:string,target:Target,items:GoldItem[],results:ItemResult[],failures:Row['failures']):Row{
  const ran=results.filter(r=>r.status!=='skipped'),kindOf=new Map(items.map(i=>[i.id,i.kind]));
  const by=(k:string)=>ran.filter(r=>kindOf.get(r.id)===k);
  const costs=ran.map(r=>r.costUsd);
  const price=target.family==='rules'?null:priceOf(target.family,target.model);
  return {
    target:label,status:'ran',results,total:ran.length,pass:ran.filter(r=>r.status==='pass').length,
    numericTotal:ran.filter(r=>r.numeric).length,numericPass:ran.filter(r=>r.numeric&&r.status==='pass').length,
    refuseTotal:by('refuse').length,refusePass:by('refuse').filter(r=>r.status==='pass').length,
    clarifyTotal:by('clarify').length,clarifyPass:by('clarify').filter(r=>r.status==='pass').length,
    costUsd:target.family==='rules'?0:costs.some(c=>c===null)?null:costs.reduce<number>((a,c)=>a+(c??0),0),
    priceChecked:price?.checkedAt??null,p50:percentile(ran.map(r=>r.latencyMs),0.5),p95:percentile(ran.map(r=>r.latencyMs),0.95),
    skippedItems:results.filter(r=>r.status==='skipped').length,failures
  };
}

function report(rows:Row[],pubId:string,dist:string,runs:number){
  const pct=(a:number,b:number)=>b?`${(a/b*100).toFixed(1)}%`:'-';
  const money=(r:Row)=>r.status!=='ran'?'-':r.costUsd===null?'n/d (preço não verificado)':`US$ ${r.costUsd.toFixed(4)}`;
  const header='| Provedor/modelo | Acerto | Números exatos | Recusas corretas | Esclarecimentos | Custo estimado | p50 | p95 |\n|---|---|---|---|---|---|---|---|';
  const lines=rows.map(r=>r.status==='skipped'?`| ${r.target} | PULADO: ${r.reason} | | | | | | |`:`| ${r.target} | ${r.pass}/${r.total} (${pct(r.pass,r.total)}) | ${r.numericPass}/${r.numericTotal} (${pct(r.numericPass,r.numericTotal)}) | ${r.refusePass}/${r.refuseTotal} | ${r.clarifyPass}/${r.clarifyTotal} | ${money(r)} | ${r.p50} ms | ${r.p95} ms |`);
  const table=`${header}\n${lines.join('\n')}`;
  console.log(`\n${table}\n`);
  for(const r of rows.filter(x=>x.status==='ran'&&x.failures.length)){
    console.log(`Falhas de ${r.target}:`);
    for(const f of r.failures.slice(0,25))console.log(`  ${f.id} "${f.question}" -> ${f.reasons.join('; ')}`);
  }
  const verdicts=rows.filter(r=>r.status==='ran').map(r=>`${r.target}: ${r.numericPass===r.numericTotal?'100% dos números exatos':'FALHA em números'}`);
  console.log(verdicts.join('\n'));
  const dir=path.join(import.meta.dirname,'..','output','lume-eval');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  return fs.mkdir(dir,{recursive:true}).then(async()=>{
    await fs.writeFile(path.join(dir,`${stamp}.json`),JSON.stringify({generatedAt:new Date().toISOString(),publicationId:pubId,dist,runs,rows},null,1));
    await fs.writeFile(path.join(dir,`${stamp}.md`),`# Avaliação do Lume\n\nPublicação ${pubId}, ${runs} execução(ões).\n\n${table}\n\nPreços: tabela única em src/assistant/pricing.ts (Anthropic conferida em 2026-10-06; OpenAI sem preço verificado).\n`);
    console.log(`Relatório em output/lume-eval/${stamp}.json e .md`);
  });
}

main().catch(error=>{console.error(error.message);process.exit(1);});
