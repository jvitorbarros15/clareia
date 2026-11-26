const RUN=/^[a-zA-Z0-9-]{1,80}$/,YEAR=/^[0-9]{4}$/;
export type CoveragePair={historyRun:string;legacyRun:string};
export type FullSiteConfig={historyRun:string;legacyRun:string;coverageRuns:Record<number,CoveragePair>;expenseYears:Record<number,string[]>;ceilingRuns:Record<number,string>;defaultYear:number;billsRuns:string[];votesRuns:string[];socialRun?:string;amendmentsRun?:string};
const runs=(list:unknown,key:string)=>{if(!Array.isArray(list)||!list.length||!list.every(r=>typeof r==='string'&&RUN.test(r))||new Set(list).size!==list.length)throw new Error(`Configuração inválida: ${key}`);return list as string[];};
const one=(value:unknown,key:string)=>{if(typeof value!=='string'||!RUN.test(value))throw new Error(`Configuração inválida: ${key}`);return value;};
const byYear=(value:unknown,key:string):[number,unknown][]=>{
  if(typeof value!=='object'||value===null||Array.isArray(value)||!Object.keys(value).every(k=>YEAR.test(k)))throw new Error(`Configuração inválida: ${key}`);
  return Object.entries(value).map(([y,v])=>[Number(y),v]);
};
export function parseFullSiteConfig(raw:Record<string,unknown>):FullSiteConfig{
  const expenseYears=Object.fromEntries(byYear(raw.expenseYears,'expenseYears').map(([y,list])=>[y,runs(list,`expenseYears.${y}`)]));
  if(!Object.keys(expenseYears).length)throw new Error('Configuração inválida: expenseYears');
  const everyRun=Object.values(expenseYears).flat();
  if(new Set(everyRun).size!==everyRun.length)throw new Error('Configuração inválida: expenseYears repete uma execução');
  const ceilingRuns=Object.fromEntries(byYear(raw.ceilingRuns??{},'ceilingRuns').map(([y,run])=>{
    if(!(y in expenseYears))throw new Error(`Configuração inválida: ceilingRuns.${y} sem despesas desse ano`);
    return [y,one(run,`ceilingRuns.${y}`)];
  }));
  const coverageRuns=Object.fromEntries(byYear(raw.coverageRuns??{},'coverageRuns').map(([y,pair])=>{
    if(!(y in expenseYears))throw new Error(`Configuração inválida: coverageRuns.${y} sem despesas desse ano`);
    if(typeof pair!=='object'||pair===null||Array.isArray(pair))throw new Error(`Configuração inválida: coverageRuns.${y}`);
    const p=pair as Record<string,unknown>;
    return [y,{historyRun:one(p.historyRun,`coverageRuns.${y}.historyRun`),legacyRun:one(p.legacyRun,`coverageRuns.${y}.legacyRun`)}];
  })) as Record<number,CoveragePair>;
  const historyRun=one(raw.historyRun,'historyRun'),legacyRun=one(raw.legacyRun,'legacyRun');
  const pairKeys=[`${historyRun}|${legacyRun}`,...Object.values(coverageRuns).map(p=>`${p.historyRun}|${p.legacyRun}`)];
  if(new Set(pairKeys).size!==pairKeys.length)throw new Error('Configuração inválida: coverageRuns repete um par de cobertura');
  if(typeof raw.defaultYear!=='number'||!(raw.defaultYear in expenseYears))throw new Error('Configuração inválida: defaultYear deve ser um ano de expenseYears');
  return {historyRun,legacyRun,coverageRuns,expenseYears,ceilingRuns,defaultYear:raw.defaultYear,billsRuns:runs(raw.billsRuns,'billsRuns'),votesRuns:runs(raw.votesRuns,'votesRuns'),...raw.socialRun===undefined?{}:{socialRun:one(raw.socialRun,'socialRun')},...raw.amendmentsRun===undefined?{}:{amendmentsRun:one(raw.amendmentsRun,'amendmentsRun')}};
}
export const coverageOf=(config:{historyRun:string;legacyRun:string;coverageRuns:Record<number,CoveragePair>},year:number):CoveragePair=>config.coverageRuns[year]??{historyRun:config.historyRun,legacyRun:config.legacyRun};
// Each year's expenses must be of that year and cut from the same temporal version the people coverage came from.
export function assertYearVersion(year:number,version:{scope:{year:number}},coverage:{temporalSha256:string;crosscheckSha256:string},proposal:{temporalSha256:string;crosscheckSha256:string}):void{
  if(version.scope.year!==year)throw new Error(`Despesas configuradas para ${year} são de ${version.scope.year}`);
  if(coverage.temporalSha256!==proposal.temporalSha256||coverage.crosscheckSha256!==proposal.crosscheckSha256)throw new Error(`Despesas de ${year} e cobertura de pessoas vêm de versões temporais diferentes`);
}
