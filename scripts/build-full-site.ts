import fs from 'node:fs/promises';
import path from 'node:path';
import {buildSite} from '../src/build-site.ts';
import {signReviewItems,writeReview,writeSignReview} from '../src/review-list.ts';
import {resolveOptions} from '../src/prerender.ts';
import {auditBillsVersion,buildBillsVersion,storeBillsVersion} from '../src/bills-publication.ts';
import {auditExpenseVersion,buildExpenseVersion} from '../src/expense-publication.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';
import {buildSiteCeiling} from '../src/ceiling-site.ts';
import {canonical,hash} from '../src/model.ts';
import {assertYearVersion,coverageOf,parseFullSiteConfig} from '../src/full-site-config.ts';
import {auditPeopleCoverage,buildPeopleCoverage,reobservePeopleCoverage,storePeopleCoverage} from '../src/people-publication.ts';
import {activePublication,publishDomain,recordDomainAudit} from '../src/publications.ts';
import type {Domain} from '../src/publications.ts';
import {assertHeaders,addNoindex,latestCheckedAt} from '../src/site-headers.ts';
import {openDB} from '../src/store.ts';
import {auditRecord} from '../src/audit-record.ts';
import {AMENDMENT_LINKS_FILE,assertApprovable,auditAmendmentsVersion,buildAmendmentsVersion,loadReviewedLinks,reobserveAmendmentsVersion,storeAmendmentsVersion} from '../src/amendments-publication.ts';
import {auditSenatorsVersion,buildSenatorsVersion,reobserveSenatorsVersion,senatorsSummary,storeSenatorsVersion,writeSenatorsSite} from '../src/senado-publication.ts';
import type {SenatorsYearRun} from '../src/senado-publication.ts';
import {auditVotesVersion,buildVotesVersion,storeVotesVersion} from '../src/votes-publication.ts';

delete process.env.TEST_DATABASE_URL;
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run build:full -- --out PASTA --portraits PASTA [--config config/full-site.json] [--data-root data] [--ceiling-root data] [--noindex | --sitemap] [--site-url URL] [--allow-missing-portraits] [--share-images] [--dry-run]\nMonta o site completo a partir das execuções auditadas listadas na configuração, num banco em memória. Cada domínio só é aprovado com a auditoria real da própria execução; qualquer auditoria ausente ou reprovada interrompe a montagem. --sitemap gera o sitemap.xml e o robots.txt apontando para ele (para o domínio de produção; não combina com --noindex). --site-url é a origem usada nos endereços canônicos e nas imagens de compartilhamento. --share-images gera as imagens de compartilhamento (JPEG 1200x630 e 1080x1080) com Playwright e as usa nas imagens de prévia (og:image); exige npx playwright install chromium. --dry-run só confere as entradas. --ceiling-root aponta para a pasta de dados onde está a execução do limite da cota (padrão: a mesma de --data-root); a execução de cada ano vem de ceilingRuns na configuração e só entra com auditoria aprovada. Se amendmentsRun estiver na configuração, a execução auditada de emendas entra em arquivos próprios por deputado, sem somar à cota. Se senators estiver na configuração, as execuções auditadas de senadores entram em arquivos próprios em senadores/, sem afetar os deputados. Sem --allow-missing-portraits, faltar o retrato de quem tem foto oficial interrompe a montagem.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--noindex','--sitemap','--dry-run','--allow-missing-portraits','--share-images'].includes(args[i]))continue;if(['--out','--portraits','--config','--data-root','--ceiling-root','--site-url'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const out=value('--out'),portraits=value('--portraits'),dryRun=args.includes('--dry-run'),root=path.resolve(value('--data-root')||'data','private'),ceilingRoot=value('--ceiling-root')?path.resolve(value('--ceiling-root'),'private'):root;
if(!out||!portraits)throw new Error('Informe --out e --portraits');
const siteOptions=resolveOptions({siteUrl:value('--site-url'),sitemap:args.includes('--sitemap'),noindex:args.includes('--noindex'),shareImages:args.includes('--share-images')});
const raw=JSON.parse(await fs.readFile(path.resolve(value('--config')||'config/full-site.json'),'utf8')),config=parseFullSiteConfig(raw);
const load=async(...parts:string[])=>{const file=path.join(parts[0]==='cota-ceiling'?ceilingRoot:root,...parts);try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){throw new Error(`Arquivo ausente ou ilegível: ${file}`,{cause:e});}};
const years=Object.keys(config.expenseYears).map(Number).sort((a,b)=>a-b),lotsOf=new Map<number,ExpenseLotRun[]>();
const pairs=new Map(years.map(year=>{const pair=coverageOf(config,year);return [`${pair.historyRun}|${pair.legacyRun}`,pair];}));
const sources=new Map(await Promise.all([...pairs].map(async ([key,{historyRun,legacyRun}])=>{
  const history=await load('people-history',historyRun,'history.json'),temporal=await load('people-history',historyRun,'temporal.json'),temporalAudit=await load('people-history',historyRun,'temporal-audit.json');
  const crosscheck=await load('people-legacy',legacyRun,'crosscheck.json'),crosscheckAudit=await load('people-legacy',legacyRun,'crosscheck-audit.json');
  if(crosscheckAudit.status!=='passed'||crosscheckAudit.crosscheckSha256!==hash(canonical(crosscheck)))throw new Error('Cruzamento sem auditoria aprovada para esta versão');
  const source={history,temporal,temporalAudit,crosscheck,crosscheckAudit,coverage:undefined as ReturnType<typeof buildPeopleCoverage>|undefined};
  return [key,source] as const;
})));
for(const year of years)lotsOf.set(year,await Promise.all(config.expenseYears[year].map(async runId=>{const d=path.join('expense-intermediate',runId);return {runId,manifest:await load(d,'run.json'),input:await load(d,'input.json'),report:await load(d,'batch.json'),audit:await load(d,'audit.json')};})));
const bills=await Promise.all(config.billsRuns.map(async run=>({report:await load('bills',run,'bills.json'),audit:await load('bills',run,'audit.json')})));
const social=config.socialRun?(await load('social',config.socialRun,'social.json')).people:undefined;
const votes=await Promise.all(config.votesRuns.map(async run=>({report:await load('votes',run,'votes.json'),ballots:await load('votes',run,'ballots.json'),audit:await load('votes',run,'audit.json')})));
const amendmentsInput=config.amendmentsRun?{report:await load('amendments',config.amendmentsRun,'amendments.json'),audit:await load('amendments',config.amendmentsRun,'audit.json')}:null;
const senatorsRuns:SenatorsYearRun[]|null=config.senators?await Promise.all(Object.keys(config.senators.years).map(Number).sort((a,b)=>a-b).map(async year=>{const run=config.senators!.years[year];return {year,parsed:await load('senado-ceaps',run,'parsed.json'),audit:await load('senado-ceaps',run,'audit.json'),coverage:await load('senado-ceaps',run,'coverage.json')};})):null;
const baseAudits=[...[...sources.values()].flatMap(s=>[s.temporalAudit,s.crosscheckAudit]),...[...lotsOf.values()].flat().map(l=>l.audit),...bills.map(b=>b.audit),...votes.map(v=>v.audit)];
const publicationAudits=[...baseAudits,...amendmentsInput?[amendmentsInput.audit]:[]];
const explicitPublishedAt=typeof raw.publishedAt==='string'&&!Number.isNaN(Date.parse(raw.publishedAt))?new Date(raw.publishedAt).toISOString():null;
// Fixed by the inputs, so rebuilding the same runs gives the same bytes under the same data hash.
const now=explicitPublishedAt??latestCheckedAt(baseAudits);
const amendmentsNow=explicitPublishedAt??latestCheckedAt(publicationAudits);
const senatorAudits=senatorsRuns?senatorsRuns.map(r=>r.audit):[];
const senatorsNow=senatorsRuns?explicitPublishedAt??latestCheckedAt(senatorAudits):null;
// The builders refuse any input whose own audit is missing, not passed or for another content.
for(const s of sources.values())s.coverage=buildPeopleCoverage(s.temporal,s.crosscheck,s.temporalAudit,now);
const billsVersion=buildBillsVersion(bills,now),votesVersion=buildVotesVersion(votes,now);
const amendmentsVersion=amendmentsInput?buildAmendmentsVersion(amendmentsInput.report,amendmentsInput.audit,await loadReviewedLinks(path.resolve(AMENDMENT_LINKS_FILE)),new Set<number>([...sources.values()].flatMap(s=>s.history.people.map((p:{id:number})=>p.id))),amendmentsNow):null;
if(amendmentsVersion&&amendmentsInput){assertApprovable(amendmentsVersion);latestCheckedAt([amendmentsInput.audit]);}
const senatorsVersion=senatorsRuns?buildSenatorsVersion(senatorsRuns,senatorsNow!):null;
const versions=years.map(year=>{
  const {historyRun,legacyRun}=coverageOf(config,year),source=sources.get(`${historyRun}|${legacyRun}`)!;
  const lots=lotsOf.get(year)!,expenses=buildExpenseVersion(lots,source.history,now);
  assertYearVersion(year,expenses,source.coverage!,lots[0].input.proposal);
  return {year,lots,expenses};
});
// The default year is published last so the active pointer ends on it; every other year is still named explicitly to the build.
const ordered=[...versions.filter(v=>v.year!==config.defaultYear),...versions.filter(v=>v.year===config.defaultYear)],{expenses}=ordered[ordered.length-1];
const defaultPair=coverageOf(config,config.defaultYear),defaultSource=sources.get(`${defaultPair.historyRun}|${defaultPair.legacyRun}`)!,defaultCoverage=defaultSource.coverage!;
// The ceiling only travels with an audit that passed for exactly this report; a year without a configured run shows no percentage.
const ceilingOf=new Map<number,ReturnType<typeof buildSiteCeiling>|null>();
for(const {year} of versions){const run=config.ceilingRuns[year];ceilingOf.set(year,run?buildSiteCeiling(await load('cota-ceiling',run,`cota-ceiling-${year}.json`),await load('cota-ceiling',run,'audit.json'),year):null);}
const ceiling=ceilingOf.get(expenses.scope.year)!;
const summary={expenses:expenses.id,people:expenses.scope.ids.length,records:expenses.records.length,totalCents:expenses.validation.totalCents,coverage:defaultCoverage.id,bills:billsVersion.id,votes:votesVersion.id,...amendmentsVersion?{amendments:amendmentsVersion.id,amendmentRows:amendmentsVersion.rows.length}:{},...senatorsVersion?{senators:senatorsSummary(senatorsVersion)}:{},ceiling:ceiling?ceiling.reportSha256:null,years:versions.map(v=>({year:v.year,expenses:v.expenses.id,records:v.expenses.records.length,totalCents:v.expenses.validation.totalCents}))};
if(dryRun){console.log(JSON.stringify({...summary,built:false}));process.exit(0);}
await fs.access(portraits).catch(()=>{throw new Error(`Pasta de retratos ausente: ${portraits}`);});
const db=await openDB(true);
try{
  // Each domain is approved only by the same audit its publish script runs; a failed one is recorded as failed and stops the build.
  const approve=async(domain:Domain,id:string,found:{status:'passed'|'failed';failures:string[]},inputAudits:{checkedAt?:unknown}[],builtAt=now)=>{
    const audit=auditRecord(found,inputAudits,builtAt);
    if(audit.status!=='passed'){await recordDomainAudit(db,id,'failed',audit as never);throw new Error(`Auditoria reprovada em ${domain}: ${audit.failures.slice(0,5).join(', ')}`);}
    await recordDomainAudit(db,id,'passed',audit as never);
  };
  for(const v of ordered){await publishDomain(db,'despesas',v.expenses,{reobserve:false});await approve('despesas',v.expenses.id,await auditExpenseVersion(db,v.expenses,v.lots),v.lots.map(l=>l.audit));}
  const otherSources=[...sources.values()].filter(s=>s!==defaultSource);
  const orderedSources=[...otherSources,defaultSource];
  for(const source of orderedSources){
    const {id}=source.coverage!,{temporal,crosscheck,temporalAudit,crosscheckAudit}=source;
    await storePeopleCoverage(db,source.coverage!);
    // Distinct run pairs can produce the same coverage ID, so storing it again may leave its publication order unchanged.
    if(source===defaultSource&&otherSources.some(s=>s.coverage!.id===id))await reobservePeopleCoverage(db,id);
    await approve('pessoas',id,await auditPeopleCoverage(db,id,temporal,crosscheck),[temporalAudit,crosscheckAudit]);
  }
  await storeBillsVersion(db,billsVersion);await approve('projetos',billsVersion.id,await auditBillsVersion(db,billsVersion.id,bills.map(b=>b.report)),bills.map(b=>b.audit));
  await storeVotesVersion(db,votesVersion);await approve('votacoes',votesVersion.id,await auditVotesVersion(db,votesVersion.id),votes.map(x=>x.audit));
  if(amendmentsVersion&&amendmentsInput){
    await storeAmendmentsVersion(db,amendmentsVersion);
    await reobserveAmendmentsVersion(db,amendmentsVersion.id);
    await approve('emendas',amendmentsVersion.id,await auditAmendmentsVersion(db,amendmentsVersion.id,amendmentsInput.report),[amendmentsInput.audit],amendmentsNow);
  }
  if(senatorsVersion&&senatorsRuns){
    await storeSenatorsVersion(db,senatorsVersion);
    await reobserveSenatorsVersion(db,senatorsVersion.id);
    await approve('senadores',senatorsVersion.id,await auditSenatorsVersion(db,senatorsVersion.id,senatorsRuns),senatorAudits,senatorsNow!);
  }
  const expected:[Domain,string][]=[['despesas',expenses.id],['pessoas',defaultCoverage.id],['projetos',billsVersion.id],['votacoes',votesVersion.id]];
  if(amendmentsVersion)expected.push(['emendas',amendmentsVersion.id]);
  if(senatorsVersion)expected.push(['senadores',senatorsVersion.id]);
  for(const [domain,id] of expected)if((await activePublication(db,domain))?.id!==id)throw new Error(`Versão de ${domain} não ficou ativa`);
  const {years:yearResults,...built}=await buildSite(db,out,portraits,siteOptions,{defaultYear:config.defaultYear,years:versions.map(v=>({year:v.year,publicationId:v.expenses.id,ceiling:ceilingOf.get(v.year)!})),social,...amendmentsVersion?{amendments:{publicationId:amendmentsVersion.id}}:{}}),allIds=[...new Set(versions.flatMap(v=>v.expenses.scope.ids))],have=await Promise.all(allIds.map(id=>fs.access(path.join(portraits,`${id}.jpg`)).then(()=>true,()=>false))),noPortrait=have.filter(h=>!h).length;
  if(senatorsVersion)await writeSenatorsSite(db,out,senatorsVersion.id);
  const {review,partyReview,names}=yearResults.find(r=>r.year===config.defaultYear)!;
  await writeReview(built.publicationId,review,names,partyReview);await writeSignReview(built.publicationId,signReviewItems(expenses.records,expenses.people));
  // A non-default year's lists carry the year in the file name so they never overwrite the default year's.
  for(const r of yearResults)if(r.year!==config.defaultYear){const v=versions.find(x=>x.year===r.year)!,id=`${built.publicationId}-${r.year}`;await writeReview(id,r.review,r.names,r.partyReview);await writeSignReview(id,signReviewItems(v.expenses.records,v.expenses.people));}
  const headersFile=path.join(out,'_headers');
  if(args.includes('--noindex'))await fs.writeFile(headersFile,addNoindex(await fs.readFile(headersFile,'utf8')));
  assertHeaders(await fs.readFile(headersFile,'utf8'),args.includes('--noindex'));
  const expectedMissing=allIds.filter(id=>!orderedSources.some(s=>s.history.people.find((p:{id:number})=>p.id===id)?.profile?.photo)).length;
  if(noPortrait>expectedMissing&&!args.includes('--allow-missing-portraits'))throw new Error(`Faltam ${noPortrait-expectedMissing} retratos de quem tem foto oficial (${noPortrait} ausentes, ${expectedMissing} sem foto no cadastro). Use --allow-missing-portraits só em montagens locais.`);
  console.log(JSON.stringify({...summary,...built,ufPendencias:review.length,partidoPendencias:partyReview.length,nomesOcultados:names.withheld.length,noPortrait,noindex:args.includes('--noindex')}));
}finally{await db.close();}
