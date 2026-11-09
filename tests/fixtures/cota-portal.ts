export type FixturePortalRow={document?:string;number?:string;provider?:string;date?:string;face?:number;deductions?:number|null;net?:number};
export function portalHtml(rows:FixturePortalRow[],portalId=99,month=1,year=2025):string{
  const money=(n:number)=>`${n<0?'(':''}R$ ${Math.floor(Math.abs(n)/100).toLocaleString('pt-BR')},${String(Math.abs(n)%100).padStart(2,'0')}${n<0?')':''}`;
  return '<!doctype html><meta charset="utf-8"><table class="tabela-2"><thead><tr>'+['Fornecedor','Data de emissão','Número do documento','Valor','Detalhe'].map(v=>`<th>${v}</th>`).join('')+'</tr><tr>'+['Nome','CNPJ / CPF','Despesa','Deduções','Reembolso'].map(v=>`<th>${v}</th>`).join('')+'</tr></thead><tbody>'+rows.map((r,index)=>{
    const p=new URLSearchParams({nuDeputadoId:String(portalId),numMes:String(month),numAno:String(year),despesa:'998',cnpjFornecedor:r.provider??'11222333000181',idDocumento:r.number??'N1',idDocumentoFiscal:r.document??'11'});
    return `<tr><td>Nome privado que não deve ser exportado</td><td>${r.provider??'11222333000181'}</td><td>${r.date??'02/01/2025'}</td><td>${r.number??'N1'}</td><td>${money(r.face??r.net??1021)}</td><td>${r.deductions===undefined||r.deductions===null?'':money(r.deductions)}</td><td id="analitico${index}">${money(r.net??1021)}</td><td><a href="/cota-parlamentar/documento?${p.toString().replaceAll('&','&amp;')}">Detalhe</a></td></tr>`;
  }).join('')+`<tr><td>Total</td><td></td><td></td><td></td><td></td><td></td><td id="totalFinalAnalitico">${money(rows.reduce((n,r)=>n+(r.net??1021),0))}</td><td></td></tr></tbody></table>`;
}
