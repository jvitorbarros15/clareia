import fs from 'node:fs/promises';
import path from 'node:path';
import {auditPeopleCoverage,buildPeopleCoverage,storePeopleCoverage} from '../src/people-publication.ts';
import {canonical,hash} from '../src/model.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {openDB} from '../src/store.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run publish:people -- --history-run ID --legacy-run ID [--dry-run] [--approve]\nSem --approve a versão fica gravada e inativa. --dry-run não abre o banco.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--dry-run','--approve'].includes(args[i]))continue;if(['--history-run','--legacy-run'].includes(args[i])&&/^[a-zA-Z0-9-]{1,80}$/.test(args[i+1]??'')){i++;continue;}throw new Error('Argumento inválido');}
const historyRun=value('--history-run'),legacyRun=value('--legacy-run'),dryRun=args.includes('--dry-run'),approve=args.includes('--approve');
if(!historyRun||!legacyRun)throw new Error('Informe --history-run e --legacy-run');
if(dryRun&&approve)throw new Error('--dry-run e --approve são exclusivos');
const load=async(...parts:string[])=>JSON.parse(await fs.readFile(path.resolve('data/private',...parts),'utf8'));
const temporal=await load('people-history',historyRun,'temporal.json'),temporalAudit=await load('people-history',historyRun,'temporal-audit.json'),crosscheck=await load('people-legacy',legacyRun,'crosscheck.json'),crosscheckAudit=await load('people-legacy',legacyRun,'crosscheck-audit.json');
if(crosscheckAudit.status!=='passed'||crosscheckAudit.crosscheckSha256!==hash(canonical(crosscheck)))throw new Error('Cruzamento sem auditoria aprovada para esta versão');
const coverage=buildPeopleCoverage(temporal,crosscheck,temporalAudit,new Date().toISOString());
const counts=(key:'partyStatus'|'exercise')=>coverage.rows.reduce<Record<string,number>>((n,r)=>({...n,[r[key]]:(n[r[key]]??0)+1}),{});
const report={id:coverage.id,rows:coverage.rows.length,people:new Set(coverage.rows.map(r=>r.personId)).size,review:coverage.rows.filter(r=>r.review).length,party:counts('partyStatus'),exercise:counts('exercise')};
if(dryRun){console.log(JSON.stringify({...report,stored:false},null,2));process.exit(0);}
const db=await openDB();
try{
  await storePeopleCoverage(db,coverage,approve);
  const audit=await auditPeopleCoverage(db,coverage.id,temporal,crosscheck);
  if(audit.status!=='passed'){console.error(JSON.stringify({id:coverage.id,failures:audit.failures.length}));process.exitCode=1;}
  else if(approve)await recordDomainAudit(db,coverage.id,'passed',{checkedAt:audit.checkedAt});
  console.log(JSON.stringify({...report,stored:true,audit:audit.status,active:(await activePublication(db,'pessoas'))?.id===coverage.id},null,2));
}finally{await db.close();}
