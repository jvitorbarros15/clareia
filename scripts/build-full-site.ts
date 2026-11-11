import fs from 'node:fs/promises';
import path from 'node:path';
import {buildSite} from '../src/build-site.ts';
import {resolveOptions} from '../src/prerender.ts';
import {auditBillsVersion,buildBillsVersion,storeBillsVersion} from '../src/bills-publication.ts';
import {auditExpenseVersion,buildExpenseVersion} from '../src/expense-publication.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';
import {canonical,hash} from '../src/model.ts';
import {auditPeopleCoverage,buildPeopleCoverage,storePeopleCoverage} from '../src/people-publication.ts';
import {activePublication,publishDomain,recordDomainAudit} from '../src/publications.ts';
import type {Domain} from '../src/publications.ts';
import {assertHeaders,addNoindex,latestCheckedAt} from '../src/site-headers.ts';
import {openDB} from '../src/store.ts';
import {auditVotesVersion,buildVotesVersion,storeVotesVersion} from '../src/votes-publication.ts';

delete process.env.TEST_DATABASE_URL;
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run build:full -- --out PASTA --portraits PASTA [--config config/full-site.json] [--data-root data] [--noindex | --sitemap] [--site-url URL] [--allow-missing-portraits] [--share-images] [--dry-run]\nMonta o site completo a partir das execuções auditadas listadas na configuração, num banco em memória. Cada domínio só é aprovado com a auditoria real da própria execução; qualquer auditoria ausente ou reprovada interrompe a montagem. --sitemap gera o sitemap.xml e o robots.txt apontando para ele (para o domínio de produção; não combina com --noindex). --site-url é a origem usada nos endereços canônicos e nas imagens de compartilhamento. --share-images gera as imagens de compartilhamento (PNG 1200x630 e 1080x1080) com Playwright e as usa nas imagens de prévia (og:image); exige npx playwright install chromium. --dry-run só confere as entradas. Sem --allow-missing-portraits, faltar o retrato de quem tem foto oficial interrompe a montagem.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--noindex','--sitemap','--dry-run','--allow-missing-portraits','--share-images'].includes(args[i]))continue;if(['--out','--portraits','--config','--data-root','--site-url'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const out=value('--out'),portraits=value('--portraits'),dryRun=args.includes('--dry-run'),root=path.resolve(value('--data-root')||'data','private');
if(!out||!portraits)throw new Error('Informe --out e --portraits');
const siteOptions=resolveOptions({siteUrl:value('--site-url'),sitemap:args.includes('--sitemap'),noindex:args.includes('--noindex'),shareImages:args.includes('--share-images')});
const RUN=/^[a-zA-Z0-9-]{1,80}$/,runs=(config:Record<string,unknown>,key:string)=>{const list=config[key];if(!Array.isArray(list)||!list.length||!list.every(r=>typeof r==='string'&&RUN.test(r))||new Set(list).size!==list.length)throw new Error(`Configuração inválida: ${key}`);return list as string[];};
const raw=JSON.parse(await fs.readFile(path.resolve(value('--config')||'config/full-site.json'),'utf8')),one=(key:string)=>{if(typeof raw[key]!=='string'||!RUN.test(raw[key]))throw new Error(`Configuração inválida: ${key}`);return raw[key] as string;};
const config={historyRun:one('historyRun'),legacyRun:one('legacyRun'),expenseRuns:runs(raw,'expenseRuns'),billsRuns:runs(raw,'billsRuns'),votesRuns:runs(raw,'votesRuns')};
const load=async(...parts:string[])=>{const file=path.join(root,...parts);try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){throw new Error(`Arquivo ausente ou ilegível: ${file}`,{cause:e});}};
const history=await load('people-history',config.historyRun,'history.json'),temporal=await load('people-history',config.historyRun,'temporal.json'),temporalAudit=await load('people-history',config.historyRun,'temporal-audit.json');
const crosscheck=await load('people-legacy',config.legacyRun,'crosscheck.json'),crosscheckAudit=await load('people-legacy',config.legacyRun,'crosscheck-audit.json');
if(crosscheckAudit.status!=='passed'||crosscheckAudit.crosscheckSha256!==hash(canonical(crosscheck)))throw new Error('Cruzamento sem auditoria aprovada para esta versão');
const lots:ExpenseLotRun[]=await Promise.all(config.expenseRuns.map(async runId=>{const d=path.join('expense-intermediate',runId);return {runId,manifest:await load(d,'run.json'),input:await load(d,'input.json'),report:await load(d,'batch.json'),audit:await load(d,'audit.json')};}));
const bills=await Promise.all(config.billsRuns.map(async run=>({report:await load('bills',run,'bills.json'),audit:await load('bills',run,'audit.json')})));
const votes=await Promise.all(config.votesRuns.map(async run=>({report:await load('votes',run,'votes.json'),ballots:await load('votes',run,'ballots.json'),audit:await load('votes',run,'audit.json')})));
const publicationAudits=[temporalAudit,crosscheckAudit,...lots.map(l=>l.audit),...bills.map(b=>b.audit),...votes.map(v=>v.audit)];
// Fixed by the inputs, so rebuilding the same runs gives the same bytes under the same data hash.
const now=typeof raw.publishedAt==='string'&&!Number.isNaN(Date.parse(raw.publishedAt))?new Date(raw.publishedAt).toISOString():latestCheckedAt(publicationAudits);
// The builders refuse any input whose own audit is missing, not passed or for another content.
const expenses=buildExpenseVersion(lots,history,now),coverage=buildPeopleCoverage(temporal,crosscheck,temporalAudit,now),billsVersion=buildBillsVersion(bills,now),votesVersion=buildVotesVersion(votes,now);
if(coverage.temporalSha256!==lots[0].input.proposal.temporalSha256||coverage.crosscheckSha256!==lots[0].input.proposal.crosscheckSha256)throw new Error('Despesas e cobertura de pessoas vêm de versões temporais diferentes');
const summary={expenses:expenses.id,people:expenses.scope.ids.length,records:expenses.records.length,totalCents:expenses.validation.totalCents,coverage:coverage.id,bills:billsVersion.id,votes:votesVersion.id};
if(dryRun){console.log(JSON.stringify({...summary,built:false}));process.exit(0);}
await fs.access(portraits).catch(()=>{throw new Error(`Pasta de retratos ausente: ${portraits}`);});
const db=await openDB(true);
try{
  // Each domain is approved only by the same audit its publish script runs; a failed one is recorded as failed and stops the build.
  const approve=async(domain:Domain,id:string,found:{status:'passed'|'failed';failures:string[]})=>{
    const audit={...found,checkedAt:now};
    if(audit.status!=='passed'){await recordDomainAudit(db,id,'failed',audit as never);throw new Error(`Auditoria reprovada em ${domain}: ${audit.failures.slice(0,5).join(', ')}`);}
    await recordDomainAudit(db,id,'passed',audit as never);
  };
  await publishDomain(db,'despesas',expenses,{reobserve:false});await approve('despesas',expenses.id,await auditExpenseVersion(db,expenses,lots));
  await storePeopleCoverage(db,coverage);await approve('pessoas',coverage.id,await auditPeopleCoverage(db,coverage.id,temporal,crosscheck));
  await storeBillsVersion(db,billsVersion);await approve('projetos',billsVersion.id,await auditBillsVersion(db,billsVersion.id,bills.map(b=>b.report)));
  await storeVotesVersion(db,votesVersion);await approve('votacoes',votesVersion.id,await auditVotesVersion(db,votesVersion.id));
  for(const [domain,id] of [['despesas',expenses.id],['pessoas',coverage.id],['projetos',billsVersion.id],['votacoes',votesVersion.id]] as const)if((await activePublication(db,domain))?.id!==id)throw new Error(`Versão de ${domain} não ficou ativa`);
  const built=await buildSite(db,out,portraits,siteOptions),have=await Promise.all(expenses.scope.ids.map(id=>fs.access(path.join(portraits,`${id}.jpg`)).then(()=>true,()=>false))),noPortrait=have.filter(h=>!h).length;
  const headersFile=path.join(out,'_headers');
  if(args.includes('--noindex'))await fs.writeFile(headersFile,addNoindex(await fs.readFile(headersFile,'utf8')));
  assertHeaders(await fs.readFile(headersFile,'utf8'),args.includes('--noindex'));
  const expectedMissing=expenses.scope.ids.filter(id=>!history.people.find((p:{id:number})=>p.id===id)?.profile?.photo).length;
  if(noPortrait>expectedMissing&&!args.includes('--allow-missing-portraits'))throw new Error(`Faltam ${noPortrait-expectedMissing} retratos de quem tem foto oficial (${noPortrait} ausentes, ${expectedMissing} sem foto no cadastro). Use --allow-missing-portraits só em montagens locais.`);
  console.log(JSON.stringify({...summary,...built,noPortrait,noindex:args.includes('--noindex')}));
}finally{await db.close();}
