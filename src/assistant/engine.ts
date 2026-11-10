import {z} from 'zod';
import type {Cell,Person,Publication} from './data.ts';
import {divRound} from './format.ts';
import {categoryByKey,categoryKeys,normalize} from './vocabulary.ts';
import type {ResolvedCategory} from './vocabulary.ts';
import {MAX_CANDIDATES,resolveDeputy,resolveSupplier} from './resolve.ts';

export interface Scope{year:number;months:{from:number;to:number};category:{key:string;label:string;officials:string[]}|null;uf:string|null}
export type ErrorCode='period_out_of_scope'|'category_not_in_version'|'unknown_person'|'unknown_supplier'|'not_published'|'invalid_args'|'unavailable';
export type ToolOutput=
  |{ok:true;tool:ToolName;scope:Scope;data:any}
  |{ok:false;tool:string;error:{code:ErrorCode;detail?:any}};

const nullable=<T extends z.ZodType>(schema:T)=>schema.nullable();
const monthsArg=nullable(z.strictObject({from:z.number().int(),to:z.number().int()}));
const metric=z.enum(['total','monthly']);
const order=z.enum(['desc','asc']);
const limit=nullable(z.number().int());

export const TOOLS={
  resolve_deputy:{description:'Encontra deputados pelo nome, apelido ou sobrenome (sem acentos tudo bem). Devolve status one, many ou none. Use antes de qualquer consulta que peça deputy_id. Se vier many, peça esclarecimento.',schema:z.strictObject({query:z.string(),uf:nullable(z.string())})},
  rank_spending:{description:'Ranking de deputados por despesas da cota parlamentar. metric total soma o período; monthly é a média por mês de exercício. Deputados sem exercício confirmado ficam de fora.',schema:z.strictObject({metric,order,category:nullable(z.string()),uf:nullable(z.string()),months:monthsArg,limit})},
  deputy_spending:{description:'Despesas de um deputado: total, média por mês, por categoria e por mês. Aceita categoria e período.',schema:z.strictObject({deputy_id:z.number().int(),category:nullable(z.string()),months:monthsArg})},
  compare_spending:{description:'Compara as despesas de dois deputados (a e b) no mesmo recorte.',schema:z.strictObject({a:z.number().int(),b:z.number().int(),metric,category:nullable(z.string()),months:monthsArg})},
  top_suppliers:{description:'Maiores fornecedores por valor, de um deputado ou de todos. Aceita categoria e período.',schema:z.strictObject({deputy_id:nullable(z.number().int()),category:nullable(z.string()),months:monthsArg,limit})},
  supplier_spending:{description:'Quanto um fornecedor recebeu, por deputado e por categoria. supplier_query é o nome (ou parte).',schema:z.strictObject({supplier_query:z.string(),deputy_id:nullable(z.number().int())})},
  category_totals:{description:'Total por categoria de despesa, de todos os deputados ou de uma UF.',schema:z.strictObject({uf:nullable(z.string()),months:monthsArg})},
  uf_totals:{description:'Despesas somadas ou médias por deputado agrupadas por UF.',schema:z.strictObject({metric:z.enum(['total','average']),category:nullable(z.string()),limit})},
  expense_records:{description:'Registros de despesa de um deputado (data, fornecedor, valor, nota). Serve para perguntas como qual foi a maior despesa.',schema:z.strictObject({deputy_id:z.number().int(),category:nullable(z.string()),month:nullable(z.number().int()),supplier:nullable(z.string()),order:z.enum(['desc','asc','date']),limit})},
  deputy_coverage:{description:'Cobertura de exercício e partido por mês de um deputado.',schema:z.strictObject({deputy_id:z.number().int()})},
  deputy_bills:{description:'Projetos de lei (PL, PLP, PEC) de um deputado: contagens e lista. Quantidade mostra atividade, nunca é comparada a gastos.',schema:z.strictObject({deputy_id:z.number().int(),type:nullable(z.enum(['PL','PLP','PEC'])),role:nullable(z.enum(['proponent','coauthor'])),query:nullable(z.string()),limit})},
  deputy_votes:{description:'Votações nominais de um deputado: contagem por voto e lista. category é o voto (Sim, Não, Abstenção, Obstrução...).',schema:z.strictObject({deputy_id:z.number().int(),query:nullable(z.string()),category:nullable(z.string()),kind:nullable(z.enum(['merito','requerimento','destaque','outro'])),date_from:nullable(z.string()),date_to:nullable(z.string()),limit})},
  rank_bills:{description:'Ranking de deputados por quantidade de projetos (proposed, joint, coauthored ou norms). Só contagem.',schema:z.strictObject({metric:z.enum(['proposed','joint','coauthored','norms']),order,uf:nullable(z.string()),limit})}
} as const;
export type ToolName=keyof typeof TOOLS;
export const TOOL_NAMES=Object.keys(TOOLS) as ToolName[];

export interface ToolDefinition{name:string;description:string;parameters:Record<string,unknown>}

export function toolDefinitions(pub:Publication):ToolDefinition[]{
  const categoryValues=categoryKeys(pub.categories);
  return TOOL_NAMES.map(name=>{
    const json=z.toJSONSchema(TOOLS[name].schema,{io:'input'}) as Record<string,any>;
    delete json.$schema;
    if(json.properties?.category)json.properties.category={anyOf:[{type:'string',enum:categoryValues},{type:'null'}],description:'Categoria de despesa (valor exato da lista) ou null para todas.'};
    return {name,description:TOOLS[name].description,parameters:json};
  });
}

const fail=(tool:string,code:ErrorCode,detail?:any):ToolOutput=>({ok:false,tool,error:{code,detail}});

interface Filter{months:{from:number;to:number};officials:Set<string>|null}
const inFilter=(c:Cell,f:Filter)=>c.month>=f.months.from&&c.month<=f.months.to&&(!f.officials||f.officials.has(c.category));
export function sumCells(cells:Cell[],f:Filter){let cents=0,records=0;for(const c of cells)if(inFilter(c,f)){cents+=c.cents;records+=c.count;}return {cents,records};}

export interface Context{scope:Scope;filter:Filter;customMonths:boolean}

function context(pub:Publication,args:{category?:string|null;months?:{from:number;to:number}|null;uf?:string|null}):Context|ToolOutput{
  const lo=Math.min(...pub.months),hi=Math.max(...pub.months);
  const months=args.months??{from:lo,to:hi};
  if(!Number.isInteger(months.from)||!Number.isInteger(months.to)||months.from>months.to||months.from<lo||months.to>hi)return fail('context','period_out_of_scope',{from:lo,to:hi,year:pub.year});
  let category:ResolvedCategory|null=null;
  if(args.category){
    category=categoryByKey(pub.categories,args.category);
    if(!category)return fail('context','category_not_in_version',{available:categoryKeys(pub.categories)});
  }
  let uf:string|null=null;
  if(args.uf){uf=args.uf.toUpperCase();}
  return {scope:{year:pub.year,months,category,uf},filter:{months,officials:category?new Set(category.officials):null},customMonths:Boolean(args.months)};
}
const isFail=(x:Context|ToolOutput):x is ToolOutput=>'ok' in x;

export function monthsServedIn(pub:Publication,p:Person,ctx:Context):number|null{
  if(!ctx.customMonths)return p.servedMonths;
  if(p.heldMonths>0)return null;
  let n=0;
  for(let m=ctx.scope.months.from;m<=ctx.scope.months.to;m++){
    const s=p.months.find(x=>x.month===m);
    if(!pub.coverageApproved||!s||s.exercise!=='outside')n++;
  }
  return n;
}

const personRef=(p:Person)=>({id:p.id,name:p.name,uf:p.uf,party:p.partyLabel});
const byName=(a:{name:string},b:{name:string})=>a.name.localeCompare(b.name,'pt-BR');
const lim=(value:number|null|undefined,fallback:number,max:number)=>Math.max(1,Math.min(max,value??fallback));
const findPerson=(pub:Publication,id:number)=>pub.people.find(p=>p.id===id)??null;

function noExerciseIn(pub:Publication,p:Person,ctx:Context):boolean{
  if(!ctx.customMonths)return p.noExercise;
  const served=monthsServedIn(pub,p,ctx);
  return served!==null&&served===0&&pub.coverageApproved;
}

function shares(rows:{cents:number}[]){
  const base=rows.reduce((n,r)=>n+Math.max(0,r.cents),0);
  return rows.map(r=>r.cents>0&&base>0?r.cents/base*100:null);
}

type Runner=(pub:Publication,args:any)=>Promise<ToolOutput>;

const runners:Record<ToolName,Runner>={
  async resolve_deputy(pub,a){
    const r=resolveDeputy(pub,a.query,a.uf?String(a.uf).toUpperCase():null);
    const ref=(p:Person)=>({...personRef(p),noExercise:p.noExercise});
    const scope:Scope={year:pub.year,months:{from:Math.min(...pub.months),to:Math.max(...pub.months)},category:null,uf:null};
    if(r.status==='one')return {ok:true,tool:'resolve_deputy',scope,data:{status:'one',candidates:[ref(r.match)]}};
    if(r.status==='many')return {ok:true,tool:'resolve_deputy',scope,data:{status:'many',candidates:r.candidates.slice(0,MAX_CANDIDATES).map(ref)}};
    return {ok:true,tool:'resolve_deputy',scope,data:{status:'none',candidates:[],total:r.total}};
  },
  async rank_spending(pub,a){
    const ctx=context(pub,{...a,uf:a.uf});if(isFail(ctx))return {...ctx,tool:'rank_spending'};
    const monthly=a.metric==='monthly';
    let excludedNoExercise=0,excludedHeld=0,includedHeld=0;
    const rows:{p:Person;cents:number;records:number;served:number}[]=[];
    for(const p of pub.people){
      if(ctx.scope.uf&&p.uf!==ctx.scope.uf)continue;
      if(noExerciseIn(pub,p,ctx)){excludedNoExercise++;continue;}
      const served=monthsServedIn(pub,p,ctx);
      if(served===null&&monthly){excludedHeld++;continue;}
      if(served===null)includedHeld++;
      rows.push({p,served:served??p.servedMonths,...sumCells(p.cells,ctx.filter)});
    }
    const sign=a.order==='asc'?1:-1;
    rows.sort((x,y)=>{
      const d=monthly?x.cents*y.served-y.cents*x.served:x.cents-y.cents;
      return (d===0?0:Math.sign(d)*sign)||byName(x.p,y.p);
    });
    const n=lim(a.limit,5,10);
    return {ok:true,tool:'rank_spending',scope:ctx.scope,data:{
      metric:a.metric,order:a.order,considered:rows.length,excludedNoExercise,excludedHeld,includedHeld,
      consideredTotalCents:rows.reduce((s,r)=>s+r.cents,0),
      rows:rows.slice(0,n).map((r,i)=>({rank:i+1,...personRef(r.p),cents:r.cents,valueCents:monthly?divRound(r.cents,r.served):r.cents,records:r.records,monthsServed:r.served}))
    }};
  },
  async deputy_spending(pub,a){
    const p=findPerson(pub,a.deputy_id);if(!p)return fail('deputy_spending','unknown_person');
    const ctx=context(pub,a);if(isFail(ctx))return {...ctx,tool:'deputy_spending'};
    if(noExerciseIn(pub,p,ctx))return {ok:true,tool:'deputy_spending',scope:ctx.scope,data:{person:personRef(p),noExercise:true}};
    const served=monthsServedIn(pub,p,ctx),{cents,records}=sumCells(p.cells,ctx.filter);
    const cats=new Map<string,{cents:number;records:number}>(),months=new Map<number,{cents:number;records:number}>();
    for(const c of p.cells)if(inFilter(c,ctx.filter)){
      const x=cats.get(c.category)??{cents:0,records:0};x.cents+=c.cents;x.records+=c.count;cats.set(c.category,x);
      const y=months.get(c.month)??{cents:0,records:0};y.cents+=c.cents;y.records+=c.count;months.set(c.month,y);
    }
    const byCategory=[...cats].map(([category,v])=>({category,...v})).sort((x,y)=>y.cents-x.cents||x.category.localeCompare(y.category,'pt-BR'));
    const sh=shares(byCategory);
    return {ok:true,tool:'deputy_spending',scope:ctx.scope,data:{
      person:personRef(p),noExercise:false,totalCents:cents,records,monthsServed:served,heldMonths:p.heldMonths,
      monthlyAverageCents:served?divRound(cents,served):null,
      byCategory:byCategory.map((r,i)=>({...r,sharePercent:sh[i]})),
      byMonth:[...months].map(([month,v])=>({month,...v})).sort((x,y)=>x.month-y.month)
    }};
  },
  async compare_spending(pub,a){
    const pa=findPerson(pub,a.a),pb=findPerson(pub,a.b);if(!pa||!pb)return fail('compare_spending','unknown_person');
    const ctx=context(pub,a);if(isFail(ctx))return {...ctx,tool:'compare_spending'};
    const missing=[pa,pb].filter(p=>noExerciseIn(pub,p,ctx));
    if(missing.length)return {ok:true,tool:'compare_spending',scope:ctx.scope,data:{status:'no_exercise',people:missing.map(personRef)}};
    const monthly=a.metric==='monthly',side=(p:Person)=>{
      const served=monthsServedIn(pub,p,ctx),s=sumCells(p.cells,ctx.filter);
      return {...personRef(p),cents:s.cents,records:s.records,monthsServed:served,valueCents:monthly&&served?divRound(s.cents,served):s.cents,raw:monthly&&served?s.cents/served:s.cents};
    };
    const x=side(pa),y=side(pb);
    if(monthly&&(x.monthsServed===null||y.monthsServed===null))return fail('compare_spending','unavailable',{reason:'held_months'});
    const diff=Math.abs(x.valueCents-y.valueCents);
    const base=monthly?y.valueCents:y.valueCents;
    const {raw:_a,...ax}=x,{raw:_b,...by}=y;
    return {ok:true,tool:'compare_spending',scope:ctx.scope,data:{
      status:'ok',metric:a.metric,a:ax,b:by,diffCents:diff,
      more:x.valueCents===y.valueCents?'equal':x.valueCents>y.valueCents?'a':'b',
      percent:base>0?diff/base*100:null,baseNonPositive:base<=0,
      monthsDiffer:!monthly&&x.monthsServed!==y.monthsServed
    }};
  },
  async top_suppliers(pub,a){
    const ctx=context(pub,a);if(isFail(ctx))return {...ctx,tool:'top_suppliers'};
    let people=pub.people;
    if(a.deputy_id!==null&&a.deputy_id!==undefined){const p=findPerson(pub,a.deputy_id);if(!p)return fail('top_suppliers','unknown_person');people=[p];}
    const totals=new Map<string,{cents:number;records:number;people:Set<number>}>();
    let scopeTotal=0;
    for(const p of people)for(const c of p.cells)if(inFilter(c,ctx.filter)){
      scopeTotal+=c.cents;
      const t=totals.get(c.supplier)??{cents:0,records:0,people:new Set<number>()};t.cents+=c.cents;t.records+=c.count;t.people.add(p.id);totals.set(c.supplier,t);
    }
    const rows=[...totals].map(([supplier,v])=>({supplier,cents:v.cents,records:v.records,people:v.people.size})).sort((x,y)=>y.cents-x.cents||x.supplier.localeCompare(y.supplier,'pt-BR'));
    const shown=rows.slice(0,lim(a.limit,5,10));
    return {ok:true,tool:'top_suppliers',scope:ctx.scope,data:{
      person:people.length===1?personRef(people[0]):null,scopeTotalCents:scopeTotal,suppliers:rows.length,
      rows:shown,privatePersonNote:shown.some(r=>r.supplier==='Fornecedor pessoa física')
    }};
  },
  async supplier_spending(pub,a){
    const r=resolveSupplier(pub,a.supplier_query);
    const scope:Scope={year:pub.year,months:{from:Math.min(...pub.months),to:Math.max(...pub.months)},category:null,uf:null};
    if(r.status==='none')return {ok:true,tool:'supplier_spending',scope,data:{status:'none'}};
    if(r.status==='many')return {ok:true,tool:'supplier_spending',scope,data:{status:'many',candidates:r.candidates}};
    let people=pub.people;
    if(a.deputy_id!==null&&a.deputy_id!==undefined){const p=findPerson(pub,a.deputy_id);if(!p)return fail('supplier_spending','unknown_person');people=[p];}
    const byDeputy:{id:number;name:string;uf:string|null;party:string|null;cents:number;records:number}[]=[],cats=new Map<string,{cents:number;records:number}>();
    let cents=0,records=0;
    for(const p of people){
      let c=0,n=0;
      for(const cell of p.cells)if(cell.supplier===r.match){c+=cell.cents;n+=cell.count;const x=cats.get(cell.category)??{cents:0,records:0};x.cents+=cell.cents;x.records+=cell.count;cats.set(cell.category,x);}
      if(n){byDeputy.push({...personRef(p),cents:c,records:n});cents+=c;records+=n;}
    }
    byDeputy.sort((x,y)=>y.cents-x.cents||byName(x,y));
    return {ok:true,tool:'supplier_spending',scope,data:{
      status:'one',supplier:r.match,totalCents:cents,records,deputies:byDeputy.length,person:people.length===1?personRef(people[0]):null,
      byDeputy:byDeputy.slice(0,10),byCategory:[...cats].map(([category,v])=>({category,...v})).sort((x,y)=>y.cents-x.cents)
    }};
  },
  async category_totals(pub,a){
    const ctx=context(pub,{months:a.months,uf:a.uf});if(isFail(ctx))return {...ctx,tool:'category_totals'};
    const totals=new Map<string,{cents:number;records:number}>();
    for(const p of pub.people){
      if(ctx.scope.uf&&p.uf!==ctx.scope.uf)continue;
      for(const c of p.cells)if(inFilter(c,ctx.filter)){const t=totals.get(c.category)??{cents:0,records:0};t.cents+=c.cents;t.records+=c.count;totals.set(c.category,t);}
    }
    const rows=[...totals].map(([category,v])=>({category,...v})).sort((x,y)=>y.cents-x.cents||x.category.localeCompare(y.category,'pt-BR'));
    const sh=shares(rows);
    return {ok:true,tool:'category_totals',scope:ctx.scope,data:{
      totalCents:rows.reduce((s,r)=>s+r.cents,0),positiveTotalCents:rows.reduce((s,r)=>s+Math.max(0,r.cents),0),
      negativeAdjustmentsCents:rows.reduce((s,r)=>s+Math.min(0,r.cents),0),rows:rows.map((r,i)=>({...r,sharePercent:sh[i]}))
    }};
  },
  async uf_totals(pub,a){
    const ctx=context(pub,{category:a.category});if(isFail(ctx))return {...ctx,tool:'uf_totals'};
    const groups=new Map<string,{people:number;cents:number}>();let withoutUf=0;
    for(const p of pub.people){
      if(p.noExercise)continue;
      if(!p.uf){withoutUf++;continue;}
      const g=groups.get(p.uf)??{people:0,cents:0};g.people++;g.cents+=sumCells(p.cells,ctx.filter).cents;groups.set(p.uf,g);
    }
    const average=a.metric==='average';
    const rows=[...groups].map(([uf,g])=>({uf,people:g.people,cents:g.cents,averageCents:divRound(g.cents,g.people)}))
      .sort((x,y)=>(average?x.cents*y.people-y.cents*x.people:x.cents-y.cents)*-1||x.uf.localeCompare(y.uf));
    return {ok:true,tool:'uf_totals',scope:ctx.scope,data:{metric:a.metric,withoutUf,rows:rows.slice(0,lim(a.limit,10,27))}};
  },
  async expense_records(pub,a){
    const p=findPerson(pub,a.deputy_id);if(!p)return fail('expense_records','unknown_person');
    const ctx=context(pub,{category:a.category,months:a.month?{from:a.month,to:a.month}:null});if(isFail(ctx))return {...ctx,tool:'expense_records'};
    const all=await pub.records(p.id);if(!all)return fail('expense_records','unavailable');
    const sup=a.supplier?normalize(a.supplier):null;
    const found=all.filter(r=>(!ctx.filter.officials||ctx.filter.officials.has(r.category))&&r.month>=ctx.filter.months.from&&r.month<=ctx.filter.months.to&&(!sup||normalize(r.supplier).includes(sup)));
    const sorted=[...found].sort((x,y)=>a.order==='date'?(x.date??'').localeCompare(y.date??''):a.order==='asc'?x.cents-y.cents:y.cents-x.cents);
    return {ok:true,tool:'expense_records',scope:ctx.scope,data:{
      person:personRef(p),matched:found.length,sumCents:found.reduce((s,r)=>s+r.cents,0),
      rows:sorted.slice(0,lim(a.limit,5,20)).map(r=>({id:r.id,date:r.date,month:r.month,category:r.category,supplier:r.supplier,cents:r.cents,documentId:r.documentId,receipt:r.receipt&&/^https:\/\/([a-z0-9-]+\.)*camara\.leg\.br\//.test(r.receipt)?r.receipt:null}))
    }};
  },
  async deputy_coverage(pub,a){
    const p=findPerson(pub,a.deputy_id);if(!p)return fail('deputy_coverage','unknown_person');
    const ctx=context(pub,{});if(isFail(ctx))return {...ctx,tool:'deputy_coverage'};
    return {ok:true,tool:'deputy_coverage',scope:ctx.scope,data:{
      person:personRef(p),coverageApproved:pub.coverageApproved,noExercise:p.noExercise,monthsServed:p.servedMonths,heldMonths:p.heldMonths,
      exerciseCounts:{full:p.months.filter(m=>m.exercise==='full').length,partial:p.months.filter(m=>m.exercise==='partial').length,outside:p.months.filter(m=>m.exercise==='outside').length}
    }};
  },
  async deputy_bills(pub,a){
    const p=findPerson(pub,a.deputy_id);if(!p)return fail('deputy_bills','unknown_person');
    const ctx=context(pub,{});if(isFail(ctx))return {...ctx,tool:'deputy_bills'};
    if(!pub.billsApproved||!p.bills)return {ok:true,tool:'deputy_bills',scope:ctx.scope,data:{person:personRef(p),available:false}};
    const act=await pub.activity(p.id);if(!act)return fail('deputy_bills','unavailable');
    const q=a.query?normalize(a.query):null;
    const found=act.bills.filter(b=>(!a.type||b.type===a.type)&&(!a.role||(a.role==='proponent')===b.proponent)&&(!q||normalize(`${b.type} ${b.number} ${b.year} ${b.summary}`).includes(q)));
    return {ok:true,tool:'deputy_bills',scope:ctx.scope,data:{
      person:personRef(p),available:true,years:pub.billsYears,counts:p.bills,matched:found.length,
      rows:found.slice(0,lim(a.limit,5,10)).map(b=>({id:b.id,type:b.type,number:b.number,year:b.year,summary:b.summary,situation:b.situation,norm:b.norm,proponent:b.proponent,joint:b.joint}))
    }};
  },
  async deputy_votes(pub,a){
    const p=findPerson(pub,a.deputy_id);if(!p)return fail('deputy_votes','unknown_person');
    const ctx=context(pub,{});if(isFail(ctx))return {...ctx,tool:'deputy_votes'};
    if(!pub.votesApproved||!p.votes)return {ok:true,tool:'deputy_votes',scope:ctx.scope,data:{person:personRef(p),available:false}};
    const act=await pub.activity(p.id);if(!act)return fail('deputy_votes','unavailable');
    const q=a.query?normalize(a.query):null,cat=a.category?normalize(a.category):null;
    const found=act.votes.filter(v=>(!cat||normalize(v.category)===cat)&&(!a.kind||v.kind===a.kind)&&(!a.date_from||v.date>=a.date_from)&&(!a.date_to||v.date<=a.date_to)&&(!q||normalize(`${v.matters.join(' ')} ${v.description}`).includes(q)));
    const counts=Object.entries(p.votes).sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0],'pt-BR')).map(([category,n])=>({category,n}));
    return {ok:true,tool:'deputy_votes',scope:ctx.scope,data:{
      person:personRef(p),available:true,years:pub.votesYears,counts,totalVotes:counts.reduce((s,c)=>s+c.n,0),votesHeld:p.votesHeld,matched:found.length,
      rows:found.slice(0,lim(a.limit,5,10)).map(v=>({id:v.id,date:v.date,organ:v.organ,kind:v.kind,matters:v.matters,description:v.description,category:v.category}))
    }};
  },
  async rank_bills(pub,a){
    const ctx=context(pub,{uf:a.uf});if(isFail(ctx))return {...ctx,tool:'rank_bills'};
    if(!pub.billsApproved)return {ok:true,tool:'rank_bills',scope:ctx.scope,data:{available:false}};
    const people=pub.people.filter(p=>p.bills&&(!ctx.scope.uf||p.uf===ctx.scope.uf));
    const sign=a.order==='asc'?1:-1;
    const rows=people.map(p=>({...personRef(p),n:(p.bills as any)[a.metric] as number})).sort((x,y)=>((x.n-y.n)*sign)||byName(x,y));
    return {ok:true,tool:'rank_bills',scope:ctx.scope,data:{available:true,metric:a.metric,order:a.order,years:pub.billsYears,considered:rows.length,rows:rows.slice(0,lim(a.limit,5,10)).map((r,i)=>({rank:i+1,...r}))}};
  }
};

export async function runTool(pub:Publication,name:string,rawArgs:unknown):Promise<ToolOutput>{
  if(!(name in TOOLS))return fail(name,'invalid_args',{reason:'unknown_tool'});
  const parsed=TOOLS[name as ToolName].schema.safeParse(rawArgs);
  if(!parsed.success)return fail(name,'invalid_args',{reason:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')});
  try{return await runners[name as ToolName](pub,parsed.data);}
  catch{return fail(name,'unavailable');}
}
