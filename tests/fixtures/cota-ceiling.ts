import {strToU8} from 'fflate';
import {canonical,hash} from '../../src/model.ts';
import {CEILING_SOURCES,ceilingReport,deriveCeiling} from '../../src/cota-ceiling.ts';
import type {CeilingFiles} from '../../src/cota-ceiling.ts';
import {auditCeiling} from '../../src/cota-ceiling-audit.ts';
import {buildSiteCeiling} from '../../src/ceiling-site.ts';

export const ANNEX:Record<string,string>={AC:'50.426,26',AL:'46.737,90',AM:'49.363,92',AP:'49.168,58',BA:'44.804,65',CE:'48.245,57',DF:'36.582,46',ES:'43.217,71',GO:'41.300,86',MA:'47.945,49',MG:'41.886,51',MS:'46.336,64',MT:'45.221,83',PA:'48.021,25',PB:'47.826,36',PE:'47.470,60',PI:'46.765,57',PR:'44.665,66',RJ:'41.553,77',RN:'48.525,79',RO:'49.466,29',RR:'51.406,33',RS:'46.669,70',SC:'45.671,58',SE:'45.933,06',SP:'42.837,33',TO:'45.297,41'};
export function consolidatedHtml(annex:Record<string,string>=ANNEX,note='(Anexo com redação dada pelo Anexo ao Ato da Mesa nº 270, de 19/1/2023, em vigor em 1<font>º</font>/2/2023)'){
  const rows=Object.entries(annex).map(([uf,v])=>`<tr><td><p>${uf}</p></td><td><p>${v}</p></td></tr>`).join('');
  return `<html><body><p>ANEXO ÚNICO</p><p><i>${note}</i></p><center><table><tr><td><b>UNIDADE DA FEDERAÇÃO</b></td><td><b>VALOR DA COTA (R$)</b></td></tr>${rows}</table></center><p>CNPJ: 00.530.352/0001-59</p></body></html>`;
}
export const originalHtml=(effective='1º de fevereiro de 2023')=>`<html><body><p>ATO DA MESA Nº 270, DE 19/01/2023</p><p>Art. 4º Fica alterada a tabela de limites mensais referentes à Cota para o Exercício da Atividade Parlamentar, constante do Anexo do Ato da Mesa n. 43, de 2009, que passa a vigorar na forma do Anexo I deste Ato.</p><p>Art. 7º Este Ato entra em vigor em ${effective}.</p></body></html>`;
export const recompositionHtml=(since='fevereiro de 2023')=>`<html><body><p>ATO DA MESA Nº 244, DE 20/02/2026</p><p>Art. 1º Os limites mensais ficam atualizados com base na variação acumulada do IPCA, entre ${since} e dezembro de 2025.</p><p>Art. 2º Este Ato entra em vigor na data de sua publicação.</p><p>Publicação: Diário da Câmara dos Deputados de 20/02/2026</p></body></html>`;
export const ceilingFiles=(overrides:Partial<Record<keyof CeilingFiles,string>>={}):CeilingFiles=>({consolidated:strToU8(overrides.consolidated??consolidatedHtml()),original:strToU8(overrides.original??originalHtml()),recomposition:strToU8(overrides.recomposition??recompositionHtml())});
export const sourcesOf=(files:CeilingFiles,digest:(b:Uint8Array)=>string)=>(Object.keys(CEILING_SOURCES) as (keyof CeilingFiles)[]).map(key=>({key,url:CEILING_SOURCES[key],sha256:digest(files[key]),bytes:files[key].length,fetchedAt:'2026-11-11T12:00:00Z'}));
export function reportFor(year:number,files=ceilingFiles(),generatedAt='2026-11-11T12:00:00Z'){
  const report=ceilingReport(year,deriveCeiling(year,files),sourcesOf(files,hash),generatedAt);
  return {report,files,audit:auditCeiling(report,s=>files[s.key])};
}
export function mixedCeiling2026(files=ceilingFiles()){
  const {report,audit}=reportFor(2026,files);
  return buildSiteCeiling(report,audit,2026);
}
const LEGACY_SOURCES={
  consolidated:'https://www2.camara.leg.br/legin/int/atomes/2009/atodamesa-43-21-maio-2009-588364-normaatualizada-cd-mesa.html',
  original:'https://www2.camara.leg.br/legin/int/atomes/2023/atodamesa-270-19-janeiro-2023-793708-publicacaooriginal-166895-cd-mesa.html',
  recomposition:'https://www2.camara.leg.br/legin/int/atomes/2026/atodamesa-244-20-fevereiro-2026-798720-publicacaooriginal-178157-cd-mesa.html'
} as const;
const LEGACY_ACT='Ato da Mesa nº 270/2023, Anexo I (Anexo Único do Ato da Mesa nº 43/2009)';
const LEGACY_EFFECTIVE_FROM='2023-02-01';
const LEGACY_NOTES=['Limite mensal base do Anexo Único; não inclui adicionais de cargo, trechos aéreos do art. 1º §3º, Mercosul nem a proporcionalidade do art. 11.'];
export function legacyCeilingReport(year:2024|2025){
  const files=ceilingFiles();
  const sources=(['consolidated','original','recomposition'] as const).map(key=>({key,url:LEGACY_SOURCES[key],sha256:hash(files[key]),bytes:files[key].length,fetchedAt:'2026-11-11T12:00:00Z'}));
  const rows=Object.entries(ANNEX).sort((a,b)=>a[0]<b[0]?-1:1).flatMap(([uf,v])=>{
    const ceilingCents=Number(v.replace(/\./g,'').replace(',',''));
    return Array.from({length:12},(_,i)=>({uf,year,month:i+1,ceilingCents,act:LEGACY_ACT,effectiveFrom:LEGACY_EFFECTIVE_FROM,annexUrl:LEGACY_SOURCES.consolidated,actUrl:LEGACY_SOURCES.original}));
  });
  return {schema:'clareia.cota-ceiling.v1' as const,year,unit:'monthly-ceiling-per-uf-cents' as const,generatedAt:'2026-11-11T12:00:00Z',sources,rows,metrics:{ufs:27,rows:324},publicationEligible:false as const,notes:[...LEGACY_NOTES]};
}
export const legacyCeilingSha=(year:2024|2025)=>hash(canonical(legacyCeilingReport(year)));
