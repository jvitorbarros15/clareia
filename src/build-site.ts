import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {canonical,hash,snapshotId} from './model.ts';
import {activePublication,publicationAudit,readRecords} from './publications.ts';
import type {Domain,Publication} from './publications.ts';
import type {DB} from './store.ts';
import {csv} from './view.ts';
import {assertCoverageMatchesVersion} from './people-publication.ts';
import {buildSiteSummary} from './site-summary.ts';

const DOMAINS:Domain[]=['pessoas','despesas','votacoes','projetos','eleicoes','emendas'];
const MAX_FILES=15000,MAX_BYTES=10*1024*1024;
const PAGE=path.join(import.meta.dirname,'..','real');

export function checkLimits(files:number,largest:number):void{
  if(files>=MAX_FILES)throw new Error(`Site com ${files} arquivos, acima do limite de ${MAX_FILES}`);
  if(largest>MAX_BYTES)throw new Error('Arquivo acima de 10 MiB');
}
async function listFiles(dir:string):Promise<string[]>{
  const entries=await fs.readdir(dir,{withFileTypes:true});
  return (await Promise.all(entries.map(e=>e.isDirectory()?listFiles(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();
}
// The audit read the records' JSON; the site splits them by column. Both must still be the audited content.
async function assertServedIsAudited(db:DB,active:Publication):Promise<void>{
  const {domain:_domain,...body}=active,all=await readRecords(db,active.id);
  if(snapshotId({...body,records:all})!==active.id)throw new Error('Registros no banco diferem da versão aprovada');
  const drift=await db.query<{n:string}>(`SELECT count(*)::text AS n FROM expenses_v2 WHERE publication_id=$1 AND (amount_cents<>(record->>'cents')::bigint OR person_id<>(record->>'personId')::integer OR year<>(record->>'year')::integer OR month<>(record->>'month')::integer OR occurrence_id<>record->>'id')`,[active.id]);
  if(drift.rows[0].n!=='0')throw new Error('Colunas de expenses_v2 divergem dos registros aprovados');
  const outside=all.filter(r=>!active.scope.ids.includes(r.personId)).length;
  if(outside)throw new Error(`${outside} registros fora do recorte da versão`);
}
export async function buildSite(db:DB,outDir:string,portraitsDir:string):Promise<{publicationId:string;files:number}>{
  const active=await activePublication(db,'despesas');
  if(!active)throw new Error('Nenhuma versão aprovada para publicar');
  await assertServedIsAudited(db,active);
  const domains:Record<string,{version:string;coverage:unknown;collectedAt:string;publishedAt:string}>={};
  for(const domain of DOMAINS){
    const p=await activePublication(db,domain);
    if(p)domains[domain]={version:p.id,coverage:p.scope,collectedAt:p.collectedAt,publishedAt:p.publishedAt};
  }
  const publicationId=hash(canonical(Object.values(domains).map(d=>d.version).sort())).slice(0,12),base=`data/${publicationId}`,data=path.join(outDir,'data',publicationId);
  // Every refusal has to happen before the previous output is deleted.
  const peopleVersion=await activePublication(db,'pessoas');
  const summary=buildSiteSummary({publicationId:active.id,scope:active.scope,people:active.people,records:await readRecords(db,active.id),expectedTotalCents:active.validation.totalCents,coverageId:peopleVersion?.id??null,coverage:peopleVersion?await assertCoverageMatchesVersion(db,peopleVersion.id):[]});
  await fs.rm(outDir,{recursive:true,force:true});
  await fs.mkdir(path.join(data,'portraits'),{recursive:true});
  const withoutData:number[]=[];
  for(const id of active.scope.ids){
    const records=await readRecords(db,active.id,id);
    await fs.copyFile(path.join(portraitsDir,`${id}.jpg`),path.join(data,'portraits',`${id}.jpg`)).catch(()=>{});
    if(!records.length){withoutData.push(id);continue;}
    const person=path.join(data,'deputados',String(id));
    await fs.mkdir(person,{recursive:true});
    await fs.writeFile(path.join(person,'despesas.json'),JSON.stringify(records));
    await fs.writeFile(path.join(person,'despesas.csv'),csv(records));
  }
  await fs.writeFile(path.join(data,'summary.json'),JSON.stringify(summary));
  const {id:snapshotId,domain:_domain,pages:_pages,...meta}=active;
  await fs.writeFile(path.join(data,'index.json'),JSON.stringify({...meta,snapshotId,withoutData,audit:await publicationAudit(db,active.id)}));
  await fs.writeFile(path.join(outDir,'manifest.json'),JSON.stringify({base,domains}));
  for(const file of ['index.html','app.js','styles.css','_headers'])await fs.copyFile(path.join(PAGE,file),path.join(outDir,file));
  await build({entryPoints:[path.join(import.meta.dirname,'view.ts')],bundle:true,format:'iife',globalName:'ClareiaView',outfile:path.join(outDir,'view.js'),logLevel:'silent'});
  const files=await listFiles(outDir),sizes=await Promise.all(files.map(async f=>(await fs.stat(f)).size));
  checkLimits(files.length,Math.max(...sizes));
  return {publicationId,files:files.length};
}
