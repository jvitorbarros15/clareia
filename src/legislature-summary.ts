import type {SiteSummary} from './site-summary.ts';

export const LEGISLATURE_YEARS=[2023,2024,2025,2026];

function safe(value:bigint):number{
  const result=Number(value);
  if(!Number.isSafeInteger(result))throw new Error('Total da legislatura fora da precisão segura');
  return result;
}

export function buildLegislatureSummary(years:{year:number;summary:SiteSummary}[],legislatureYears=LEGISLATURE_YEARS){
  const present=new Set<number>();
  const people=new Map<number,{id:number;name:string;cents:bigint;records:bigint;partial:boolean;years:{year:number;cents:number;records:number;confirmedMonths:number;heldMonths:number[];partial:boolean}[]}>();
  const states=new Map<string,{cents:bigint;records:bigint;deputies:Set<number>;years:Map<number,{year:number;cents:bigint;records:bigint}>}>();
  let totalCents=0n,records=0n,peopleCents=0n,unattributedCents=0n,unattributedRecords=0n;

  const publishedYears=[...years].sort((a,b)=>a.year-b.year).map(({year,summary})=>{
    if(!legislatureYears.includes(year))throw new Error('Ano fora da legislatura');
    if(present.has(year))throw new Error('Ano repetido na legislatura');
    present.add(year);
    totalCents+=BigInt(summary.totalCents);
    records+=BigInt(summary.records);

    for(const {id,name,cents,records,months} of summary.people){
      let person=people.get(id);
      if(!person)person={id,name,cents:0n,records:0n,partial:false,years:[]};
      const heldMonths:number[]=[];
      let confirmedMonths=0;
      for(const month of months){
        if(month.held){
          if(month.cents!==0||month.records!==0)throw new Error('Competência retida com valores ou registros');
          heldMonths.push(month.month);
          continue;
        }
        confirmedMonths++;
        const {uf,ufStatus}=month,monthCents=BigInt(month.cents),monthRecords=BigInt(month.records);
        if(ufStatus==='single'&&uf!==null){
          let state=states.get(uf);
          if(!state)state={cents:0n,records:0n,deputies:new Set(),years:new Map()};
          const stateYear=state.years.get(year)??{year,cents:0n,records:0n};
          stateYear.cents+=monthCents;
          stateYear.records+=monthRecords;
          state.years.set(year,stateYear);
          state.cents+=monthCents;
          state.records+=monthRecords;
          state.deputies.add(id);
          states.set(uf,state);
        }else{
          unattributedCents+=monthCents;
          unattributedRecords+=monthRecords;
        }
      }
      const partial=heldMonths.length>0;
      const personCents=BigInt(cents),personRecords=BigInt(records);
      person.years.push({year,cents:safe(personCents),records:safe(personRecords),confirmedMonths,heldMonths,partial});
      person.name=name;
      person.cents+=personCents;
      person.records+=personRecords;
      person.partial||=partial;
      people.set(id,person);
      peopleCents+=personCents;
    }

    const {months}=summary.scope;
    return {year,publicationId:summary.publicationId,months,partial:months.length<12};
  });

  if(peopleCents!==totalCents)throw new Error('Soma dos deputados diverge do total da legislatura');
  let attributedCents=0n,attributedRecords=0n;
  for(const state of states.values()){
    attributedCents+=state.cents;
    attributedRecords+=state.records;
  }
  if(attributedCents+unattributedCents!==totalCents||attributedRecords+unattributedRecords!==records)throw new Error('Soma dos estados e valores sem UF diverge do total da legislatura');

  return {
    schema:'clareia.legislature-summary.v1' as const,
    yearsPresent:[...present],
    yearsMissing:legislatureYears.filter(year=>!present.has(year)).sort((a,b)=>a-b),
    years:publishedYears,
    people:[...people.values()].sort((a,b)=>a.id-b.id).map(person=>({...person,cents:safe(person.cents),records:safe(person.records)})),
    states:[...states.keys()].sort().map(uf=>{
      const {cents,records,deputies,years}=states.get(uf)!;
      return {uf,cents:safe(cents),records:safe(records),deputies:deputies.size,years:[...years.values()].map(({year,cents,records})=>({year,cents:safe(cents),records:safe(records)}))};
    }),
    unattributed:{cents:safe(unattributedCents),records:safe(unattributedRecords)},
    totalCents:safe(totalCents),
    records:safe(records)
  };
}
