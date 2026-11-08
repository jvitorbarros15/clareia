import {canonical,cents,hash} from './model.ts';
import type {FinancialBasis,Scope,SourceRef} from './model.ts';

export type EquationInput={kind:'annual'|'api';personId:number;raw:Record<string,any>;source:SourceRef};
export type EquationDecision={basis:FinancialBasis;personId:number;year:number;documentKey:string;annualKeys:string[];apiKeys:string[];months:number[]};
export type MultiplicityDecision={personId:number;year:number;month:number;apiRowHash:string;count:number;distinctAnnualRoutes:number;annualKeys:string[];apiKeys:string[]};
export const equationKey=(input:Pick<EquationInput,'kind'|'personId'|'source'>)=>hash(canonical([input.kind,input.personId,input.source.url,input.source.sha256,input.source.row]));
type Payment={input:EquationInput;key:string;group:string;signature:string;documentKey:string;year:number;month:number;face:number|null;glosa:number|null;net:number;installment:number|null};
function payment(input:EquationInput,scope:Scope):Payment|null{
  try{
    const r=input.raw,a=input.kind==='annual',year=Number(a?r.numAno:r.ano),month=Number(a?r.numMes:r.mes),document=String((a?r.ideDocumento:r.codDocumento)??'');
    if(!document||document==='0'||document==='Não informado'||year!==scope.year||!scope.ids.includes(input.personId)||!scope.months.includes(month)||a&&(Number(r.codLegislatura)!==scope.legislature||Number(r.ideCadastro)!==input.personId))return null;
    const money=(value:unknown)=>value===null||value===undefined||String(value).trim()===''?null:cents(String(value).trim().replace(',','.'));
    const face=money(a?r.vlrDocumento:r.valorDocumento),glosa=money(a?r.vlrGlosa:r.valorGlosa),net=money(a?r.vlrLiquido:r.valorLiquido);if(net===null)return null;
    const parcel=a?r.numParcela:r.parcela,installment=/^\d+$/.test(String(parcel))&&Number.isSafeInteger(Number(parcel))?Number(parcel):null;
    const group=canonical([input.personId,year,document]),documentKey=hash(group);
    const signature=canonical([year,month,document,a?r.txtDescricao:r.tipoDespesa,(a?r.txtNumero:r.numDocumento)||'',(a?r.datEmissao:r.dataDocumento)?.slice(0,10)||null,String((a?r.numLote:r.codLote)??''),face,glosa,net,installment]);
    return {input,key:equationKey(input),group,signature,documentKey,year,month,face,glosa,net,installment};
  }catch{return null;}
}
// An exemption only explains the document equation. It never changes the
// reported net, authorizes a duplicate, joins by supplier or declares legitimacy.
export function reviewExpenseEquations(scope:Scope,inputs:EquationInput[]):{permissions:Map<string,FinancialBasis>;decisions:EquationDecision[]}{
  const payments:Payment[]=[],invalidGroups=new Set<string>(),permissions=new Map<string,FinancialBasis>(),decisions:EquationDecision[]=[];
  for(const input of inputs){const p=payment(input,scope);if(p)payments.push(p);else{const r=input.raw;if(r&&typeof r==='object')invalidGroups.add(canonical([input.personId,Number(input.kind==='annual'?r.numAno:r.ano),String((input.kind==='annual'?r.ideDocumento:r.codDocumento)??'')]));}}
  const pool=new Map<string,{annual:Payment[];api:Payment[]}>();
  for(const p of payments){const bucket=pool.get(p.group)??{annual:[],api:[]};bucket[p.input.kind].push(p);pool.set(p.group,bucket);}
  const partial=(p:Payment)=>p.face!==null&&p.glosa!==null&&p.face>=0&&p.glosa>=0&&p.net>=0&&p.face-p.glosa>p.net;
  for(const [group,bucket] of [...pool].sort(([a],[b])=>a.localeCompare(b))){
    const pairs:{annual:Payment;api:Payment}[]=[],signatures=[...new Set([...bucket.annual,...bucket.api].map(p=>p.signature))].sort();
    for(const signature of signatures){const ar=bucket.annual.filter(p=>p.signature===signature),br=bucket.api.filter(p=>p.signature===signature);if(ar.length===1&&br.length===1)pairs.push({annual:ar[0],api:br[0]});}
    const approve=(basis:FinancialBasis,rows:typeof pairs)=>{
      if(!rows.length)return;
      for(const pair of rows){permissions.set(pair.annual.key,basis);permissions.set(pair.api.key,basis);}
      const sample=rows[0].annual;
      decisions.push({basis,personId:sample.input.personId,year:sample.year,documentKey:sample.documentKey,annualKeys:rows.map(p=>p.annual.key).sort(),apiKeys:rows.map(p=>p.api.key).sort(),months:[...new Set(rows.map(p=>p.annual.month))].sort((a,b)=>a-b)});
    };
    approve('reported-installment',pairs.filter(({annual:p})=>partial(p)&&p.installment!==null&&p.installment>0));
    // A split must close over the full contracted year, with every occurrence
    // paired exactly once, and a single document face/glosa. No inferred share.
    if(invalidGroups.has(group)||scope.months.length!==12||new Set(scope.months).size!==12||pairs.length<2||pairs.length!==bucket.annual.length||pairs.length!==bucket.api.length)continue;
    const values=bucket.annual,face=values[0].face,glosa=values[0].glosa;
    if(face===null||glosa===null||face<0||glosa<0||face-glosa<=0||values.some(p=>p.face!==face||p.glosa!==glosa||p.net<0||p.net>face-glosa)||values.reduce((sum,p)=>sum+BigInt(p.net),0n)!==BigInt(face)-BigInt(glosa))continue;
    // Keep already explained installments distinct; attach the split rule only
    // to the remaining mismatched rows, with the full group as evidence below.
    const mismatched=pairs.filter(({annual:p})=>p.face!-p.glosa! !==p.net&&!permissions.has(p.key));
    if(mismatched.length){
      for(const pair of mismatched){permissions.set(pair.annual.key,'balanced-document-split');permissions.set(pair.api.key,'balanced-document-split');}
      const sample=values[0];decisions.push({basis:'balanced-document-split',personId:sample.input.personId,year:sample.year,documentKey:sample.documentKey,annualKeys:pairs.map(p=>p.annual.key).sort(),apiKeys:pairs.map(p=>p.api.key).sort(),months:[...new Set(values.map(p=>p.month))].sort((a,b)=>a-b)});
    }
  }
  return {permissions,decisions};
}

// SIGEPA's API projection omits route. Preserve N occurrences only when N
// distinct routes in the annual corroborate every financial field and quantity.
export function reviewFlightMultiplicity(scope:Scope,inputs:EquationInput[]){
  const covered=new Set<string>(),decisions:MultiplicityDecision[]=[],annual=inputs.filter(r=>r.kind==='annual').map(input=>({input,payment:payment(input,scope)})),groups=new Map<string,EquationInput[]>();
  for(const input of inputs.filter(r=>r.kind==='api')){const key=hash(canonical([input.personId,input.raw]));groups.set(key,[...(groups.get(key)??[]),input]);}
  for(const [,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    if(rows.length<2||rows[0].raw?.tipoDespesa!=='PASSAGEM AÉREA - SIGEPA')continue;
    const first=payment(rows[0],scope);if(!first)continue;
    const matches=annual.filter(a=>a.input.personId===first.input.personId&&a.payment?.signature===first.signature);
    if(matches.length!==rows.length)continue;
    const routes=matches.map(a=>typeof a.input.raw.txtTrecho==='string'?a.input.raw.txtTrecho.replace(/\s/g,'').toUpperCase():'');
    if(routes.some(r=>!r)||new Set(routes).size!==rows.length)continue;
    const withoutRoute=matches.map(a=>canonical(Object.fromEntries(Object.entries(a.input.raw).filter(([key])=>key!=='txtTrecho'))));
    if(new Set(withoutRoute).size!==1)continue;
    const annualKeys=matches.map(a=>equationKey(a.input)).sort(),apiKeys=rows.map(equationKey).sort();if(new Set(annualKeys).size!==rows.length||new Set(apiKeys).size!==rows.length)continue;
    for(const key of apiKeys)covered.add(key);
    decisions.push({personId:first.input.personId,year:first.year,month:first.month,apiRowHash:hash(canonical(rows[0].raw)),count:rows.length,distinctAnnualRoutes:routes.length,annualKeys,apiKeys});
  }
  return {covered,decisions};
}
