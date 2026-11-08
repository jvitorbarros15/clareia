import {hash,canonical} from './model.ts';
import type {FinancialBasis,Scope} from './model.ts';
import type {EquationInput,EquationDecision,EquationHold,MultiplicityDecision} from './expense-equations.ts';

// Separate implementation of the same rules, not independent methodological
// validation. No normalizer, money parser, permission or grouping code is reused.
export function independentEquationReview(scope:Scope,inputs:EquationInput[]){
  const permissions=new Map<string,FinancialBasis>(),decisions:EquationDecision[]=[],blocked=new Set<string>(),holds:EquationHold[]=[],blockedKeys=new Set<string>(),originalGroups=new Map<string,EquationInput[]>();
  type Row={kind:'annual'|'api';person:number;year:number;month:number;document:string;key:string;signature:string;face:number|null;glosa:number|null;net:number;parcel:number|null};
  const groups=new Map<string,Row[]>();
  const parseMoney=(value:unknown)=>{
    if(value===null||value===undefined||String(value).trim()==='')return null;
    const s=String(value).trim().replace(',','.'),m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);if(!m)throw Error();
    const result=(BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0')))*(m[1]?-1n:1n);if(!Number.isSafeInteger(Number(result)))throw Error();return Number(result);
  };
  for(const input of inputs){
    const r=input.raw;if(!r||typeof r!=='object')continue;
    const annual=input.kind==='annual',year=Number(annual?r.numAno:r.ano),document=String((annual?r.ideDocumento:r.codDocumento)??''),group=JSON.stringify([input.personId,year,document]);
    originalGroups.set(group,[...(originalGroups.get(group)??[]),input]);
    try{
      const month=Number(annual?r.numMes:r.mes),net=parseMoney(annual?r.vlrLiquido:r.valorLiquido),face=parseMoney(annual?r.vlrDocumento:r.valorDocumento),glosa=parseMoney(annual?r.vlrGlosa:r.valorGlosa);
      if(!document||['0','Não informado'].includes(document)||year!==scope.year||!scope.ids.includes(input.personId)||!scope.months.includes(month)||annual&&(Number(r.codLegislatura)!==scope.legislature||Number(r.ideCadastro)!==input.personId)||net===null)throw Error();
      const rawParcel=annual?r.numParcela:r.parcela,parcel=/^\d+$/.test(String(rawParcel))&&Number.isSafeInteger(Number(rawParcel))?Number(rawParcel):null;
      const signature=JSON.stringify([year,month,document,annual?r.txtDescricao:r.tipoDespesa,(annual?r.txtNumero:r.numDocumento)||'',(annual?r.datEmissao:r.dataDocumento)?.substring(0,10)||null,String((annual?r.numLote:r.codLote)??''),face,glosa,net,parcel]);
      const key=hash(JSON.stringify([input.kind,input.personId,input.source.url,input.source.sha256,input.source.row]));
      const row:Row={kind:input.kind,person:input.personId,year,month,document,key,signature,face,glosa,net,parcel};groups.set(group,[...(groups.get(group)??[]),row]);
    }catch{blocked.add(group);}
  }
  for(const [group,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const annual=rows.filter(r=>r.kind==='annual'),api=rows.filter(r=>r.kind==='api'),pairs:{a:Row;b:Row}[]=[];
    for(const signature of [...new Set(rows.map(r=>r.signature))].sort()){
      const left=annual.filter(r=>r.signature===signature),right=api.filter(r=>r.signature===signature);if(left.length===1&&right.length===1)pairs.push({a:left[0],b:right[0]});
    }
    const documentFace=annual[0]?.face,documentGlosa=annual[0]?.glosa,totalObserved=annual.reduce((n,r)=>n+BigInt(r.net),0n);
    let documentKnown=!blocked.has(group)&&pairs.length>0&&pairs.length===annual.length&&pairs.length===api.length&&documentFace!==undefined&&documentFace!==null&&documentGlosa!==undefined&&documentGlosa!==null;
    if(documentKnown){const ceiling=BigInt(documentFace!)-BigInt(documentGlosa!);documentKnown=documentFace!>=0&&documentGlosa!>=0&&ceiling>=0n&&annual.every(r=>r.face===documentFace&&r.glosa===documentGlosa&&r.net>=0);}
    const documentSafe=documentKnown&&totalObserved<=BigInt(documentFace!)-BigInt(documentGlosa!),original=originalGroups.get(group)!;
    const hasInstallment=original.some(input=>{const value=input.kind==='annual'?input.raw.numParcela:input.raw.parcela;return /^[1-9][0-9]*$/.test(String(value))&&Number.isSafeInteger(Number(value));});
    const exceedsDocument=[annual,api].some(list=>{const head=list[0];if(!head)return false;const usable=list.filter(r=>r.face!==null&&r.glosa!==null);return [...new Set(usable.map(r=>r.face!))].some(face=>{const members=usable.filter(r=>r.face===face),lowest=members.reduce((m,r)=>r.glosa!<m?r.glosa!:m,members[0].glosa!);return new Set(members.map(r=>r.signature)).size>=2&&members.reduce((n,r)=>n+BigInt(r.net),0n)>BigInt(face)-BigInt(lowest);});});
    if(exceedsDocument||hasInstallment&&!documentSafe){
      const key=(input:EquationInput)=>hash(JSON.stringify([input.kind,input.personId,input.source.url,input.source.sha256,input.source.row]));
      original.forEach(input=>blockedKeys.add(key(input)));holds.push({personId:original[0].personId,year:scope.year,documentKey:hash(group),months:[...new Set(original.map(input=>Number(input.kind==='annual'?input.raw.numMes:input.raw.mes)))].sort((a,b)=>a-b),annualKeys:original.filter(input=>input.kind==='annual').map(key).sort(),apiKeys:original.filter(input=>input.kind==='api').map(key).sort(),reason:documentKnown||exceedsDocument?'over-document-limit':'document-group-unconfirmed'});continue;
    }
    const installment=documentSafe?pairs.filter(({a:r})=>r.face!==null&&r.glosa!==null&&r.net>=0&&BigInt(r.net)<BigInt(r.face)-BigInt(r.glosa)&&r.parcel!==null&&r.parcel>0):[];
    if(installment.length){
      for(const p of installment){permissions.set(p.a.key,'reported-installment');permissions.set(p.b.key,'reported-installment');}
      decisions.push({basis:'reported-installment',personId:installment[0].a.person,year:installment[0].a.year,documentKey:hash(group),annualKeys:installment.map(p=>p.a.key).sort(),apiKeys:installment.map(p=>p.b.key).sort(),months:[...new Set(installment.map(p=>p.a.month))].sort((a,b)=>a-b),documentBudget:{faceCents:documentFace!,disallowedCents:documentGlosa!,observedNetCents:String(totalObserved),annualKeys:pairs.map(p=>p.a.key).sort(),apiKeys:pairs.map(p=>p.b.key).sort()}});
    }
    if(blocked.has(group)||scope.months.length!==12||new Set(scope.months).size!==12||pairs.length<2||pairs.length!==annual.length||pairs.length!==api.length)continue;
    const face=annual[0].face,glosa=annual[0].glosa;
    if(face===null||glosa===null||face<0||glosa<0||face<=glosa||annual.some(r=>r.face!==face||r.glosa!==glosa||r.net<0||BigInt(r.net)>BigInt(face)-BigInt(glosa))||annual.reduce((n,r)=>n+BigInt(r.net),0n)!==BigInt(face)-BigInt(glosa))continue;
    const explain=pairs.filter(({a})=>a.face!-a.glosa! !==a.net&&!permissions.has(a.key));
    if(explain.length){
      for(const p of explain){permissions.set(p.a.key,'balanced-document-split');permissions.set(p.b.key,'balanced-document-split');}
      decisions.push({basis:'balanced-document-split',personId:annual[0].person,year:annual[0].year,documentKey:hash(group),annualKeys:pairs.map(p=>p.a.key).sort(),apiKeys:pairs.map(p=>p.b.key).sort(),months:[...new Set(annual.map(r=>r.month))].sort((a,b)=>a-b)});
    }
  }
  const auditKey=(input:EquationInput)=>hash(JSON.stringify([input.kind,input.personId,input.source.url,input.source.sha256,input.source.row]));
  for(const [group,original] of [...originalGroups].filter(([g])=>!groups.has(g)).sort(([a],[b])=>a.localeCompare(b))){
    if(!original.some(input=>/^[1-9][0-9]*$/.test(String(input.kind==='annual'?input.raw.numParcela:input.raw.parcela))))continue;
    original.forEach(input=>blockedKeys.add(auditKey(input)));
    holds.push({personId:original[0].personId,year:scope.year,documentKey:hash(group),months:[...new Set(original.map(input=>Number(input.kind==='annual'?input.raw.numMes:input.raw.mes)))].sort((a,b)=>a-b),annualKeys:original.filter(input=>input.kind==='annual').map(auditKey).sort(),apiKeys:original.filter(input=>input.kind==='api').map(auditKey).sort(),reason:'document-group-unconfirmed'});
  }
  return {permissions,decisions,holds,blockedKeys};
}

export function independentFlightMultiplicity(scope:Scope,inputs:EquationInput[]){
  const covered=new Set<string>(),decisions:MultiplicityDecision[]=[],annual=inputs.filter(i=>i.kind==='annual'),groups=new Map<string,EquationInput[]>();
  const money=(value:unknown)=>{if(value===null||value===undefined||String(value).trim()==='')return null;const m=/^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value).trim());if(!m)throw Error();const n=(BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0')))*(m[1]?-1n:1n);if(!Number.isSafeInteger(Number(n)))throw Error();return Number(n);};
  const key=(i:EquationInput)=>hash(JSON.stringify([i.kind,i.personId,i.source.url,i.source.sha256,i.source.row]));
  // Canonical hashing is format infrastructure, not the projection comparator.
  const json=(v:unknown)=>canonical(v);
  for(const input of inputs)if(input.kind==='api'){const h=hash(json([input.personId,input.raw]));groups.set(h,[...(groups.get(h)??[]),input]);}
  for(const [,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    try{
      const api=rows[0],r=api.raw,document=String(r?.codDocumento??'');
      if(rows.length<2||r.tipoDespesa!=='PASSAGEM AÉREA - SIGEPA'||!document||['0','Não informado'].includes(document)||r.ano!==scope.year||!scope.ids.includes(api.personId)||!scope.months.includes(r.mes))continue;
      const parcel=(value:unknown)=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))?Number(value):null;
      const expected=JSON.stringify([r.ano,r.mes,document,r.tipoDespesa,r.numDocumento||'',r.dataDocumento?.substring(0,10)||null,String(r.codLote??''),money(r.valorDocumento),money(r.valorGlosa),money(r.valorLiquido),parcel(r.parcela)]);
      if(money(r.valorLiquido)===null)continue;
      const matches=annual.filter(a=>{const v=a.raw;try{return a.personId===api.personId&&Number(v.ideCadastro)===api.personId&&Number(v.codLegislatura)===scope.legislature&&JSON.stringify([Number(v.numAno),Number(v.numMes),String(v.ideDocumento??''),v.txtDescricao,v.txtNumero||'',v.datEmissao?.substring(0,10)||null,String(v.numLote??''),money(v.vlrDocumento),money(v.vlrGlosa),money(v.vlrLiquido),parcel(v.numParcela)])===expected;}catch{return false;}});
      if(matches.length!==rows.length)continue;
      const routes=matches.map(a=>typeof a.raw.txtTrecho==='string'?a.raw.txtTrecho.replace(/\s/g,'').toUpperCase():'');if(routes.some(r=>!r)||new Set(routes).size!==rows.length)continue;
      const bodies=matches.map(a=>json(Object.fromEntries(Object.keys(a.raw).filter(k=>k!=='txtTrecho').map(k=>[k,a.raw[k]]))));if(new Set(bodies).size!==1)continue;
      const annualKeys=matches.map(key).sort(),apiKeys=rows.map(key).sort();if(new Set(annualKeys).size!==rows.length||new Set(apiKeys).size!==rows.length)continue;
      for(const k of apiKeys)covered.add(k);
      decisions.push({personId:api.personId,year:r.ano,month:r.mes,apiRowHash:hash(json(r)),count:rows.length,distinctAnnualRoutes:routes.length,annualKeys,apiKeys});
    }catch{}
  }
  return {covered,decisions};
}
