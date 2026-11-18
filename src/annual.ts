import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {blank,canonical,hash,cents,invertedApiShape,validCnpj,oddId,occurrenceId,officialUrl,publicSupplier} from './model.ts';
import {pairOccurrences} from './reconcile.ts';
import type {Scope,Expense,SourceRef,FinancialBasis} from './model.ts';

// Which record types may exist in one source only. Rule and rationale: real/README.md.
const ANNUAL_ONLY=new Set(['TELEFONIA','COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA']),API_ONLY=new Set(['PASSAGEM AÉREA - SIGEPA']);
const occurrence=(r:Expense)=>({personId:r.personId,month:r.month,documentId:blank(r.documentId),category:r.category,cents:BigInt(r.cents),number:blank(r.documentNumber),date:r.date?.slice(0,10)||null,lot:r.lot||'',record:r});
export function unionRecords(annual:Expense[],api:Expense[]) {
  const pairing=pairOccurrences(annual.map(occurrence),api.map(occurrence));
  if(pairing.fieldMismatches.length)throw new Error(`${pairing.fieldMismatches.length} pares divergem em número ou data; publicação retida`);
  const blocked=(rows:{category:string}[],allowed:Set<string>)=>[...new Set(rows.map(r=>r.category))].filter(c=>!allowed.has(c));
  const unknownAnnual=blocked(pairing.onlyAnnual,ANNUAL_ONLY),unknownApi=blocked(pairing.onlyApi,API_ONLY);
  if(unknownApi.length)throw new Error(`A API contém ocorrências não reconciliadas no arquivo anual (${unknownApi.join(', ')}); publicação retida`);
  if(unknownAnnual.length)throw new Error(`O arquivo anual contém tipos sem par na API e sem revisão (${unknownAnnual.join(', ')}); publicação retida`);
  if(!pairing.balanced)throw new Error('União das fontes não fecha em centavos; publicação retida');
  const records:Expense[]=[...pairing.matched.map(m=>({...m.annual.record,origin:'both' as const})),...pairing.onlyAnnual.map(o=>({...o.record,origin:'annual' as const})),...pairing.onlyApi.map(o=>({...o.record,origin:'api' as const}))];
  const sum=(origin:Expense['origin'])=>records.filter(r=>r.origin===origin).reduce((n,r)=>n+r.cents,0);
  return {records,paired:pairing.matched.length,onlyAnnual:pairing.onlyAnnual.length,onlyApi:pairing.onlyApi.length,onlyApiCents:pairing.onlyApiCents,originCents:{both:sum('both'),annual:sum('annual'),api:sum('api')}};
}
// After the normal match, an API leftover with net = -document pairs with an annual leftover of the same key whose value equals the document; the API value is then taken from the annual file.
export function pairApiSign(annual:Expense[],api:Expense[]):{api:Expense[];fixed:number}{
  const key=(r:Expense,c=r.cents)=>canonical([r.personId,r.month,blank(r.documentId),r.category,c]),count=(rs:Expense[])=>rs.reduce((m,r)=>m.set(key(r),(m.get(key(r))??0)+1),new Map<string,number>());
  const apiCount=count(api),spare=count(annual),taken=new Map<string,number>();
  for(const [k,n] of apiCount){const t=Math.min(n,spare.get(k)??0);taken.set(k,t);spare.set(k,(spare.get(k)??0)-t);}
  let fixed=0;
  const out=api.map(r=>{
    const k=key(r),t=taken.get(k)??0;if(t>0){taken.set(k,t-1);return r;}
    if(r.financialBasis||!invertedApiShape(r.documentCents,r.disallowedCents,r.cents,r.category))return r;
    const want=key(r,r.documentCents!),n=spare.get(want)??0;if(!n)return r;
    spare.set(want,n-1);fixed++;return {...r,cents:r.documentCents!};
  });
  return {api:out,fixed};
}
export type AnnualRow=Record<string,string>;
export function normalizeAnnual(r:AnnualRow,scope:Scope,source:SourceRef,basis?:FinancialBasis):Expense {
  const personId=Number(r.ideCadastro),year=Number(r.numAno),month=Number(r.numMes);
  if(!scope.ids.includes(personId)||year!==scope.year||!scope.months.includes(month)||Number(r.codLegislatura)!==scope.legislature)throw new Error('Linha anual fora do escopo');
  const required=['txtDescricao','vlrLiquido'];for(const field of required)if(!r[field]?.trim())throw new Error('Campo anual obrigatório ausente: '+field);
  const money=(field:string)=>r[field]?.trim()?cents(r[field].trim().replace(',','.')):null;
  const net=money('vlrLiquido')!,face=money('vlrDocumento'),glosa=money('vlrGlosa');
  if(face!==null&&glosa!==null&&face-glosa!==net&&basis!=='reported-installment'&&basis!=='balanced-document-split')throw new Error('Equação financeira anual diverge');
  const supplierId=(r.txtCNPJCPF||'').replace(/\D/g,''),verified=validCnpj(supplierId),id=occurrenceId(personId,r,verified,'txtCNPJCPF','txtFornecedor');const supplier=publicSupplier(r.txtFornecedor||'',supplierId);
  return {id,personId,year,month,category:r.txtDescricao,supplier:supplier.name,supplierKey:verified?hash('cnpj:'+supplierId):id,supplierVerified:verified,...(oddId(supplierId)?{supplierIdOdd:true as const}:{}),documentId:r.ideDocumento||'Não informado',documentNumber:r.txtNumero||'Não informado',date:r.datEmissao||null,lot:r.numLote||'',receipt:r.urlDocumento&&supplier.key!=='person'?officialUrl(r.urlDocumento,'receipt'):null,cents:net,documentCents:face,disallowedCents:glosa,source,...(basis?{financialBasis:basis}:{})};
}
export async function parseAnnual(bytes:Uint8Array,scope:Scope,observe?:(row:AnnualRow)=>void):Promise<{rows:{raw:AnnualRow;row:number}[];scanned:number}> {
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({columns:(headers:string[])=>{if(new Set(headers).size!==headers.length)throw new Error('Contrato CSV mudou: coluna duplicada');for(const field of ['ideCadastro','numAno','numMes','codLegislatura','txtDescricao','vlrLiquido','vlrDocumento','vlrGlosa','ideDocumento','txtFornecedor','txtCNPJCPF','urlDocumento','txtNumero','datEmissao','numLote'])if(!headers.includes(field))throw new Error('Contrato CSV mudou: coluna ausente '+field);return headers;},delimiter:';',bom:true,skip_empty_lines:true}));
  const rows=[];let scanned=0;
  for await(const raw of stream){const row=scanned++;observe?.(raw);if(scope.ids.includes(Number(raw.ideCadastro))&&Number(raw.numAno)===scope.year&&scope.months.includes(Number(raw.numMes)))rows.push({raw,row});}
  if(scanned===0)throw new Error('Arquivo anual vazio');
  return {rows,scanned};
}
export const annualUrl=(year:number)=>`https://www.camara.leg.br/cotas/Ano-${year}.csv.zip`;
