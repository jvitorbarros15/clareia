export interface DataSource{json<T=unknown>(path:string):Promise<T>}

export interface Cell{month:number;category:string;supplier:string;cents:number;count:number}
export interface MonthSummary{month:number;cents:number;records:number;exercise:string;partyStatus:string;party:string|null;partyValues:string[];uf:string|null}
export interface Bills{proposed:number;joint:number;coauthored:number;norms:number}
export interface Person{
  id:number;name:string;uf:string|null;partyLabel:string|null;noExercise:boolean;servedMonths:number;heldMonths:number;
  cents:number;records:number;cells:Cell[];months:MonthSummary[];bills:Bills|null;votes:Record<string,number>|null;votesHeld:number
}
export interface BillRow{id:number;type:string;number:number;year:number;summary:string;situation:string|null;situationAt:string|null;norm:{kind:string;year:number;number:string}|null;proponent:boolean;joint:boolean}
export interface VoteRow{id:string;date:string;organ:string;kind:string;description:string;matters:string[];category:string}
export interface Activity{bills:BillRow[];votes:VoteRow[]}
export interface ExpenseRow{id:string;date:string|null;month:number;cents:number;category:string;supplier:string;documentId:string|null;receipt:string|null}

export interface Publication{
  id:string;year:number;months:number[];categories:string[];people:Person[];
  coverageApproved:boolean;billsApproved:boolean;votesApproved:boolean;billsYears:number[];votesYears:number[];
  activity(id:number):Promise<Activity|null>;records(id:number):Promise<ExpenseRow[]|null>
}

interface RawIndex{scope:{ids:number[];year:number;months:number[]};people:{id:number;uf:string|null;name:string;party:string|null}[];validation:{heldMonths?:Record<string,number>}}
interface RawSummary{publicationId:string;coverageId?:string|null;billsId?:string|null;votesId?:string|null;billsYears?:number[];votesYears?:number[];categories:string[];people:{id:number;cents:number;records:number;months:MonthSummary[];bills:Bills|null;votes:Record<string,number>|null;votesHeld:number}[]}
interface RawSuppliers{publicationId:string;categories:string[];suppliers:string[];people:Record<string,[number,number,number,number,number][]>}

export async function loadPublication(source:DataSource):Promise<Publication>{
  const manifest=await source.json<{base:string}>('manifest.json'),base=manifest.base;
  const [index,summary,suppliers]=await Promise.all([source.json<RawIndex>(`${base}/index.json`),source.json<RawSummary>(`${base}/summary.json`),source.json<RawSuppliers>(`${base}/fornecedores.json`)]);
  if(suppliers.publicationId!==summary.publicationId)throw new Error('Versão indisponível. Nenhum valor foi estimado.');
  const coverageApproved=Boolean(summary.coverageId);
  const partyOf=(months:MonthSummary[],current:string|null):string|null=>{
    if(!coverageApproved)return current?`${current} (atual)`:null;
    const served=months.filter(m=>m.partyStatus!=='not-applicable');
    if(!served.length||served.some(m=>m.partyStatus==='unavailable'||m.partyStatus==='unknown'))return 'Partido indisponível';
    if(served.some(m=>m.partyStatus==='review'||m.partyStatus==='conflict'))return 'Partido em revisão';
    return [...new Set(served.flatMap(m=>m.party?[m.party]:m.partyValues))].join(' / ');
  };
  const people:Person[]=index.scope.ids.map(id=>{
    const info=index.people.find(p=>p.id===id),own=summary.people.find(p=>p.id===id);
    const months=own?.months??[],records=own?.records??0,held=index.validation.heldMonths?.[String(id)]??0;
    const noExercise=coverageApproved&&!records&&months.length>0&&months.every(m=>!m.exercise||['unknown','outside','conflict'].includes(m.exercise));
    const served=coverageApproved?months.filter(m=>m.exercise!=='outside').length:index.scope.months.length;
    const cells=(suppliers.people[String(id)]??[]).map(([month,category,supplier,cents,count])=>({month,category:suppliers.categories[category],supplier:suppliers.suppliers[supplier],cents,count}));
    return {id,name:info?.name??`ID ${id}`,uf:info?.uf??null,partyLabel:partyOf(months,info?.party??null),noExercise,servedMonths:Math.max(1,served-held),heldMonths:held,
      cents:own?.cents??0,records,cells,months,bills:own?.bills??null,votes:own?.votes??null,votesHeld:own?.votesHeld??0};
  });
  const activityCache=new Map<number,Promise<Activity|null>>(),recordsCache=new Map<number,Promise<ExpenseRow[]|null>>();
  const optional=<T>(path:string)=>source.json<T>(path).catch(()=>null);
  return {
    id:summary.publicationId,year:index.scope.year,months:index.scope.months,categories:summary.categories,people,coverageApproved,
    billsApproved:Boolean(summary.billsId),votesApproved:Boolean(summary.votesId),billsYears:summary.billsYears??[],votesYears:summary.votesYears??[],
    activity:id=>{if(!activityCache.has(id))activityCache.set(id,optional<Activity>(`${base}/atividade/${id}.json`));return activityCache.get(id)!;},
    records:id=>{if(!recordsCache.has(id))recordsCache.set(id,optional<ExpenseRow[]>(`${base}/deputados/${id}/despesas.json`));return recordsCache.get(id)!;}
  };
}
