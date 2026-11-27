import type { Expense } from './model.ts';
const originLabel=(r:Expense)=>r.origin?({both:'arquivo anual e API',annual:'só no arquivo anual',api:'só na API'} as const)[r.origin]:'';
export function csv(rows:Expense[]):string {
  const cell=(value:unknown)=>{let text=String(value??'');if(typeof value==='string'&&/^[\s=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[['id_ocorrencia','id_deputado','ano','mes','data_documento','categoria','fornecedor','documento','valor_centavos','origem','sha256_origem','posicao_origem','fonte_do_registro','sinal_corrigido','possivel_duplicidade'],...rows.map(r=>[r.id,r.personId,r.year,r.month,r.date??'',r.category,r.supplier,r.documentId,r.cents,r.source.url,r.source.sha256,r.source.row,originLabel(r),r.sourceCents===undefined?'':'sim',r.duplicateFlag?'sim':''])].map(row=>row.map(cell).join(';')).join('\r\n');
}
export {ceilingUse,tenthsOf,ufStandings} from "./ceiling-use.ts";
export {yearFolder,yearFolderOf,partialLabel,provisionalMonths,cutoffLine} from "./year-view.ts";
export {rankingCsv,csvWarning} from "./ranking-csv.ts";

// Monthly spend for senators divides the published totalCents by the count of months whose exercise is full or partial; with zero such months, no monthly value is computed and the senator stays out of the monthly ranking.
export function senatorExercisedMonths(months:readonly {exercise?:string}[]|null|undefined):number{
  if(!Array.isArray(months))return 0;
  return months.filter(m=>Boolean(m&&(m.exercise==='full'||m.exercise==='partial'))).length;
}
export function senatorMonthlyCents(senator:{totalCents:number;months:readonly {exercise?:string}[]}):number|null{
  const n=senatorExercisedMonths(senator.months);
  return n>0?senator.totalCents/n:null;
}
