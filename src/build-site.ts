import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {canonical,hash,snapshotId,socialLinks,COMPANY_NAME} from './model.ts';
import type {Expense,Snapshot} from './model.ts';
import {activePublication,publicationAudit,readRecords} from './publications.ts';
import type {Domain,Publication} from './publications.ts';
import type {DB} from './store.ts';
import {csv} from './view.ts';
import {redactCpf,redactExpense,scanCpfs} from './cpf-scan.ts';
import {assertCoverageMatchesVersion} from './people-publication.ts';
import {buildSiteSummary,buildSupplierSummary,withSupplierLabels} from './site-summary.ts';
import type {SupplierNames} from './site-summary.ts';
import {buildLegislatureSummary} from './legislature-summary.ts';
import {assertBillsMatchVersion,readBills} from './bills-publication.ts';
import type {ReviewItem,ReviewNames} from './review-list.ts';
import {partyReviewItems,ufReviewItems} from './review-list.ts';
import {deputiesOf,resolveOptions,writePrerendered,writeStaticPages} from './prerender.ts';
import type {Deputy,Period} from './prerender.ts';
import type {SiteOptions} from './prerender.ts';
import {generateShareImages} from './share-images.ts';
import {assertVotesMatchVersion,readBallots,readVotes} from './votes-publication.ts';
import {readAmendmentRows} from './amendments-publication.ts';
import type {AmendmentRow,AmendmentsVersion} from './amendments-publication.ts';
import type {SiteCeiling} from './ceiling-site.ts';
import {fileEntry,monthlyTables,quirkCounts,zipOf} from './open-data.ts';
import type {OpenData} from './open-data.ts';

const DOMAINS:Domain[]=['pessoas','despesas','votacoes','projetos','eleicoes','emendas'];
const MAX_FILES=15000,MAX_BYTES=10*1024*1024;
const PAGE=path.join(import.meta.dirname,'..','real');

const STAGING='.staging';
// The data folder is served immutable, so its name must change whenever any published byte does, not only when a domain version does.
export async function dataFolderId(dir:string):Promise<string>{
  const files=(await listFiles(dir)).map(f=>path.relative(dir,f).split(path.sep).join('/')).sort();
  return hash(canonical(await Promise.all(files.map(async f=>[f,hash(await fs.readFile(path.join(dir,f)))])))).slice(0,12);
}
export function checkLimits(files:number,largest:number):void{
  if(files>=MAX_FILES)throw new Error(`Site com ${files} arquivos, acima do limite de ${MAX_FILES}`);
  if(largest>MAX_BYTES)throw new Error('Arquivo acima de 10 MiB');
}
async function listFiles(dir:string):Promise<string[]>{
  const entries=await fs.readdir(dir,{withFileTypes:true});
  return (await Promise.all(entries.map(e=>e.isDirectory()?listFiles(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();
}
// Versions collected before the id left the supplier out still carry a hash of the CPF and name; unverified records get an id from non-identifying fields only.
export const publicId=(r:Expense)=>hash(canonical({personId:r.personId,year:r.year,month:r.month,category:r.category,documentId:r.documentId,documentNumber:r.documentNumber,date:r.date,lot:r.lot,cents:r.cents,documentCents:r.documentCents,disallowedCents:r.disallowedCents,origin:r.origin,source:r.source?{url:r.source.url,row:r.source.row}:null}));
// The audit read the records' JSON; the site splits them by column. Both must still be the audited content.
async function assertServedIsAudited(db:DB,active:Publication):Promise<void>{
  const {domain:_domain,...body}=active,all=await readRecords(db,active.id);
  if(snapshotId({...body,records:all})!==active.id)throw new Error('Registros no banco diferem da versão aprovada');
  const drift=await db.query<{n:string}>(`SELECT count(*)::text AS n FROM expenses_v2 WHERE publication_id=$1 AND (amount_cents<>(record->>'cents')::bigint OR person_id<>(record->>'personId')::integer OR year<>(record->>'year')::integer OR month<>(record->>'month')::integer OR occurrence_id<>record->>'id')`,[active.id]);
  if(drift.rows[0].n!=='0')throw new Error('Colunas de expenses_v2 divergem dos registros aprovados');
  const outside=all.filter(r=>!active.scope.ids.includes(r.personId)).length;
  if(outside)throw new Error(`${outside} registros fora do recorte da versão`);
}
// A content hash in every script and stylesheet URL: a browser that kept a file from an earlier deploy cannot pair it with a new page.
async function versionAssets(outDir:string):Promise<void>{
  const tagged=async(file:string,assets:string[])=>{
    let text=await fs.readFile(path.join(outDir,file),'utf8');
    for(const asset of assets){const v=hash(await fs.readFile(path.join(outDir,asset))).slice(0,10);text=text.replaceAll(`'/${asset}'`,`'/${asset}?v=${v}'`).replaceAll(`"/${asset}"`,`"/${asset}?v=${v}"`);}
    await fs.writeFile(path.join(outDir,file),text);
  };
  await tagged('data.js',['app.js','portal.js']);
  for(const page of ['index.html','404.html'])await tagged(page,['view.js','pages.js','data.js','analytics.js','app.js','portal.js','styles.css']);
}
export type SitePlan={defaultYear:number;years:{year:number;publicationId:string;ceiling:SiteCeiling|null}[];social?:Record<string,unknown>;amendments?:{publicationId:string}};
export type YearResult={year:number;review:ReviewItem[];names:ReviewNames;partyReview:ReviewItem[]};
// A year is built only from the exact version the caller names, and only if its own audit passed; the active pointer is never consulted for it.
async function approvedPublication(db:DB,id:string,year:number):Promise<Publication>{
  const r=await db.query<{domain:Domain;body:Omit<Snapshot,'records'>;status:string|null}>('SELECT p.domain,p.body,a.status FROM publications p LEFT JOIN publication_audits a ON a.publication_id=p.id WHERE p.id=$1 AND p.id NOT IN (SELECT publication_id FROM withheld_publications)',[id]);
  const row=r.rows[0];
  if(!row||row.domain!=='despesas')throw new Error(`Versão de despesas ${id} não encontrada`);
  if(row.status!=='passed')throw new Error(`Versão de despesas ${id} sem auditoria aprovada`);
  if(row.body.scope.year!==year)throw new Error(`Versão ${id} é de ${row.body.scope.year}, não de ${year}`);
  return {...row.body,domain:row.domain};
}
export async function buildSite(db:DB,finalDir:string,portraitsDir:string,options:SiteOptions={},plan?:SitePlan):Promise<{publicationId:string;files:number;years:YearResult[]}>{
  const siteOptions=resolveOptions(options);
  // Everything is built aside: a refusal at any step leaves the previous output in place.
  const outDir=finalDir+'.building';
  const activeNow=await activePublication(db,'despesas');
  if(!activeNow)throw new Error('Nenhuma versão aprovada para publicar');
  const sitePlan:SitePlan=plan??{defaultYear:activeNow.scope.year,years:[{year:activeNow.scope.year,publicationId:activeNow.id,ceiling:null}]};
  if(!sitePlan.years.length||new Set(sitePlan.years.map(y=>y.year)).size!==sitePlan.years.length)throw new Error('Anos da montagem repetidos ou vazios');
  const defaultEntry=sitePlan.years.find(y=>y.year===sitePlan.defaultYear);
  if(!defaultEntry)throw new Error(`Ano padrão ${sitePlan.defaultYear} fora dos anos da montagem`);
  if(defaultEntry.publicationId!==activeNow.id)throw new Error('A versão ativa de despesas não é a do ano padrão');
  const entries=[...sitePlan.years].sort((a,b)=>a.year-b.year),pubs=new Map<number,Publication>();
  for(const e of entries){const p=await approvedPublication(db,e.publicationId,e.year);await assertServedIsAudited(db,p);pubs.set(e.year,p);}
  const domains:Record<string,{version:string;coverage:unknown;collectedAt:string;publishedAt:string}>={};
  for(const domain of DOMAINS){
    const p=await activePublication(db,domain);
    if(p)domains[domain]={version:p.id,coverage:p.scope,collectedAt:p.collectedAt,publishedAt:p.publishedAt};
  }
  const data=path.join(outDir,'data',STAGING);
  const peopleVersion=await activePublication(db,'pessoas'),billsVersion=await activePublication(db,'projetos'),votesVersion=await activePublication(db,'votacoes');
  if(votesVersion)await assertVotesMatchVersion(db,votesVersion.id);
  // People, portraits and activity are not per year: a deputy who appears in any year gets them once.
  const allIds=[...new Set(entries.flatMap(e=>pubs.get(e.year)!.scope.ids))];
  const billList=billsVersion?await readBills(db,billsVersion.id):[],voteList=votesVersion?new Map((await readVotes(db,votesVersion.id)).map(v=>[v.id,v])):new Map();
  const ballotsOf=new Map<number,Awaited<ReturnType<typeof readBallots>>>(),voteTotals=new Map<number,Record<string,number>>(),votesHeld=new Map<number,number>();
  if(votesVersion)for(const id of allIds){const all=await readBallots(db,votesVersion.id,id),own=all.filter(b=>!voteList.get(b[0])?.issues.length),t:Record<string,number>={};votesHeld.set(id,all.length-own.length);for(const b of own)t[b[2]]=(t[b[2]]??0)+1;ballotsOf.set(id,own);voteTotals.set(id,t);}
  const approved=new Set(options.approvedNames??await readApprovedNames()),coverageRows=peopleVersion?await assertCoverageMatchesVersion(db,peopleVersion.id):[],billRows=billsVersion?await assertBillsMatchVersion(db,billsVersion.id):[];
  const amendmentsByDeputy=new Map<number,AmendmentRow[]>();
  if(sitePlan.amendments){
    const {publicationId}=sitePlan.amendments;
    const r=await db.query<{domain:Domain;body:Omit<AmendmentsVersion,'rows'>;status:string|null}>('SELECT p.domain,p.body,a.status FROM publications p LEFT JOIN publication_audits a ON a.publication_id=p.id WHERE p.id=$1 AND p.id NOT IN (SELECT publication_id FROM withheld_publications)',[publicationId]);
    const row=r.rows[0];
    if(!row||row.domain!=='emendas')throw new Error(`Versão de emendas ${publicationId} não encontrada`);
    if(row.status!=='passed')throw new Error(`Versão de emendas ${publicationId} sem auditoria aprovada`);
    const amendmentRows=await readAmendmentRows(db,publicationId);
    if(hash(canonical({schema:row.body.schema,metric:row.body.metric,scope:row.body.scope,reviews:row.body.reviews,rows:amendmentRows}))!==publicationId)throw new Error('Emendas no banco diferem da versão aprovada');
    const knownIds=new Set(allIds);
    for(const item of amendmentRows){
      if(!knownIds.has(item.deputyId))throw new Error(`Emenda atribuída a deputado fora da montagem: ${item.deputyId}`);
      const list=amendmentsByDeputy.get(item.deputyId);if(list)list.push(item);else amendmentsByDeputy.set(item.deputyId,[item]);
    }
  }
  await fs.rm(outDir,{recursive:true,force:true});
  await fs.mkdir(path.join(data,'portraits'),{recursive:true});
  const supplierNames=await readSupplierNames();
  const results:YearResult[]=[],manifestYears:{year:number;months:number[];partial:boolean;expenses:string;totalCents:number;records:number}[]=[];
  const built=new Map<number,{summary:ReturnType<typeof buildSiteSummary>;suppliers:ReturnType<typeof buildSupplierSummary>}>();
  for(const e of entries){
    const active=pubs.get(e.year)!,isDefault=e.year===sitePlan.defaultYear,ydir=isDefault?data:path.join(data,String(e.year));
    // Every published id is rebuilt from the redacted record, so nothing the source typed (CPF in a document number, supplier) sits in a hash. Only a verified CNPJ publishes its supplier key and page hash.
    // Records come from an approved version that may predate the redaction rule; the site never shows a CPF the source typed into free text.
    const withheldNames=new Map<string,{count:number;cents:number}>(),keptNames=new Map<string,{count:number;cents:number}>();
    const tally=(m:typeof withheldNames,name:string,cents:number)=>{const t=m.get(name)??{count:0,cents:0};t.count++;t.cents+=cents;m.set(name,t);};
    const redacted={n:0},oddIds=new Map<number,number>(),allRecords=(await readRecords(db,active.id)).map(r=>{if(r.supplierIdOdd)oddIds.set(r.personId,(oddIds.get(r.personId)??0)+1);const {supplierKey,supplierIdOdd:_odd,...red}=redactExpense(r,redacted);
      // The single place that withholds names: a stored version may hold any typed name. An unverified supplier keeps it only if it is a label, the owner approved it, or it looks like a company.
      let rest=red;if(!r.supplierVerified&&!LABELS.has(red.supplier)&&!approved.has(red.supplier)){
        if(COMPANY_NAME.test(red.supplier.toUpperCase()))tally(keptNames,red.supplier,red.cents);else{tally(withheldNames,red.supplier,red.cents);rest={...red,supplier:WITHHELD,receipt:null};}
      }
      const pub={...rest,id:publicId(rest)};return r.supplierVerified?{...pub,supplierKey}:{...pub,source:{url:r.source.url,row:r.source.row,fetchedAt:r.source.fetchedAt}};});
    if(new Set(allRecords.map(r=>r.id)).size!==allRecords.length)throw new Error('Identificador público de despesa repetido');
    if(allRecords.some(r=>r.receipt!==null&&LABELS.has(r.supplier)))throw new Error('Link de recibo em fornecedor sem identificação');
    if(redacted.n)console.error(`CPF omitido em ${redacted.n} valores de despesas`);
    const summary=buildSiteSummary({publicationId:active.id,scope:active.scope,people:active.people,records:allRecords,expectedTotalCents:active.validation.totalCents,coverageId:peopleVersion?.id??null,coverage:coverageRows,billsId:billsVersion?.id??null,billsYears:billsVersion?(billsVersion.scope as unknown as {years:number[]}).years:[],bills:billRows,votesId:votesVersion?.id??null,votesYears:votesVersion?(votesVersion.scope as unknown as {years:number[]}).years:[],votes:voteTotals,votesHeld,held:active.validation.heldCompetences??[],ceiling:e.ceiling});
    await fs.mkdir(ydir,{recursive:true});
    const withoutData:number[]=[],recordsOf=new Map<number,ReturnType<typeof withSupplierLabels>>();for(const r of withSupplierLabels(allRecords,supplierNames)){const list=recordsOf.get(r.personId);if(list)list.push(r);else recordsOf.set(r.personId,[r]);}
    for(const id of active.scope.ids){
      const records=recordsOf.get(id)??[];
      if(!records.length){withoutData.push(id);continue;}
      const person=path.join(ydir,'deputados',String(id));
      await fs.mkdir(person,{recursive:true});
      const json=JSON.stringify(records),table=csv(records);if(scanCpfs(json,new Set())||scanCpfs(table,new Set()))throw new Error('Identificador privado nas despesas de um deputado');
      await fs.writeFile(path.join(person,'despesas.json'),json);
      await fs.writeFile(path.join(person,'despesas.csv'),table);
    }
    // The cells exist for the supplier cross-check; the page reads the finer supplier rows, so they are not published twice.
    const summaryJson=JSON.stringify({...summary,people:summary.people.map(({cells:_cells,...person})=>person)});if(scanCpfs(summaryJson,new Set()))throw new Error('Identificador privado no resumo');
    await fs.writeFile(path.join(ydir,'summary.json'),summaryJson);
    // Supplier names are already redacted for private persons; the scan refuses any that slipped through.
    const supplierSummary=buildSupplierSummary(summary,allRecords,supplierNames),suppliers=JSON.stringify(supplierSummary);if(scanCpfs(suppliers,new Set()))throw new Error('Identificador privado nos fornecedores');
    await fs.writeFile(path.join(ydir,'fornecedores.json'),suppliers);
    const {id:snapshotId,domain:_domain,pages:_pages,...meta}=active;
    // Social links are added here, outside the approved version, so they never move its id or totals; the run is checked again link by link.
    const people=meta.people.map(p=>{const social=socialLinks(sitePlan.social?.[p.id]);return social.length?{...p,social}:p;});
    // Share images exist only for the default year, so only its index says so.
    const indexJson=JSON.stringify({...meta,people,snapshotId,withoutData,...isDefault&&siteOptions.shareImages?{shareImages:true}:{},audit:await publicationAudit(db,active.id)});
    await fs.writeFile(path.join(ydir,'index.json'),indexJson);
    await writeOpenData(ydir,active.scope.ids.flatMap(id=>recordsOf.get(id)??[]),{summary:summaryJson,suppliers,index:indexJson},summary.people.flatMap(p=>p.months.filter(m=>m.held).map(()=>({personId:p.id}))),{year:active.scope.year,publishedAt:active.publishedAt,collectedAt:active.collectedAt});
    results.push({year:e.year,partyReview:partyReviewItems(active.people),names:{withheld:rows(withheldNames),kept:rows(keptNames)},review:[...ufReviewItems(active.people),...[...oddIds].map(([id,n])=>({id,name:active.people.find(p=>p.id===id)?.name??'',used:n+' registros',from:'identificador do fornecedor fora do formato'}))]});
    manifestYears.push({year:e.year,months:active.scope.months,partial:active.scope.months.length<12,expenses:active.id,totalCents:active.validation.totalCents,records:allRecords.length});
    built.set(e.year,{summary,suppliers:supplierSummary});
  }
  const legislature=JSON.stringify(buildLegislatureSummary(entries.map(e=>({year:e.year,summary:built.get(e.year)!.summary}))));
  if(scanCpfs(legislature,new Set()))throw new Error('Identificador privado na legislatura');
  await fs.writeFile(path.join(data,'legislatura.json'),legislature);
  const active=pubs.get(sitePlan.defaultYear)!,{summary,suppliers:supplierSummary}=built.get(sitePlan.defaultYear)!;
  for(const id of allIds){
    await fs.copyFile(path.join(portraitsDir,`${id}.jpg`),path.join(data,'portraits',`${id}.jpg`)).catch(()=>{});
    // Loaded by the page only when someone opens the section, and never joined to expenses.
    if(billsVersion||votesVersion){
      const bills=billList.filter(b=>!b.issues.length&&b.authors.some(a=>a.deputyId===id)).map(b=>({id:b.id,type:b.type,number:b.number,year:b.year,summary:redactCpf(b.summary),situation:b.situation,situationAt:b.situationAt,norm:b.norm,proponent:b.authors.find(a=>a.deputyId===id)!.proponent,joint:b.authors.filter(a=>a.proponent).length+b.otherProponents>1})).sort((x,y)=>y.id-x.id);
      const votes=(ballotsOf.get(id)??[]).map(([voteId,,category])=>{const v=voteList.get(voteId)!;return {id:voteId,date:v.date,organ:v.organ,kind:v.kind,description:redactCpf(v.description),matters:v.objects.map((o:{title:string|null})=>o.title?redactCpf(o.title):null).filter(Boolean),billId:v.objects.map((o:{billId:number|null})=>o.billId).find((b:number|null)=>b!==null)??null,category};}).sort((x,y)=>y.date.localeCompare(x.date)||x.id.localeCompare(y.id));
      await fs.mkdir(path.join(data,'atividade'),{recursive:true});const activity=JSON.stringify({bills,votes});if(scanCpfs(activity,new Set()))throw new Error('Identificador privado na atividade de um deputado');await fs.writeFile(path.join(data,'atividade',id+'.json'),activity);
    }
  }
  if(sitePlan.amendments&&amendmentsByDeputy.size){
    const dir=path.join(data,'emendas'),{publicationId}=sitePlan.amendments;
    await fs.mkdir(dir,{recursive:true});
    for(const [deputyId,list] of amendmentsByDeputy){
      const items=[...list].sort((a,b)=>a.year-b.year||a.destination.localeCompare(b.destination)).map(r=>({year:r.year,destination:r.destination,rows:r.totals.rows,committed:r.totals.committed,liquidated:r.totals.liquidated,paid:r.totals.paid,carriedOver:r.totals.carriedOver,carriedCancelled:r.totals.carriedCancelled,carriedPaid:r.totals.carriedPaid}));
      const json=JSON.stringify({schema:'clareia.amendments-deputy.v1',publicationId,deputyId,rows:items});
      if(scanCpfs(json,new Set()))throw new Error('Identificador privado nas emendas de um deputado');
      await fs.writeFile(path.join(dir,deputyId+'.json'),json);
    }
  }
  for(const file of ['index.html','404.html','data.js','pages.js','analytics.js','app.js','portal.js','styles.css','_headers','icon.svg','apple-touch-icon.png','favicon-32.png','site.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','clareia-api.pdf'])await fs.copyFile(path.join(PAGE,file),path.join(outDir,file));
  await fs.mkdir(path.join(outDir,'fonts'));
  for(const font of (await fs.readdir(path.join(PAGE,'fonts'))).filter(f=>f.endsWith('.woff2')))await fs.copyFile(path.join(PAGE,'fonts',font),path.join(outDir,'fonts',font));
  await build({entryPoints:[path.join(import.meta.dirname,'view.ts')],bundle:true,format:'iife',globalName:'ClareiaView',outfile:path.join(outDir,'view.js'),logLevel:'silent'});
  await versionAssets(outDir);
  const deputies=deputiesOf({ids:active.scope.ids,people:active.people,summary,suppliers:supplierSummary}),period={year:String(active.scope.year),coverage:active.scope.months.map(m=>m-1),minMonths:summary.minMonths};
  const seen=new Set(active.scope.ids),extras:{deputies:Deputy[];period:Period}[]=[];
  for(const e of entries.filter(e=>e.year!==sitePlan.defaultYear)){
    const year=pubs.get(e.year)!,{summary:ys,suppliers:yp}=built.get(e.year)!,ids=year.scope.ids.filter(id=>!seen.has(id));
    ids.forEach(id=>seen.add(id));
    if(ids.length)extras.push({deputies:deputiesOf({ids,people:year.people,summary:ys,suppliers:yp}),period:{year:String(year.scope.year),coverage:year.scope.months.map(m=>m-1),minMonths:ys.minMonths}});
  }
  // The cache sits beside the output so an unchanged image is copied, not rendered again; the output folder itself is rebuilt every time.
  const share=siteOptions.shareImages?await generateShareImages({outDir,publicationId:STAGING,deputies,period,portraitsDir,pageDir:PAGE,cacheDir:finalDir+'.share-cache'}):null;
  if(share)console.error(`Imagens de compartilhamento: ${share.rendered} geradas, ${share.reused} reaproveitadas, ${(share.ms/1000).toFixed(1)} s`);
  const publicationId=await dataFolderId(data);
  await fs.rename(data,path.join(outDir,'data',publicationId));
  await fs.writeFile(path.join(outDir,'manifest.json'),JSON.stringify({base:`data/${publicationId}`,domains,defaultYear:sitePlan.defaultYear,years:manifestYears}));
  // Static pages first: both read the bare index.html, and the prerender overwrites it with the home page.
  await writeStaticPages(outDir,siteOptions);
  await writePrerendered(outDir,publicationId,deputies,period,siteOptions,share?.names,extras);
  const files=await listFiles(outDir),sizes=await Promise.all(files.map(async f=>(await fs.stat(f)).size));
  // The all-months zip is the one file allowed past 10 MiB; zipOf already keeps it under the 25 MiB Workers asset limit.
  checkLimits(files.length,Math.max(...sizes.filter((_,i)=>!files[i].endsWith('.zip'))));
  await fs.rm(finalDir,{recursive:true,force:true});
  await fs.rename(outDir,finalDir);
  return {publicationId,files:files.length,years:results};
}

// Everything is cut from the same records written for the site, so a download is never newer or wider than the pages.
async function writeOpenData(data:string,records:ReturnType<typeof withSupplierLabels>,json:{summary:string;suppliers:string;index:string},held:{personId:number}[],meta:{year:number;publishedAt:string;collectedAt:string}):Promise<void>{
  const dir=path.join(data,'abertos'),tables=monthlyTables(records),files:OpenData['files']=[],zipName=`despesas-${meta.year}.zip`;
  await fs.mkdir(dir);
  const zip=zipOf(tables,meta.publishedAt);
  if(zip){await fs.writeFile(path.join(dir,zipName),zip);files.push(fileEntry(zipName,'abertos/'+zipName,zip,'zip',records.length));}
  for(const t of tables){await fs.writeFile(path.join(dir,t.name),t.text);files.push(fileEntry(t.name,'abertos/'+t.name,t.text,'month',t.records));}
  for(const [name,text] of [['summary.json',json.summary],['fornecedores.json',json.suppliers],['index.json',json.index]])files.push(fileEntry(name,name,text,'json'));
  const manifest:OpenData={schema:'clareia.open-data.v1',year:meta.year,publishedAt:meta.publishedAt,collectedAt:meta.collectedAt,files,quirks:quirkCounts(records,held,{withheld:WITHHELD,individual:'Fornecedor pessoa física'})};
  await fs.writeFile(path.join(data,'dados-abertos.json'),JSON.stringify(manifest));
}
export const WITHHELD='Nome não exibido pelo Clareia',LABELS=new Set(['Fornecedor pessoa física',WITHHELD,'Fornecedor não informado']);
const rows=(m:Map<string,{count:number;cents:number}>)=>[...m].map(([name,t])=>({name,...t})).sort((a,c)=>c.cents-a.cents);
// Typed supplier names the owner approved to stay public (config/supplier-names-public.json, exact names).
async function readApprovedNames():Promise<Set<string>>{
  const names:unknown=JSON.parse(await fs.readFile(path.join(import.meta.dirname,'..','config','supplier-names-public.json'),'utf8'));
  if(!Array.isArray(names)||names.some(n=>typeof n!=='string'))throw new Error('config/supplier-names-public.json deve ser uma lista de nomes');
  return new Set(names as string[]);
}
// Reviewed display names for CNPJs, by supplierKey (config/supplier-names.json); anything else uses the spelling with the most records.
async function readSupplierNames():Promise<SupplierNames>{
  const names:unknown=JSON.parse(await fs.readFile(path.join(import.meta.dirname,'..','config','supplier-names.json'),'utf8'));
  if(typeof names!=='object'||names===null||Array.isArray(names)||Object.values(names).some(v=>typeof v?.name!=='string'||!v.name.trim()))throw new Error('config/supplier-names.json deve mapear supplierKey para {name}');
  return names as SupplierNames;
}
