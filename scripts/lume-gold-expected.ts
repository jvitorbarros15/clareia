import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Computes the expected answers of the Lume gold set straight from the raw published files
// (index.json, deputados/<id>/despesas.json, atividade/<id>.json). It does not import the assistant engine.
// summary.json is read only for the exercise status per month, which no raw file carries.

export interface GoldLine{id:string;category:string;question:string;expect:Record<string,any>}
export interface GoldItem{
  vars?:Record<string,string|null>;
  id:string;category:string;question:string;kind:'answer'|'refuse'|'clarify'|'skip';
  codes?:string[];minOptions?:number;tools?:string[];
  values:string[];patterns:string[];names:string[];forbidden:string[];numeric:boolean;note?:string;
}

const nb=(s:string)=>s.replace(/ /g,' ');
const brl=(cents:number)=>nb((cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/^-/,'−'));
const int=(n:number)=>n.toLocaleString('pt-BR');
const pct=(n:number)=>`${n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
const strip=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const byName=(a:string,b:string)=>a.localeCompare(b,'pt-BR');
const roundHalf=(a:number,b:number)=>{const r=Math.floor(Math.abs(a)/b+0.5);return a<0?-r:r;};

const CATEGORY_WORDS:Record<string,(c:string)=>boolean>={
  passagens:c=>c.startsWith('PASSAGEM AÉREA'),'combustível':c=>c.includes('COMBUST'),'divulgação':c=>c.startsWith('DIVULGA'),
  telefonia:c=>c==='TELEFONIA','escritório':c=>c.includes('ESCRIT'),hospedagem:c=>c.startsWith('HOSPEDAGEM'),'táxi':c=>c.startsWith('SERVIÇO DE TÁXI'),'locação':c=>c.startsWith('LOCAÇÃO')
};

interface Rec{category:string;supplier:string;cents:number;month:number}
interface Person{id:number;name:string;uf:string|null;recs:Rec[];served:number;noExercise:boolean;bills:any[];votes:any[];months:any[]}
interface World{people:Person[];categories:string[];year:number;suppliers:string[]}

async function load(dist:string):Promise<World>{
  const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(dist,p),'utf8'));
  const base=(await read('manifest.json')).base as string;
  const index=await read(`${base}/index.json`),summary=await read(`${base}/summary.json`);
  const coverage=Boolean(summary.coverageId),people:Person[]=[];
  for(const id of index.scope.ids as number[]){
    const info=index.people.find((p:any)=>p.id===id),sp=summary.people.find((p:any)=>p.id===id);
    const recs:Rec[]=(await read(`${base}/deputados/${id}/despesas.json`).catch(()=>[])) as Rec[];
    const act=await read(`${base}/atividade/${id}.json`).catch(()=>({bills:[],votes:[]}));
    const months=sp?.months??[],held=index.validation.heldMonths?.[String(id)]??0;
    const served=Math.max(1,(coverage?months.filter((m:any)=>m.exercise!=='outside').length:index.scope.months.length)-held);
    const noExercise=coverage&&recs.length===0&&months.length>0&&months.every((m:any)=>!m.exercise||['unknown','outside','conflict'].includes(m.exercise));
    people.push({id,name:info.name,uf:info.uf??null,recs:recs.map(r=>({category:r.category,supplier:r.supplier,cents:r.cents,month:r.month})),served,noExercise,bills:act.bills,votes:act.votes,months});
  }
  const categories:string[]=summary.categories;
  return {people,categories,year:index.scope.year,suppliers:[...new Set(people.flatMap(p=>p.recs.map(r=>r.supplier)))]};
}

const sum=(recs:Rec[])=>recs.reduce((s,r)=>s+r.cents,0);
const inCat=(w:World,word:string|null,r:Rec)=>!word||CATEGORY_WORDS[word](r.category);
const inRange=(range:number[]|null,r:Rec)=>!range||(r.month>=range[0]&&r.month<=range[1]);
const mutate=(token:string)=>token.slice(0,3)+token[2]+token.slice(3);

function placeholders(w:World){
  const live=w.people.filter(p=>!p.noExercise).map(p=>({p,t:sum(p.recs)})).sort((a,b)=>b.t-a.t||byName(a.p.name,b.p.name));
  const top=live.map(x=>x.p);
  const ufCount=new Map<string,number>();for(const p of top)if(p.uf)ufCount.set(p.uf,(ufCount.get(p.uf)??0)+1);
  const ufa=[...ufCount].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??null;
  const tokens=new Map<string,number>();
  for(const p of w.people)for(const t of new Set(strip(p.name).split(/\s+/).filter(t=>t.length>=3&&!['de','da','do','dos','das'].includes(t))))tokens.set(t,(tokens.get(t)??0)+1);
  const amb=[...tokens].filter(([,n])=>n>=2&&n<=8).map(([t])=>t)[0]??null;
  const typoBase=top.find(p=>strip(p.name).split(' ')[0].length>=6)??null;
  const sup=w.suppliers.filter(s=>s!=='Fornecedor pessoa física'&&/^[A-Za-zÀ-ÿ]/.test(s)&&!w.suppliers.some(o=>o!==s&&strip(o).includes(strip(s)))).map(s=>({s,t:w.people.reduce((n,p)=>n+sum(p.recs.filter(r=>r.supplier===s)),0)})).sort((a,b)=>b.t-a.t)[0]?.s??null;
  const A=top[0],B=top[1],C=top[2],E=top.at(-1);
  const map:Record<string,string|null>={
    A:A?.name??null,B:B?.name??null,C:C?.name??null,E:E?.name??null,NOEX:w.people.find(p=>p.noExercise)?.name??null,UFA:ufa,SUP:sup,AMB:amb?amb.charAt(0).toUpperCase()+amb.slice(1):null,
    A_PLAIN:A?strip(A.name):null,A_UPPER:A?.name.toUpperCase()??null,A_FIRST:A?.name.split(' ')[0]??null,B_FIRST:B?.name.split(' ')[0]??null,
    TYPO:typoBase?mutate(typoBase.name.split(' ')[0]):null
  };
  return {map,typoBase,amb,top};
}

const fill=(text:string,map:Record<string,string|null>):string|null=>{
  let missing=false;
  const out=text.replace(/\{([A-Z_]+)\}/g,(_,k)=>{const v=map[k];if(v===null||v===undefined){missing=true;return '';}return v;});
  return missing?null:out;
};

export async function buildGold(dist:string,gold:GoldLine[]):Promise<GoldItem[]>{
  const w=await load(dist),{map,typoBase,amb,top}=placeholders(w);
  const pick=(k:string)=>w.people.find(p=>p.name===map[k])!;
  const outsideRange=(p:Person,range:number[]|null)=>Boolean(range)&&p.months.length>0&&p.months.filter((m:any)=>m.month>=range![0]&&m.month<=range![1]&&m.exercise!=='outside').length===0;
  const live=(range:number[]|null,cat:string|null,uf:string|null)=>w.people.filter(p=>!p.noExercise&&!outsideRange(p,range)&&(!uf||p.uf===uf)).map(p=>({p,cents:sum(p.recs.filter(r=>inCat(w,cat,r)&&inRange(range,r))),n:p.recs.filter(r=>inCat(w,cat,r)&&inRange(range,r)).length}));
  const items:GoldItem[]=[];
  for(const line of gold){
    const e=line.expect,question=fill(line.question,map);
    const base:GoldItem={vars:map,id:line.id,category:line.category,question:question??line.question,kind:'answer',values:[],patterns:[],names:[],forbidden:[],numeric:false,tools:e.tools};
    if(question===null||(e.requires&&e.requires.some((k:string)=>map[k]===null))){items.push({...base,kind:'skip',note:'placeholder sem correspondente nesta publicação'});continue;}
    const who:Person[]=(e.who??[]).map((k:string)=>pick(k));
    const catWord:string|null=e.category??null;
    if(catWord&&!w.categories.some(CATEGORY_WORDS[catWord])){items.push({...base,kind:'refuse',codes:['category_not_in_version']});continue;}
    const months:number[]|null=e.months??null,uf=e.uf?map[e.uf.replace(/[{}]/g,'')]??e.uf:null;
    switch(e.type){
      case 'refuse':items.push({...base,kind:'refuse',codes:e.codes});break;
      case 'clarify':{
        let min=e.minOptions??2;
        if(e.mode==='fuzzy'&&!typoBase){items.push({...base,kind:'skip',note:'sem nome longo para erro de grafia'});break;}
        if(e.mode==='amb'&&!amb){items.push({...base,kind:'skip',note:'nenhum primeiro nome repetido nesta publicação'});break;}
        if(e.mode==='first'){
          const token=strip(map.A_FIRST!),n=w.people.filter(p=>strip(p.name).split(' ').includes(token)).length;
          if(n===1){items.push({...base,kind:'answer',values:[brl(sum(pick('A').recs))],numeric:true});break;}
          min=Math.min(2,n);
        }
        if(e.mode==='supplier'&&w.suppliers.filter(s=>strip(s).includes('cascol')).length<2){items.push({...base,kind:'skip',note:'fornecedor ambíguo inexistente'});break;}
        items.push({...base,kind:'clarify',codes:e.codes,minOptions:min,names:e.mode==='fuzzy'?[typoBase!.name]:[]});break;
      }
      case 'rank':{
        const rows=live(months,catWord,uf).map(r=>({...r,v:e.metric==='monthly'?roundHalf(r.cents,r.p.served):r.cents,exact:e.metric==='monthly'?r.cents/r.p.served:r.cents}));
        rows.sort((a,b)=>(e.order==='asc'?a.exact-b.exact:b.exact-a.exact)||byName(a.p.name,b.p.name));
        const shown=rows.slice(0,3);
        items.push({...base,names:shown.map(r=>r.p.name),values:shown.map(r=>brl(r.v)),numeric:true});break;
      }
      case 'profile':{
        const p=who[0];
        if(p.noExercise){items.push({...base,patterns:['não tem exercício de mandato confirmado'],forbidden:['R$']});break;}
        const recs=p.recs.filter((r:Rec)=>inCat(w,catWord,r)&&inRange(months,r)),total=sum(recs);
        const values=[brl(total),`${int(recs.length)} ${recs.length===1?'registro':'registros'}`];
        if(!months)values.push(brl(roundHalf(total,p.served)));
        items.push({...base,values,numeric:true});break;
      }
      case 'compare':{
        const [a,b]=who;
        if(a.noExercise||b.noExercise){items.push({...base,patterns:['Sem exercício confirmado'],forbidden:['R$']});break;}
        const val=(p:Person)=>{const t=sum(p.recs.filter(r=>inCat(w,catWord,r)));return e.metric==='monthly'?roundHalf(t,p.served):t;};
        const va=val(a),vb=val(b),diff=Math.abs(va-vb),values=[brl(va),brl(vb),brl(diff)];
        if(va!==vb&&vb>0)values.push(pct(diff/vb*100));
        items.push({...base,values,numeric:true,names:[a.name.split(' ')[0],b.name.split(' ')[0]]});break;
      }
      case 'supplier_top':{
        const recs:Rec[]=(who[0]?who[0].recs:w.people.flatMap(p=>p.recs)).filter((r:Rec)=>inCat(w,catWord,r));
        const totals=new Map<string,number>();for(const r of recs)totals.set(r.supplier,(totals.get(r.supplier)??0)+r.cents);
        const rows=[...totals].sort((x,y)=>y[1]-x[1]||byName(x[0],y[0])).slice(0,3);
        items.push({...base,names:rows.map(r=>r[0]),values:rows.map(r=>brl(r[1])),numeric:true});break;
      }
      case 'supplier_one':{
        const s=map.SUP!,recs=(who[0]?who[0].recs:w.people.flatMap(p=>p.recs)).filter((r:Rec)=>r.supplier===s);
        items.push({...base,values:[brl(sum(recs)),`${int(recs.length)} ${recs.length===1?'registro':'registros'}`],numeric:true});break;
      }
      case 'categories':{
        const totals=new Map<string,number>();for(const r of w.people.flatMap(p=>p.recs))totals.set(r.category,(totals.get(r.category)??0)+r.cents);
        const rows=[...totals].sort((x,y)=>y[1]-x[1]||byName(x[0],y[0])),positive=rows.reduce((n,r)=>n+Math.max(0,r[1]),0);
        items.push({...base,values:[brl(rows.reduce((n,r)=>n+r[1],0)),...rows.slice(0,3).map(r=>brl(r[1])),pct(rows[0][1]/positive*100)],numeric:true});break;
      }
      case 'uf':{
        const groups=new Map<string,number[]>();
        for(const p of w.people)if(!p.noExercise&&p.uf)groups.set(p.uf,[...(groups.get(p.uf)??[]),sum(p.recs)]);
        const rows=[...groups].map(([u,v])=>({u,t:v.reduce((a,b)=>a+b,0),n:v.length})).sort((a,b)=>b.t-a.t||a.u.localeCompare(b.u));
        items.push({...base,values:rows.slice(0,3).map(r=>brl(r.t)),names:rows.slice(0,3).map(r=>`${r.u}:`),numeric:true});break;
      }
      case 'bills_count':{
        const p=who[0],pr=p.bills.filter((b:any)=>b.proponent);
        const c={proposed:pr.length,joint:pr.filter((b:any)=>b.joint).length,coauthored:p.bills.filter((b:any)=>!b.proponent).length,norms:pr.filter((b:any)=>b.norm).length};
        const k=e.field as keyof typeof c;
        items.push({...base,patterns:k?[`(?<![\\d.,])${int(c[k])}(?![\\d.,])`]:[`${int(c.proposed)} como proponente \\(${int(c.joint)} em conjunto`,`${int(c.coauthored)} em coautoria`,`${int(c.norms)} que viraram norma`],numeric:true});break;
      }
      case 'bills_rank':{
        const rows=w.people.map(p=>({p,n:p.bills.filter((b:any)=>b.proponent).length})).sort((a,b)=>b.n-a.n||byName(a.p.name,b.p.name)).slice(0,3);
        items.push({...base,names:rows.map(r=>r.p.name),patterns:rows.map((r,i)=>`^${i+1}\\. ${esc(r.p.name)} .*: ${int(r.n)}$`),numeric:true});break;
      }
      case 'bills_type':{
        const p=who[0],n=p.bills.filter((b:any)=>b.type===e.billType).length,first=p.bills.find((b:any)=>b.type===e.billType);
        items.push({...base,patterns:first?[`${e.billType} ${first.number}/${first.year}`]:[],values:[],numeric:true,note:`${n} ${e.billType}`});break;
      }
      case 'votes':{
        const p=who[0],counts=new Map<string,number>();for(const v of p.votes)counts.set(v.category,(counts.get(v.category)??0)+1);
        items.push({...base,patterns:[`${int(p.votes.length)} votos registrados`,...[...counts].map(([c,n])=>`${esc(c)}: ${int(n)}`)],numeric:true});break;
      }
      case 'votes_cat':{
        const p=who[0],n=p.votes.filter((v:any)=>v.category===e.vote).length;
        items.push({...base,patterns:[`${esc(e.vote)}: ${int(n)}`],numeric:true});break;
      }
      case 'coverage':{
        const p=who[0];
        if(p.noExercise){items.push({...base,patterns:['Sem exercício confirmado'],forbidden:['R$']});break;}
        const c=(k:string)=>p.months.filter((m:any)=>m.exercise===k).length;
        items.push({...base,patterns:[`completo em ${int(c('full'))} m`,`parcial em ${int(c('partial'))}`,`fora do mandato em ${int(c('outside'))}`],numeric:true});break;
      }
      case 'largest':{
        const p=who[0],best=[...p.recs].sort((a,b)=>b.cents-a.cents)[0];
        items.push({...base,values:[brl(best.cents)],names:[best.supplier],numeric:true});break;
      }
      default:throw new Error(`tipo de expectativa desconhecido: ${e.type}`);
    }
  }
  void top;
  return items;
}

async function main(){
  const args=process.argv.slice(2),dist=args[args.indexOf('--dist')+1];
  if(!dist)throw new Error('uso: tsx scripts/lume-gold-expected.ts --dist <pasta dist>');
  const gold=(await fs.readFile(path.join(import.meta.dirname,'..','tests','lume','gold.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l) as GoldLine);
  const items=await buildGold(dist,gold);
  const out=path.join(import.meta.dirname,'..','output','lume-eval');
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'gold.expected.json'),JSON.stringify(items,null,1));
  console.log(`${items.length} itens, ${items.filter(i=>i.kind==='skip').length} pulados -> output/lume-eval/gold.expected.json`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(1);});
