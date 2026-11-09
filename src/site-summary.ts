import type {Expense,Person,Scope} from './model.ts';
import type {CoverageRow} from './people-publication.ts';

export type MonthSummary={month:number;cents:number;records:number;exercise:string|null;partyStatus:string;party:string|null;partyValues:string[];ufStatus:string;uf:string|null;review:boolean;partialScope:boolean};
export type PersonSummary={id:number;name:string;photo:string|null;cents:number;records:number;months:MonthSummary[];categories:{category:string;cents:number;records:number}[]};
export type SiteSummary={schema:'clareia.site-summary.v1';publicationId:string;coverageId:string|null;scope:Scope;totalCents:number;records:number;people:PersonSummary[]};

const safe=(n:bigint):number=>{if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Total do resumo fora da precisão segura');return Number(n);};
const sum=(rows:Expense[]):number=>safe(rows.reduce((n,r)=>n+BigInt(r.cents),0n));

// Party and UF come only from an approved monthly coverage. Without one they stay
// unavailable: the current registration must never be applied to a past expense.
export function buildSiteSummary(input:{publicationId:string;scope:Scope;people:Person[];records:Expense[];expectedTotalCents:number;coverageId:string|null;coverage:CoverageRow[]}):SiteSummary{
  const {publicationId,scope,people,records,expectedTotalCents,coverageId,coverage}=input;
  if(coverageId===null&&coverage.length)throw new Error('Cobertura sem versão aprovada');
  const attribution=new Map(coverage.map(row=>[row.personId+':'+row.year+':'+row.month,row])),byPerson=new Map<number,Expense[]>();
  for(const r of records){if(!scope.ids.includes(r.personId)||r.year!==scope.year||!scope.months.includes(r.month))throw new Error('Registro fora do recorte do resumo');const list=byPerson.get(r.personId);if(list)list.push(r);else byPerson.set(r.personId,[r]);}
  const summaries=scope.ids.map<PersonSummary>(id=>{
    const person=people.find(p=>p.id===id);if(!person)throw new Error('Pessoa do recorte sem cadastro');
    const own=byPerson.get(id)??[],categories=[...new Set(own.map(r=>r.category))].sort().map(category=>{const rows=own.filter(r=>r.category===category);return {category,cents:sum(rows),records:rows.length};});
    const months=[...scope.months].sort((a,b)=>a-b).map<MonthSummary>(month=>{
      const rows=own.filter(r=>r.month===month),row=attribution.get(id+':'+scope.year+':'+month);
      return {month,cents:sum(rows),records:rows.length,exercise:row?.exercise??null,partyStatus:row?.partyStatus??'unavailable',party:row?.party??null,partyValues:row?.partyValues??[],ufStatus:row?.ufStatus??'unavailable',uf:row?.uf??null,review:row?.review??false,partialScope:row?.partialScope??false};
    });
    return {id,name:person.name,photo:person.photo,cents:sum(own),records:own.length,months,categories};
  });
  const totalCents=sum(records);
  if(totalCents!==expectedTotalCents)throw new Error('Resumo diverge do total aprovado');
  if(safe(summaries.reduce((n,p)=>n+BigInt(p.cents),0n))!==totalCents)throw new Error('Soma das pessoas diverge do total do resumo');
  return {schema:'clareia.site-summary.v1',publicationId,coverageId,scope,totalCents,records:records.length,people:summaries};
}
