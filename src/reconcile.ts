export type Occurrence={personId:number;month:number;documentId:string;category:string;cents:bigint;number:string;date:string|null;lot:string};

export function decimalCents(text:string):bigint {
  const clean=text.trim().replace(',','.');
  if(!/^-?\d+(\.\d{1,2})?$/.test(clean))throw new Error('Valor inesperado: '+JSON.stringify(text));
  const [whole,part='']=clean.replace('-','').split('.');
  return (BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))*(clean.startsWith('-')?-1n:1n);
}

export function pairOccurrences<A extends Occurrence,B extends Occurrence>(annual:A[],api:B[]) {
  const key=(r:Occurrence)=>JSON.stringify([r.personId,r.month,r.documentId,r.category,String(r.cents)]);
  const pool=new Map<string,B[]>();
  for(const r of api)pool.set(key(r),[...(pool.get(key(r))||[]),r]);
  const matched:{annual:A;api:B}[]=[],onlyAnnual:A[]=[];
  for(const r of annual){const list=pool.get(key(r));if(list?.length)matched.push({annual:r,api:list.shift()!});else onlyAnnual.push(r);}
  const onlyApi=[...pool.values()].flat();
  const fieldMismatches=matched.filter(({annual:a,api:b})=>a.number!==b.number||(a.date||null)!==(b.date||null)||a.lot!==b.lot);
  const sum=(rows:Occurrence[])=>rows.reduce((n,r)=>n+r.cents,0n);
  return {matched,onlyAnnual,onlyApi,fieldMismatches,annualCents:sum(annual),apiCents:sum(api),onlyAnnualCents:sum(onlyAnnual),onlyApiCents:sum(onlyApi),
    balanced:sum(annual)-sum(api)===sum(onlyAnnual)-sum(onlyApi)};
}
