import type { Expense } from './model.ts';
const originLabel=(r:Expense)=>r.origin?({both:'arquivo anual e API',annual:'só no arquivo anual',api:'só na API'} as const)[r.origin]:'';
export function csv(rows:Expense[]):string {
  const cell=(value:unknown)=>{let text=String(value??'');if(typeof value==='string'&&/^[\s=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[['id_ocorrencia','id_deputado','ano','mes','data_documento','categoria','fornecedor','documento','valor_centavos','origem','sha256_origem','posicao_origem','fonte_do_registro','sinal_corrigido','possivel_duplicidade'],...rows.map(r=>[r.id,r.personId,r.year,r.month,r.date??'',r.category,r.supplier,r.documentId,r.cents,r.source.url,r.source.sha256,r.source.row,originLabel(r),r.sourceCents===undefined?'':'sim',r.duplicateFlag?'sim':''])].map(row=>row.map(cell).join(';')).join('\r\n');
}
export {ceilingUse,tenthsOf} from "./ceiling-use.ts";
export {yearFolder,yearFolderOf,partialLabel} from "./year-view.ts";
