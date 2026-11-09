import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8} from 'fflate';
import {hash} from '../src/model.ts';
import {parsePortal,portalUrl,portalMoney,portalAgrees,portalSignature,mapPortalIdentity} from '../src/cota-portal.ts';
import {independentPortalReview,isAnalyticUrl} from '../src/cota-portal-audit.ts';
import {sourceAllowed} from '../src/people-discovery.ts';
import {portalHtml} from './fixtures/cota-portal.ts';

const scope={personId:1,portalId:99,year:2025,month:1};
const api=(net=10.21,overrides:Record<string,unknown>={})=>({ano:2025,mes:1,codDocumento:'11',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'N1',numRessarcimento:'',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',tipoDocumento:'Recibos/Outros',nomeFornecedor:'Empresa',cnpjCpfFornecedor:'11222333000181',dataDocumento:'2025-01-02T00:00:00',urlDocumento:null,valorDocumento:net,valorGlosa:0,valorLiquido:net,...overrides});
const annual=[{raw:{ideCadastro:'1',codLegislatura:'57',nuDeputadoId:'99'}}];
async function audit(first:string,second:string,rows:unknown[],annuals:any[][]=[annual,annual]){
  return independentPortalReview(1,2025,1,57,annuals,rows,async(pass,url)=>{const bytes=strToU8(pass===1?first:second);return {bytes,source:{pass,url,sha256:hash(bytes),bytes:bytes.length,file:hash(url)+'.sealed',fetchedAt:'2026-11-08T12:00:00Z'}};});
}
test('analytic capture URLs allow only the read-only single-month SIGEPA contract',()=>{
  const url=portalUrl(scope);assert.ok(sourceAllowed(url));assert.ok(isAnalyticUrl(new URL(url)));
  for(const value of [url+'&nuDeputadoId=99',url.replace('dataFim=1','dataFim=2'),url.replace('despesa=998','despesa=3'),url.replace('nomeHospede=','nomeHospede=Pessoa'),url.replace('nuDeputadoId=99','nuDeputadoId=0'),url.replace('/analitico','/documento'),url+'#other']){assert.equal(sourceAllowed(value),false);assert.equal(isAnalyticUrl(new URL(value)),false);}
});
test('portal keeps signed reimbursements, repeated occurrences and explicit unknown deductions without exporting names or identities',async()=>{
  const html=portalHtml([{net:1021},{net:1021},{net:-1021}]),snapshot=parsePortal(strToU8(html),scope),rows=[api(),api(),api(-10.21)];
  assert.equal(snapshot.rows.length,3);assert.equal(snapshot.total,1021);assert.equal(snapshot.rows[0].deductions,null);assert.ok(portalAgrees(snapshot,rows,scope));assert.equal((await audit(html,html,rows)).status,'matched');
  assert.ok(!JSON.stringify(snapshot).includes('Nome privado'));assert.ok(!JSON.stringify(snapshot).includes('11222333000181'));assert.equal(portalSignature(snapshot),portalSignature({...snapshot,rows:[...snapshot.rows].reverse()}));
  for(const [text,expected] of [['R$ 3.127,94',312794],['(R$ 114,00)',-11400],['R$ -114,00',-11400],['-R$ 114,00',-11400]] as const)assert.equal(portalMoney(text),expected);
  for(const bad of ['', '114,00','R$ 1.23,00','(R$ -114,00)','R$ 1,001','R$ NaN'])assert.throws(()=>portalMoney(bad));
});
test('a matching total cannot hide missing, altered or unmatched ledger occurrences',async()=>{
  const html=portalHtml([{net:1021},{net:1021}]),snapshot=parsePortal(strToU8(html),scope);
  for(const rows of [[api(20.42)],[api(),api(10.21,{codDocumento:'12'})],[api(),api(10.21,{mes:2})],[api(10.21,{valorGlosa:1}),api()]]){assert.equal(portalAgrees(snapshot,rows,scope),false);assert.equal((await audit(html,html,rows)).status,'mismatch');}
  const glosaHtml=portalHtml([{face:1121,net:1021}]);assert.equal(portalAgrees(parsePortal(strToU8(glosaHtml),scope),[api(10.21,{valorDocumento:11.21,valorGlosa:1})],scope),false);
  const explicit=portalHtml([{face:1121,net:1021,deductions:100}]);assert.ok(portalAgrees(parsePortal(strToU8(explicit),scope),[api(10.21,{valorDocumento:11.21,valorGlosa:1})],scope));assert.equal((await audit(explicit,explicit,[api(10.21,{valorDocumento:11.21,valorGlosa:1})])).status,'matched');
});
test('SIGEPA fiscal identifiers preserve UUIDs exactly rather than assuming numeric document IDs',async()=>{
  const document='12345678-1234-5678-90AB-1234567890CD',html=portalHtml([{document},{document}]),rows=[api(10.21,{codDocumento:document}),api(10.21,{codDocumento:document})];
  assert.ok(portalAgrees(parsePortal(strToU8(html),scope),rows,scope));assert.equal((await audit(html,html,rows)).status,'matched');
});
test('two portal passes must agree and malformed schema, identity, dates or totals fail closed in both interpretations',async()=>{
  const html=portalHtml([{net:1021},{net:1021}]),changed=portalHtml([{net:1021},{net:1022}]);assert.equal((await audit(html,changed,[api(),api()])).status,'changed');
  const invalid=[html.replace('Reembolso','Outro'),html.replace('analitico1','analitico0'),html.replace('totalFinalAnalitico','other'),html.replace('R$ 20,42','R$ 20,43'),html.replace('nuDeputadoId=99','nuDeputadoId=98'),html.replace('numMes=1','numMes=2'),html.replace('idDocumentoFiscal=11','idDocumentoFiscal=x'),html.replace('idDocumento=N1','idDocumento=N2'),html.replace('cnpjFornecedor=11222333000181','cnpjFornecedor=11222333000182'),html.replace('02/01/2025','31/02/2025'),html.replace('/cota-parlamentar/documento?','https://evil.example/cota-parlamentar/documento?'),html.replace('R$ 10,21','10,21')];
  for(const bad of invalid){assert.throws(()=>parsePortal(strToU8(bad),scope));assert.equal((await audit(bad,bad,[api(),api()])).status,'unavailable');}
  assert.equal((await independentPortalReview(1,2025,1,57,[annual,annual],[api()],async()=>null)).status,'unavailable');
});
test('portal identity comes from numeric annual namespaces on both passes, never names',async()=>{
  assert.equal(mapPortalIdentity(1,annual,annual,57),99);
  for(const other of [[],[{raw:{...annual[0].raw,nuDeputadoId:'98'}}],[{raw:{...annual[0].raw,nuDeputadoId:''}}],[{raw:{...annual[0].raw,codLegislatura:'56'}}],[annual[0],{raw:{...annual[0].raw,nuDeputadoId:'98'}}]]){assert.equal(mapPortalIdentity(1,annual,other,57),null);const result=await audit(portalHtml([{}]),portalHtml([{}]),[api()],[annual,other]);assert.equal(result.portalId,null);assert.equal(result.status,'unavailable');assert.deepEqual(result.sources,[]);}
});
