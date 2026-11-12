export type UseMonth={month:number;cents:number;records:number;exercise:string|null;held:boolean;ufStatus:string;uf:string|null};
export type UseCeiling={year:number;byUf:Record<string,number[]>};
export type CountedMonth={month:number;uf:string;expenseCents:number;ceilingCents:number;records:number};
export type Excluded={month:number;reason:'held'|'partial'};
export type CeilingUse=
  |{status:'ok';counted:CountedMonth[];excluded:Excluded[];outside:number[];expenseCents:number;ceilingCents:number;tenths:number}
  |{status:'unconfirmed';counted:CountedMonth[];excluded:Excluded[];outside:number[];missing:number[]};

// Same month rule as the expense totals: a month outside the mandate drops out unless it has an expense.
// Held and partial months leave both sides; a counted month without a confirmed UF ceiling makes the whole figure unconfirmed.
export function ceilingUse(months:UseMonth[],ceiling:UseCeiling|null,coverageApproved:boolean):CeilingUse{
  const counted:CountedMonth[]=[],excluded:Excluded[]=[],outside:number[]=[],missing:number[]=[];
  for(const m of months){
    if(coverageApproved&&m.exercise==='outside'&&m.records===0){outside.push(m.month);continue;}
    if(m.held){excluded.push({month:m.month,reason:'held'});continue;}
    if(coverageApproved&&m.exercise==='partial'){excluded.push({month:m.month,reason:'partial'});continue;}
    // Only a month confirmed as fully in office has a known ceiling; anything else leaves the figure unconfirmed.
    if(coverageApproved&&m.exercise!=='full'){missing.push(m.month);continue;}
    const uf=coverageApproved&&m.ufStatus==='single'?m.uf:null,cents=uf&&ceiling?.byUf[uf]?.[m.month-1];
    if(!uf||!cents){missing.push(m.month);continue;}
    counted.push({month:m.month,uf,expenseCents:m.cents,ceilingCents:cents,records:m.records});
  }
  if(missing.length||!counted.length)return {status:'unconfirmed',counted,excluded,outside,missing};
  const expenseCents=counted.reduce((n,c)=>n+c.expenseCents,0),ceilingCents=counted.reduce((n,c)=>n+c.ceilingCents,0);
  return {status:'ok',counted,excluded,outside,expenseCents,ceilingCents,tenths:tenthsOf(expenseCents,ceilingCents)};
}
// Percent in integer tenths, rounded half away from zero from the exact sums.
export function tenthsOf(num:number,den:number):number{
  const n=BigInt(num),d=BigInt(den),neg=n<0n,a=neg?-n:n,t=(a*2000n+d)/(2n*d);
  return Number(neg?-t:t);
}
