import {canonical,hash,UFS} from './model.ts';
import type {CeilingAudit} from './cota-ceiling-audit.ts';
import type {CeilingReport} from './cota-ceiling.ts';

export type SiteCeiling={schema:'clareia.site-ceiling.v1';year:number;unit:'monthly-ceiling-per-uf-cents';act:string;effectiveFrom:string;actUrl:string;annexUrl:string;reportSha256:string;byUf:Record<string,number[]>};

// The site only carries a ceiling whose own audit passed for exactly this report.
export function buildSiteCeiling(report:CeilingReport,audit:{status:string;reportSha256:string}|CeilingAudit|null|undefined,year:number):SiteCeiling{
  const sha=hash(canonical(report));
  if(audit?.status!=='passed'||audit.reportSha256!==sha)throw new Error('Limite da cota sem auditoria aprovada para esta versão');
  if(report.schema!=='clareia.cota-ceiling.v1'||report.unit!=='monthly-ceiling-per-uf-cents'||report.year!==year)throw new Error('Limite da cota de outro ano ou formato');
  const byUf:Record<string,number[]>={},first=report.rows[0];
  if(!first)throw new Error('Limite da cota vazio');
  for(const r of report.rows){
    if(!UFS.has(r.uf)||r.year!==year||!Number.isInteger(r.month)||r.month<1||r.month>12||!Number.isSafeInteger(r.ceilingCents)||r.ceilingCents<=0)throw new Error('Linha do limite da cota inválida');
    if(r.act!==first.act||r.effectiveFrom!==first.effectiveFrom||r.actUrl!==first.actUrl||r.annexUrl!==first.annexUrl)throw new Error('Limite da cota com atos diferentes');
    const months=byUf[r.uf]??=new Array(12).fill(0);
    if(months[r.month-1])throw new Error('Linha do limite da cota repetida');
    months[r.month-1]=r.ceilingCents;
  }
  if(Object.keys(byUf).length!==UFS.size||Object.values(byUf).some(m=>m.some(c=>!c)))throw new Error('Limite da cota incompleto');
  return {schema:'clareia.site-ceiling.v1',year,unit:report.unit,act:first.act,effectiveFrom:first.effectiveFrom,actUrl:first.actUrl,annexUrl:first.annexUrl,reportSha256:sha,byUf:Object.fromEntries(Object.keys(byUf).sort().map(uf=>[uf,byUf[uf]]))};
}
