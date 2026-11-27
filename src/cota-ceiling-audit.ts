import {canonical,hash,UFS} from './model.ts';
import {CEILING_ACT,CEILING_EFFECTIVE_FROM,CEILING_SOURCES,CEILING_YEARS,PORTAL_2026_ACT} from './cota-ceiling.ts';
import {PORTAL_2026_CAPTURED_AT,PORTAL_2026_CENTS,PORTAL_2026_URL} from './cota-ceiling-2026-portal.ts';
import type {CeilingFiles,CeilingReport} from './cota-ceiling.ts';

// Second implementation: no HTML parser, only tag stripping and a pattern over the flattened text.
const ENTITIES:Record<string,string>={'&nbsp;':' ','&ordm;':'º','&amp;':'&','&ordf;':'ª'};
function plain(bytes:Uint8Array):string{
  const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/<(script|style)[\s\S]*?<\/\1>/gi,'');
  return html.replace(/<[^>]*>/g,'').replace(/&[a-z]+;/gi,e=>ENTITIES[e.toLowerCase()]??e).replace(/[\s ]+/g,'').replace(/[º°]/g,'o').toLowerCase();
}
function annexByPattern(bytes:Uint8Array):Map<string,number>{
  const page=plain(bytes),at=page.lastIndexOf('valordacota(r$)');
  if(at<0)throw Error('Anexo ausente');
  const out=new Map<string,number>();
  for(const m of page.slice(at+'valordacota(r$)'.length).matchAll(/([a-z]{2})(\d{1,3}(?:\.\d{3})*,\d{2})/g)){
    const uf=m[1].toUpperCase();if(!UFS.has(uf)||out.has(uf))throw Error('UF do anexo inválida ou repetida');
    const [reais,cents]=m[2].split(',');out.set(uf,Number(reais.replace(/\./g,''))*100+Number(cents));
  }
  return out;
}
const needle=(value:string)=>plain(new TextEncoder().encode(value));

export type CeilingAudit={status:'passed'|'failed';failures:string[];reportSha256:string};
export function auditCeiling(report:CeilingReport,read:(source:CeilingReport['sources'][number])=>Uint8Array):CeilingAudit{
  const failures:string[]=[],fail=(reason:string)=>{failures.push(reason);};
  try{
    if(report.schema!=='clareia.cota-ceiling.v1'||!CEILING_YEARS.includes(report.year)||report.publicationEligible!==false)fail('Cabeçalho do relatório inválido');
    const keys=report.sources.map(s=>s.key).sort().join(',');
    if(keys!==Object.keys(CEILING_SOURCES).sort().join(','))fail('Fontes do relatório incompletas');
    const files={} as CeilingFiles;
    for(const s of report.sources){
      if(s.url!==CEILING_SOURCES[s.key])fail('URL fora do contrato: '+s.key);
      const bytes=read(s);if(hash(bytes)!==s.sha256||bytes.length!==s.bytes)fail('Original alterado: '+s.key);
      files[s.key]=bytes;
    }
    if(failures.length)return {status:'failed',failures,reportSha256:hash(canonical(report))};
    const page=(key:keyof CeilingFiles)=>plain(files[key]);
    for(const phrase of ['Anexo ao Ato da Mesa nº 270, de 19/1/2023','em vigor em 1º/2/2023'])if(!page('consolidated').includes(needle(phrase)))fail('Anexo sem a citação do ato 270');
    for(const phrase of ['ATO DA MESA Nº 270, DE 19/01/2023','Art. 7º Este Ato entra em vigor em 1º de fevereiro de 2023'])if(!page('original').includes(needle(phrase)))fail('Ato 270 mudou');
    for(const phrase of ['ATO DA MESA Nº 244, DE 20/02/2026','entre fevereiro de 2023 e dezembro de 2025','Art. 2º Este Ato entra em vigor na data de sua publicação'])if(!page('recomposition').includes(needle(phrase)))fail('Ato 244 mudou');
    const annex=annexByPattern(files.consolidated);
    if(annex.size!==27)fail('Anexo sem as 27 UFs');
    const lowest=[...annex].sort((a,b)=>a[1]-b[1])[0];if(lowest?.[0]!=='DF')fail('O menor limite deveria ser o do DF');
    const expectedRows=report.year===2026?27*11:27*12;
    if(report.rows.length!==expectedRows||report.metrics.rows!==report.rows.length||report.metrics.ufs!==27)fail('Quantidade de linhas diverge');
    const seen=new Set<string>();
    for(const r of report.rows){
      const key=r.uf+'/'+r.month;
      if(seen.has(key)||!UFS.has(r.uf)||!Number.isInteger(r.month)||r.month<1||r.month>12||r.year!==report.year)fail('Linha duplicada ou fora do período: '+key);seen.add(key);
      if(report.year===2026&&r.month===2){fail('Fevereiro de 2026 sem teto confirmado: '+key);continue;}
      if(report.year===2026&&r.month>=3){
        const portalCents=PORTAL_2026_CENTS[r.uf],annexCents=annex.get(r.uf);
        if(!Number.isInteger(r.ceilingCents)||r.ceilingCents<=0||portalCents!==r.ceilingCents)fail('Valor diverge da tabela do portal: '+key);
        if(annexCents===undefined||Math.abs(r.ceilingCents-Math.round(annexCents*1.1375))>1)fail('Valor do portal diverge do reajuste de 1,1375: '+key);
        if(r.act!==PORTAL_2026_ACT||r.effectiveFrom!==PORTAL_2026_CAPTURED_AT||r.annexUrl!==PORTAL_2026_URL||r.actUrl!==PORTAL_2026_URL)fail('Ato ou fonte do portal divergem: '+key);
      }else{
        if(annex.get(r.uf)!==r.ceilingCents||!Number.isInteger(r.ceilingCents)||r.ceilingCents<=0)fail('Valor diverge do anexo: '+key);
        if(r.act!==CEILING_ACT||r.effectiveFrom!==CEILING_EFFECTIVE_FROM||r.annexUrl!==CEILING_SOURCES.consolidated||r.actUrl!==CEILING_SOURCES.original)fail('Ato ou fonte divergem: '+key);
        if(`${r.year}-${String(r.month).padStart(2,'0')}-01`<CEILING_EFFECTIVE_FROM||`${r.year}-${String(r.month).padStart(2,'0')}`>='2026-02')fail('Mês fora da vigência do anexo: '+key);
      }
    }
  }catch(error){fail('Auditoria recusada: '+(error instanceof Error?error.message:'erro'));}
  return {status:failures.length?'failed':'passed',failures,reportSha256:hash(canonical(report))};
}
