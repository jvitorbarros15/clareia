import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {canonical,hash,snapshotId} from './model.ts';
import {activePublication,publicationAudit,readRecords} from './publications.ts';
import type {Domain,Publication} from './publications.ts';
import type {DB} from './store.ts';
import {csv} from './view.ts';
import {redactCpf,redactExpense,scanCpfs} from './cpf-scan.ts';
import {assertCoverageMatchesVersion} from './people-publication.ts';
import {buildSiteSummary,buildSupplierSummary} from './site-summary.ts';
import {assertBillsMatchVersion,readBills} from './bills-publication.ts';
import {deputiesOf,resolveOptions,writePrerendered} from './prerender.ts';
import type {SiteOptions} from './prerender.ts';
import {generateShareImages} from './share-images.ts';
import {assertVotesMatchVersion,readBallots,readVotes} from './votes-publication.ts';
import type {SiteCeiling} from './ceiling-site.ts';

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
export async function buildSite(db:DB,finalDir:string,portraitsDir:string,options:SiteOptions={},ceiling:SiteCeiling|null=null):Promise<{publicationId:string;files:number}>{
  const siteOptions=resolveOptions(options);
  // Everything is built aside: a refusal at any step leaves the previous output in place.
  const outDir=finalDir+'.building';
  const active=await activePublication(db,'despesas');
  if(!active)throw new Error('Nenhuma versão aprovada para publicar');
  await assertServedIsAudited(db,active);
  const domains:Record<string,{version:string;coverage:unknown;collectedAt:string;publishedAt:string}>={};
  for(const domain of DOMAINS){
    const p=await activePublication(db,domain);
    if(p)domains[domain]={version:p.id,coverage:p.scope,collectedAt:p.collectedAt,publishedAt:p.publishedAt};
  }
  const publicationId=hash(canonical(Object.values(domains).map(d=>d.version).sort())).slice(0,12),base=`data/${publicationId}`,data=path.join(outDir,'data',publicationId);
  const peopleVersion=await activePublication(db,'pessoas'),billsVersion=await activePublication(db,'projetos'),votesVersion=await activePublication(db,'votacoes');
  if(votesVersion)await assertVotesMatchVersion(db,votesVersion.id);
  const billList=billsVersion?await readBills(db,billsVersion.id):[],voteList=votesVersion?new Map((await readVotes(db,votesVersion.id)).map(v=>[v.id,v])):new Map();
  const ballotsOf=new Map<number,Awaited<ReturnType<typeof readBallots>>>(),voteTotals=new Map<number,Record<string,number>>(),votesHeld=new Map<number,number>();
  if(votesVersion)for(const id of active.scope.ids){const all=await readBallots(db,votesVersion.id,id),own=all.filter(b=>!voteList.get(b[0])?.issues.length),t:Record<string,number>={};votesHeld.set(id,all.length-own.length);for(const b of own)t[b[2]]=(t[b[2]]??0)+1;ballotsOf.set(id,own);voteTotals.set(id,t);}
  // Records come from an approved version that may predate the redaction rule; the site never shows a CPF the source typed into free text.
  const redacted={n:0},allRecords=(await readRecords(db,active.id)).map(r=>redactExpense(r,redacted));
  if(redacted.n)console.error(`CPF omitido em ${redacted.n} valores de despesas`);
  const summary=buildSiteSummary({publicationId:active.id,scope:active.scope,people:active.people,records:allRecords,expectedTotalCents:active.validation.totalCents,coverageId:peopleVersion?.id??null,coverage:peopleVersion?await assertCoverageMatchesVersion(db,peopleVersion.id):[],billsId:billsVersion?.id??null,billsYears:billsVersion?(billsVersion.scope as unknown as {years:number[]}).years:[],bills:billsVersion?await assertBillsMatchVersion(db,billsVersion.id):[],votesId:votesVersion?.id??null,votesYears:votesVersion?(votesVersion.scope as unknown as {years:number[]}).years:[],votes:voteTotals,votesHeld,held:active.validation.heldCompetences??[],ceiling});
  await fs.rm(outDir,{recursive:true,force:true});
  await fs.mkdir(path.join(data,'portraits'),{recursive:true});
  const withoutData:number[]=[];
  const recordsOf=new Map<number,typeof allRecords>();for(const r of allRecords){const list=recordsOf.get(r.personId);if(list)list.push(r);else recordsOf.set(r.personId,[r]);}
  for(const id of active.scope.ids){
    const records=recordsOf.get(id)??[];
    await fs.copyFile(path.join(portraitsDir,`${id}.jpg`),path.join(data,'portraits',`${id}.jpg`)).catch(()=>{});
    // Loaded by the page only when someone opens the section, and never joined to expenses.
    if(billsVersion||votesVersion){
      const bills=billList.filter(b=>!b.issues.length&&b.authors.some(a=>a.deputyId===id)).map(b=>({id:b.id,type:b.type,number:b.number,year:b.year,summary:redactCpf(b.summary),situation:b.situation,situationAt:b.situationAt,norm:b.norm,proponent:b.authors.find(a=>a.deputyId===id)!.proponent,joint:b.authors.filter(a=>a.proponent).length+b.otherProponents>1})).sort((x,y)=>y.id-x.id);
      const votes=(ballotsOf.get(id)??[]).map(([voteId,,category])=>{const v=voteList.get(voteId)!;return {id:voteId,date:v.date,organ:v.organ,kind:v.kind,description:redactCpf(v.description),matters:v.objects.map((o:{title:string|null})=>o.title?redactCpf(o.title):null).filter(Boolean),category};}).sort((x,y)=>y.date.localeCompare(x.date)||x.id.localeCompare(y.id));
      await fs.mkdir(path.join(data,'atividade'),{recursive:true});const activity=JSON.stringify({bills,votes});if(scanCpfs(activity,new Set()))throw new Error('Identificador privado na atividade de um deputado');await fs.writeFile(path.join(data,'atividade',id+'.json'),activity);
    }
    if(!records.length){withoutData.push(id);continue;}
    const person=path.join(data,'deputados',String(id));
    await fs.mkdir(person,{recursive:true});
    const json=JSON.stringify(records),table=csv(records);if(scanCpfs(json,new Set())||scanCpfs(table,new Set()))throw new Error('Identificador privado nas despesas de um deputado');
    await fs.writeFile(path.join(person,'despesas.json'),json);
    await fs.writeFile(path.join(person,'despesas.csv'),table);
  }
  // The cells exist for the supplier cross-check; the page reads the finer supplier rows, so they are not published twice.
  const summaryJson=JSON.stringify({...summary,people:summary.people.map(({cells:_cells,...person})=>person)});if(scanCpfs(summaryJson,new Set()))throw new Error('Identificador privado no resumo');
  await fs.writeFile(path.join(data,'summary.json'),summaryJson);
  // Supplier names are already redacted for private persons; the scan refuses any that slipped through.
  const supplierSummary=buildSupplierSummary(summary,allRecords),suppliers=JSON.stringify(supplierSummary);if(scanCpfs(suppliers,new Set()))throw new Error('Identificador privado nos fornecedores');
  await fs.writeFile(path.join(data,'fornecedores.json'),suppliers);
  const {id:snapshotId,domain:_domain,pages:_pages,...meta}=active;
  await fs.writeFile(path.join(data,'index.json'),JSON.stringify({...meta,snapshotId,withoutData,...siteOptions.shareImages?{shareImages:true}:{},audit:await publicationAudit(db,active.id)}));
  await fs.writeFile(path.join(outDir,'manifest.json'),JSON.stringify({base,domains}));
  for(const file of ['index.html','data.js','analytics.js','app.js','portal.js','styles.css','_headers','icon.svg','apple-touch-icon.png','favicon-32.png','site.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'])await fs.copyFile(path.join(PAGE,file),path.join(outDir,file));
  await fs.mkdir(path.join(outDir,'fonts'));
  for(const font of (await fs.readdir(path.join(PAGE,'fonts'))).filter(f=>f.endsWith('.woff2')))await fs.copyFile(path.join(PAGE,'fonts',font),path.join(outDir,'fonts',font));
  await build({entryPoints:[path.join(import.meta.dirname,'view.ts')],bundle:true,format:'iife',globalName:'ClareiaView',outfile:path.join(outDir,'view.js'),logLevel:'silent'});
  const deputies=deputiesOf({ids:active.scope.ids,people:active.people,summary,suppliers:supplierSummary,months:active.scope.months}),period={year:String(active.scope.year),coverage:active.scope.months.map(m=>m-1)};
  // The cache sits beside the output so an unchanged image is copied, not rendered again; the output folder itself is rebuilt every time.
  const share=siteOptions.shareImages?await generateShareImages({outDir,publicationId,deputies,period,portraitsDir,pageDir:PAGE,cacheDir:finalDir+'.share-cache'}):null;
  if(share)console.error(`Imagens de compartilhamento: ${share.rendered} geradas, ${share.reused} reaproveitadas, ${(share.ms/1000).toFixed(1)} s`);
  await writePrerendered(outDir,publicationId,deputies,period,siteOptions,share?.names);
  const files=await listFiles(outDir),sizes=await Promise.all(files.map(async f=>(await fs.stat(f)).size));
  checkLimits(files.length,Math.max(...sizes));
  await fs.rm(finalDir,{recursive:true,force:true});
  await fs.rename(outDir,finalDir);
  return {publicationId,files:files.length};
}
