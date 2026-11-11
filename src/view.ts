import type { Snapshot,Expense } from './model.ts';
export type Filters={personId:number;from:number;to:number;category:string|null;supplier:string|null};
export function parseFilters(params:URLSearchParams,snapshot:Snapshot):Filters {
  const int=(name:string,fallback:number)=>{const v=params.get(name);return !v?fallback:/^\d+$/.test(v)?Number(v):NaN;};
  const personId=int('person',snapshot.scope.ids[0]),from=int('from',Math.min(...snapshot.scope.months)),to=int('to',Math.max(...snapshot.scope.months));
  if(!snapshot.scope.ids.includes(personId)||!Number.isInteger(from)||!Number.isInteger(to)||from>to||!snapshot.scope.months.includes(from)||!snapshot.scope.months.includes(to))throw new Error('Recorte fora da cobertura');
  const category=params.get('category')||null,supplier=params.get('supplier')||null;
  if(category&&!snapshot.records.some(r=>r.personId===personId&&r.category===category))throw new Error('Categoria fora da cobertura');
  if(supplier&&!snapshot.records.some(r=>r.personId===personId&&r.supplierKey===supplier))throw new Error('Fornecedor fora da cobertura');
  return {personId,from,to,category,supplier};
}
export function results(snapshot:Snapshot,filters:Filters){
  const all=snapshot.records.filter(r=>r.personId===filters.personId&&r.month>=filters.from&&r.month<=filters.to);
  const filteredCategory=all.filter(r=>!filters.category||r.category===filters.category);
  const records=filteredCategory.filter(r=>!filters.supplier||r.supplierKey===filters.supplier);
  const sum=(rows:Expense[])=>rows.reduce((n,r)=>n+r.cents,0);
  return {snapshotId:snapshot.id,metric:snapshot.metric,scope:snapshot.scope,filters,people:snapshot.people,person:snapshot.people.find(p=>p.id===filters.personId),collectedAt:snapshot.collectedAt,publishedAt:snapshot.publishedAt,validation:snapshot.validation,
    totalCents:sum(records),recordCount:records.length,
    months:snapshot.scope.months.filter(m=>m>=filters.from&&m<=filters.to).map(month=>({month,cents:sum(records.filter(r=>r.month===month)),count:records.filter(r=>r.month===month).length})),
    categories:[...new Set(all.map(r=>r.category))].sort().map(category=>({category,cents:sum(all.filter(r=>r.category===category))})),
    suppliers:[...new Set(filteredCategory.map(r=>r.supplierKey))].map(key=>{const rows=filteredCategory.filter(r=>r.supplierKey===key);return {key,name:rows[0].supplier,verified:rows[0].supplierVerified,cents:sum(rows),count:rows.length};}),records};
}
const originLabel=(r:Expense)=>r.origin?({both:'arquivo anual e API',annual:'só no arquivo anual',api:'só na API'} as const)[r.origin]:'';
export function csv(rows:Expense[]):string {
  const cell=(value:unknown)=>{let text=String(value??'');if(typeof value==='string'&&/^[\s=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[['id_ocorrencia','id_deputado','ano','mes','categoria','fornecedor','documento','valor_centavos','origem','sha256_origem','posicao_origem','fonte_do_registro'],...rows.map(r=>[r.id,r.personId,r.year,r.month,r.category,r.supplier,r.documentId,r.cents,r.source.url,r.source.sha256,r.source.row,originLabel(r)])].map(row=>row.map(cell).join(';')).join('\r\n');
}
export type PublicIndex=Omit<Snapshot,'records'|'id'|'pages'>&{snapshotId:string;withoutData:number[];audit:unknown};
// A deputy with no published file is unavailable, which is different from having spent nothing.
export function personView(index:PublicIndex,records:Expense[]|null,params:URLSearchParams){
  if(!records)return null;
  const snapshot={...index,id:index.snapshotId,pages:[],records};
  return results(snapshot,parseFilters(params,snapshot));
}
export {ceilingUse,tenthsOf,compareUse} from "./ceiling-use.ts";
