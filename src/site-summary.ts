import {maskPersonalId} from './model.ts';
import type {Expense,Person,Scope} from './model.ts';
import type {CoverageRow} from './people-publication.ts';
import type {BillPerson} from './bills.ts';
import type {SiteCeiling} from './ceiling-site.ts';

export type MonthSummary={month:number;cents:number;records:number;exercise:string|null;partyStatus:string;party:string|null;partyValues:string[];ufStatus:string;uf:string|null;held:boolean};
// [month, category index, cents, records]
export type Cell=[number,number,number,number];
// [month, category index, supplier index, cents, records]
export type SupplierCell=[number,number,number,number,number];
export type PersonSummary={id:number;name:string;photo:string|null;cents:number;records:number;months:MonthSummary[];categories:{category:string;cents:number;records:number}[];cells:Cell[];bills:Omit<BillPerson,'id'>|null;votes:Record<string,number>|null;votesHeld:number};
export type SiteSummary={schema:'clareia.site-summary.v1';publicationId:string;coverageId:string|null;billsId:string|null;billsYears:number[];votesId:string|null;votesYears:number[];ceiling:SiteCeiling|null;scope:Scope;totalCents:number;records:number;categories:string[];people:PersonSummary[]};
export type SupplierSummary={schema:'clareia.supplier-summary.v1';publicationId:string;categories:string[];suppliers:string[];people:Record<string,SupplierCell[]>};
export type SupplierNames=Record<string,{name:string}>;

const safe=(n:bigint):number=>{if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Total do resumo fora da precisão segura');return Number(n);};
const sum=(rows:Expense[]):number=>safe(rows.reduce((n,r)=>n+BigInt(r.cents),0n));
const sorted=(values:Iterable<string>):string[]=>[...new Set(values)].sort();
function group(rows:Expense[],key:(r:Expense)=>string):Map<string,Expense[]>{
  const out=new Map<string,Expense[]>();
  for(const r of rows){const k=key(r),list=out.get(k);if(list)list.push(r);else out.set(k,[r]);}
  return out;
}
function cellsOf(rows:Expense[],categoryIndex:Map<string,number>):Cell[]{
  return [...group(rows,r=>r.month+'\u0000'+r.category)].map<Cell>(([,list])=>[list[0].month,categoryIndex.get(list[0].category)!,sum(list),list.length]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}

// Party and UF come only from an approved monthly coverage. Without one they stay
// unavailable: the current registration must never be applied to a past expense.
export function buildSiteSummary(input:{publicationId:string;scope:Scope;people:Person[];records:Expense[];expectedTotalCents:number;coverageId:string|null;coverage:CoverageRow[];billsId?:string|null;billsYears?:number[];bills?:BillPerson[];votesId?:string|null;votesYears?:number[];votes?:Map<number,Record<string,number>>;votesHeld?:Map<number,number>;held?:{personId:number;month:number}[];ceiling?:SiteCeiling|null}):SiteSummary{
  const {publicationId,scope,people,records,expectedTotalCents,coverageId,coverage}=input,ceiling=input.ceiling??null,billsId=input.billsId??null,billsOf=new Map((input.bills??[]).map(b=>[b.id,b]));
  if(billsId!==null&&!input.billsYears?.includes(scope.year))throw new Error('Proposições aprovadas não cobrem o ano do site');
  if(coverageId===null&&coverage.length)throw new Error('Cobertura sem versão aprovada');
  if(ceiling&&ceiling.year!==scope.year)throw new Error('Limite da cota não cobre o ano do site');
  const heldKeys=new Set((input.held??[]).map(h=>h.personId+':'+h.month)),attribution=new Map(coverage.map(row=>[row.personId+':'+row.year+':'+row.month,row])),byPerson=new Map<number,Expense[]>();
  for(const r of records){if(!scope.ids.includes(r.personId)||r.year!==scope.year||!scope.months.includes(r.month))throw new Error('Registro fora do recorte do resumo');const list=byPerson.get(r.personId);if(list)list.push(r);else byPerson.set(r.personId,[r]);}
  const categoryList=sorted(records.map(r=>r.category)),categoryIndex=new Map(categoryList.map((c,i)=>[c,i]));
  const summaries=scope.ids.map<PersonSummary>(id=>{
    const person=people.find(p=>p.id===id);if(!person)throw new Error('Pessoa do recorte sem cadastro');
    const own=byPerson.get(id)??[],categories=[...new Set(own.map(r=>r.category))].sort().map(category=>{const rows=own.filter(r=>r.category===category);return {category,cents:sum(rows),records:rows.length};});
    const months=[...scope.months].sort((a,b)=>a-b).map<MonthSummary>(month=>{
      const rows=own.filter(r=>r.month===month),row=attribution.get(id+':'+scope.year+':'+month);
      if(heldKeys.has(id+':'+month)&&rows.length)throw new Error('Competência retida com registros');
      return {month,cents:sum(rows),records:rows.length,exercise:row?.exercise??null,partyStatus:row?.partyStatus??'unavailable',party:row?.party??null,partyValues:row?.partyValues??[],ufStatus:row?.ufStatus??'unavailable',uf:row?.uf??null,held:heldKeys.has(id+':'+month)};
    });
    // With an approved version, a deputy absent from it has zero counted bills; without one the count is unknown.
    const counted=billsOf.get(id);
    const cells=cellsOf(own,categoryIndex);
    if(safe(cells.reduce((n,c)=>n+BigInt(c[2]),0n))!==sum(own)||cells.reduce((n,c)=>n+c[3],0)!==own.length)throw new Error('Células mensais divergem dos registros de uma pessoa');
    return {id,name:person.name,photo:person.photo,cents:sum(own),records:own.length,months,categories,cells,bills:billsId===null?null:{proposed:counted?.proposed??0,joint:counted?.joint??0,coauthored:counted?.coauthored??0,norms:counted?.norms??0},votes:input.votesId?input.votes?.get(id)??{}:null,votesHeld:input.votesHeld?.get(id)??0};
  });
  const totalCents=sum(records);
  if(totalCents!==expectedTotalCents)throw new Error('Resumo diverge do total aprovado');
  if(safe(summaries.reduce((n,p)=>n+BigInt(p.cents),0n))!==totalCents)throw new Error('Soma das pessoas diverge do total do resumo');
  return {schema:'clareia.site-summary.v1',publicationId,coverageId,billsId,billsYears:input.billsYears??[],votesId:input.votesId??null,votesYears:input.votesYears??[],ceiling,scope,totalCents,records:records.length,categories:categoryList,people:summaries};
}

// A validated CNPJ is one supplier whatever its spelling; the rest are grouped by typed name. Display name: reviewed override, else the spelling with the most records (then largest absolute value, latest date, alphabetical), so a stray typed name cannot easily become the label.
const entryOf=(r:Expense):string=>r.supplierVerified?'k:'+r.supplierKey:'n:'+r.supplier;
const KEY=/^[0-9a-f]{64}$/;
const assertNames=(names:SupplierNames):void=>{for(const key of Object.keys(names))if(!KEY.test(key))throw new Error('Chave de nome revisado inválida');};
export function supplierDisplayNames(records:Expense[],names:SupplierNames={}):Map<string,string>{
  assertNames(names);
  const entries=[...group(records,entryOf)].map(([id,list])=>{
    const spellings=new Map<string,{abs:number;n:number;date:string}>(),verified=list[0].supplierVerified;
    for(const r of list){const t=spellings.get(r.supplier)??{abs:0,n:0,date:''};t.abs+=Math.abs(r.cents);t.n++;if((r.date??'')>t.date)t.date=r.date??'';spellings.set(r.supplier,t);}
    const main=[...spellings].sort(([a,x],[b,y])=>y.n-x.n||y.abs-x.abs||(y.date>x.date?1:y.date<x.date?-1:0)||(a<b?-1:a>b?1:0))[0][0];
    const key=list[0].supplierKey!,reviewed=verified&&Object.hasOwn(names,key);
    return {id,verified,reviewed,name:reviewed?names[key].name:verified?main:list[0].supplier};
  });
  const byName=new Map<string,typeof entries>(),taken=new Set(entries.map(e=>e.name)),out=new Map<string,string>();
  for(const e of entries){const list=byName.get(e.name);if(list)list.push(e);else byName.set(e.name,[e]);}
  // Same name, different CNPJ: typed-name entries keep the plain name, then CNPJs in supplierKey order (deterministic within a publication, not guaranteed across publications); the others get " · 2", " · 3"…
  for(const [name,same] of byName){
    if(same.length>1&&same.some(e=>e.reviewed))throw new Error('Nome revisado colide com outro fornecedor: '+name);
    same.sort((a,b)=>Number(a.verified)-Number(b.verified)||(a.id<b.id?-1:1));
    let n=1;
    for(const [i,e] of same.entries()){
      if(i===0){out.set(e.id,name);continue;}
      let label:string;do{n++;label=name+' · '+n;}while(taken.has(label));
      taken.add(label);out.set(e.id,label);
    }
  }
  return out;
}
// What the page shows for a record whose typed name is not the supplier's display name.
export function withSupplierLabels(records:Expense[],names:SupplierNames={}):(Expense&{supplierLabel?:string})[]{
  const display=supplierDisplayNames(records,names);
  return records.map(r=>{const supplierLabel=display.get(entryOf(r))!;return supplierLabel===r.supplier?r:{...r,supplierLabel};});
}

// Grouped in a separate pass and checked cell by cell against the summary, so a grouping slip in either is refused.
export function buildSupplierSummary(summary:SiteSummary,records:Expense[],names:SupplierNames={}):SupplierSummary{
  const categoryIndex=new Map(summary.categories.map((c,i)=>[c,i])),display=supplierDisplayNames(records,names),labelOf=(r:Expense)=>display.get(entryOf(r))!,suppliers=sorted(display.values()),supplierIndex=new Map(suppliers.map((s,i)=>[s,i])),people:Record<string,SupplierCell[]>={};
  const byPerson=group(records,r=>String(r.personId));
  for(const person of summary.people){
    const own=byPerson.get(String(person.id))??[];
    people[person.id]=[...group(own,r=>r.month+'\u0000'+r.category+'\u0000'+labelOf(r))].map<SupplierCell>(([,list])=>{const r=list[0],category=categoryIndex.get(r.category);if(category===undefined)throw new Error('Categoria ausente do resumo');return [r.month,category,supplierIndex.get(labelOf(r))!,sum(list),list.length];}).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
  }
  const result:SupplierSummary={schema:'clareia.supplier-summary.v1',publicationId:summary.publicationId,categories:summary.categories,suppliers,people};
  assertSuppliersMatchSummary(summary,result);
  return result;
}
export function assertSuppliersMatchSummary(summary:SiteSummary,suppliers:SupplierSummary):void{
  if(suppliers.publicationId!==summary.publicationId||JSON.stringify(suppliers.categories)!==JSON.stringify(summary.categories))throw new Error('Fornecedores de outra versão do resumo');
  if(Object.keys(suppliers.people).length!==summary.people.length)throw new Error('Fornecedores divergem das pessoas do resumo');
  if(suppliers.suppliers.some(n=>maskPersonalId(n)!==n))throw new Error('Identificador privado no nome de um fornecedor');
  for(const person of summary.people){
    const rows=suppliers.people[person.id];if(!rows)throw new Error('Fornecedores divergem das pessoas do resumo');
    const folded=new Map<string,[bigint,number]>();
    for(const [month,category,,cents,n] of rows){const k=month+':'+category,t=folded.get(k)??[0n,0];folded.set(k,[t[0]+BigInt(cents),t[1]+n]);}
    if(folded.size!==person.cells.length||person.cells.some(([month,category,cents,n])=>{const t=folded.get(month+':'+category);return !t||safe(t[0])!==cents||t[1]!==n;}))throw new Error('Fornecedores divergem das células mensais');
  }
}
