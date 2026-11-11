import {strToU8} from 'fflate';
import {CEILING_SOURCES} from '../../src/cota-ceiling.ts';
import type {CeilingFiles} from '../../src/cota-ceiling.ts';

export const ANNEX:Record<string,string>={AC:'50.426,26',AL:'46.737,90',AM:'49.363,92',AP:'49.168,58',BA:'44.804,65',CE:'48.245,57',DF:'36.582,46',ES:'43.217,71',GO:'41.300,86',MA:'47.945,49',MG:'41.886,51',MS:'46.336,64',MT:'45.221,83',PA:'48.021,25',PB:'47.826,36',PE:'47.470,60',PI:'46.765,57',PR:'44.665,66',RJ:'41.553,77',RN:'48.525,79',RO:'49.466,29',RR:'51.406,33',RS:'46.669,70',SC:'45.671,58',SE:'45.933,06',SP:'42.837,33',TO:'45.297,41'};
export function consolidatedHtml(annex:Record<string,string>=ANNEX,note='(Anexo com redação dada pelo Anexo ao Ato da Mesa nº 270, de 19/1/2023, em vigor em 1<font>º</font>/2/2023)'){
  const rows=Object.entries(annex).map(([uf,v])=>`<tr><td><p>${uf}</p></td><td><p>${v}</p></td></tr>`).join('');
  return `<html><body><p>ANEXO ÚNICO</p><p><i>${note}</i></p><center><table><tr><td><b>UNIDADE DA FEDERAÇÃO</b></td><td><b>VALOR DA COTA (R$)</b></td></tr>${rows}</table></center><p>CNPJ: 00.530.352/0001-59</p></body></html>`;
}
export const originalHtml=(effective='1º de fevereiro de 2023')=>`<html><body><p>ATO DA MESA Nº 270, DE 19/01/2023</p><p>Art. 4º Fica alterada a tabela de limites mensais referentes à Cota para o Exercício da Atividade Parlamentar, constante do Anexo do Ato da Mesa n. 43, de 2009, que passa a vigorar na forma do Anexo I deste Ato.</p><p>Art. 7º Este Ato entra em vigor em ${effective}.</p></body></html>`;
export const recompositionHtml=(since='fevereiro de 2023')=>`<html><body><p>ATO DA MESA Nº 244, DE 20/02/2026</p><p>Art. 1º Os limites mensais ficam atualizados com base na variação acumulada do IPCA, entre ${since} e dezembro de 2025.</p><p>Art. 2º Este Ato entra em vigor na data de sua publicação.</p><p>Publicação: Diário da Câmara dos Deputados de 20/02/2026</p></body></html>`;
export const ceilingFiles=(overrides:Partial<Record<keyof CeilingFiles,string>>={}):CeilingFiles=>({consolidated:strToU8(overrides.consolidated??consolidatedHtml()),original:strToU8(overrides.original??originalHtml()),recomposition:strToU8(overrides.recomposition??recompositionHtml())});
export const sourcesOf=(files:CeilingFiles,hash:(b:Uint8Array)=>string)=>(Object.keys(CEILING_SOURCES) as (keyof CeilingFiles)[]).map(key=>({key,url:CEILING_SOURCES[key],sha256:hash(files[key]),bytes:files[key].length,fetchedAt:'2026-11-11T12:00:00Z'}));
