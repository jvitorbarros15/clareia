import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {BASE,canonical,hash,officialUrl} from './model.ts';
import {PeopleCapture,inspectSample,inspectPeopleContract,parseDiscoveryScope} from './people-discovery.ts';
import type {Capture,DiscoveryScope,DiscoveryReport} from './people-discovery.ts';
import {findCpfs} from './cpf-scan.ts';

export type HistoryEvent=ReturnType<typeof inspectSample>['events'][number];
export type HistorySource=Capture&{pass:1|2};
export type HistoryPerson={
  id:number;profile:{name:string;photo:string|null;source:HistorySource}|null;
  events:HistoryEvent[];sources:HistorySource[];
  status:'stable'|'changed'|'failed';issues:string[];
};
export type Legislature={id:number;start:string;end:string;source:HistorySource};
export type HistoryReport={
  schema:'clareia.people-history.v1';discoverySha256:string;scope:DiscoveryScope;
  createdAt:string;ruleVersion:'camara.history-reported-change.v1';
  status:'review-required';dateMeaning:'reported-change-not-independently-confirmed';
  legislature:Legislature;references:{states:{sigla:string;nome:string}[];source:HistorySource};
  people:HistoryPerson[];sources:HistorySource[];
  coverage:{expected:number;stable:number;changed:number;failed:number};
};
const profileSchema=z.object({dados:z.object({id:z.number().int().positive(),ultimoStatus:z.object({nome:z.string().min(1),urlFoto:z.string().nullable()})})});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const digestEvents=(events:HistoryEvent[])=>hash(events.map(e=>canonical(e)).sort().join('\n'));

// Restrict worker count to protect the source. One person's failed request does
// not turn that person into an empty history or zero expenditure.
export async function collectHistory(discovery:DiscoveryReport,pass1:PeopleCapture,pass2:PeopleCapture,options:{workers?:number;wait?:(ms:number)=>Promise<void>;progress?:(pass:number,done:number,total:number)=>void}={}):Promise<HistoryReport>{
  const scope=parseDiscoveryScope(discovery.scope),ids=discovery.candidates.map(c=>c.id);
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Universo de históricos inválido');
  const workers=options.workers??2;if(!Number.isInteger(workers)||workers<1||workers>3)throw new Error('Concorrência de históricos inválida');
  const wait=options.wait??sleep,progress=options.progress??(()=>{});
  const {data:doc}=await pass1.json(BASE+'/api-docs');inspectPeopleContract(doc);
  const {data:legRaw,source:legSource}=await pass1.json(`${BASE}/legislaturas/${scope.legislature}`);
  const parsedLeg=z.object({dados:z.object({id:z.number().int(),dataInicio:date,dataFim:date})}).safeParse(legRaw);
  if(!parsedLeg.success||parsedLeg.data.dados.id!==scope.legislature)throw new Error('Contrato da legislatura mudou');
  const l=parsedLeg.data.dados;
  if([l.dataInicio,l.dataFim].some(value=>{const d=new Date(value+'T00:00:00Z');return Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value;})||l.dataInicio>l.dataFim)throw new Error('Datas da legislatura inválidas');
  if(l.dataInicio>scope.start||l.dataFim<scope.end)throw new Error('Período atravessa a legislatura contratada');
  const {data:refRaw,source:refSource}=await pass1.json(BASE+'/referencias/deputados/codSituacao');
  const parsedRefs=z.object({dados:z.array(z.object({sigla:z.string().min(1),nome:z.string().min(1)})).min(1)}).safeParse(refRaw);
  if(!parsedRefs.success)throw new Error('Contrato das situações mudou');
  const people=new Map<number,HistoryPerson>();
  const knownPrivateIds=new Set<string>();
  async function run(pass:1|2,capture:PeopleCapture){
    let cursor=0,done=0;
    await Promise.all(Array.from({length:workers},async()=>{
      while(cursor<ids.length){
        const id=ids[cursor++];
        const current:HistoryPerson=people.get(id)??{id,profile:null,events:[],sources:[],status:'failed',issues:[]};
        people.set(id,current);
        try{
          if(pass===1){
            const {data:raw,source}=await capture.json(`${BASE}/deputados/${id}`),profile=profileSchema.safeParse(raw);
            if(typeof raw.dados?.cpf==='string'){const digits=raw.dados.cpf.replace(/\D/g,'');if(digits.length===11)knownPrivateIds.add(hash(digits));}
            if(!profile.success||profile.data.dados.id!==id)throw new Error('Cadastro incompatível');
            current.profile={name:profile.data.dados.ultimoStatus.nome,photo:profile.data.dados.ultimoStatus.urlFoto?officialUrl(profile.data.dados.ultimoStatus.urlFoto!,'photo'):null,source:{...source,pass}};
          }
          const {data:raw,source}=await capture.json(`${BASE}/deputados/${id}/historico`);
          current.sources.push({...source,pass});
          const inspected=inspectSample(id,{dados:{id}},raw,scope);
          if(pass===1){current.events=inspected.events;current.issues=[...inspected.issues];}
          else if(current.profile&&current.sources.some(s=>s.pass===1)){
            current.status=digestEvents(current.events)===digestEvents(inspected.events)?'stable':'changed';
            if(current.status==='changed')current.issues.push('history-changed-between-passes');
          }
        }catch{
          current.status='failed';current.issues.push(`capture-or-schema-failure-pass-${pass}`);
        }
        done++;progress(pass,done,ids.length);
        await wait(150);
      }
    }));
  }
  await run(1,pass1);await run(2,pass2);
  const list=ids.map(id=>people.get(id)!);
  // A pass-one parse failure cannot be repaired by a successful second pass.
  for(const person of list)if(person.issues.some(i=>i.startsWith('capture-or-schema-failure')))person.status='failed';
  const sources:HistorySource[]=[...pass1.captures.map(s=>({...s,pass:1 as const})),...pass2.captures.map(s=>({...s,pass:2 as const}))];
  const report:HistoryReport={schema:'clareia.people-history.v1',scope,discoverySha256:hash(canonical(discovery)),createdAt:new Date().toISOString(),ruleVersion:'camara.history-reported-change.v1',status:'review-required',dateMeaning:'reported-change-not-independently-confirmed',legislature:{id:l.id,start:l.dataInicio,end:l.dataFim,source:{...legSource,pass:1}},references:{states:parsedRefs.data.dados,source:{...refSource,pass:1}},people:list,sources,coverage:{expected:ids.length,stable:list.filter(p=>p.status==='stable').length,changed:list.filter(p=>p.status==='changed').length,failed:list.filter(p=>p.status==='failed').length}};
  if(findCpfs(JSON.stringify(report),knownPrivateIds))throw new Error('Identificador privado no relatório de históricos');
  return report;
}

// Local key management shared by the discovery and history tools. Production
// callers provide the existing vault key through the environment instead.
export async function readLocalPeopleKey():Promise<Buffer>{
  const key=await fs.readFile(path.resolve('data/private/people-discovery/local-vault-key'));
  if(key.length!==32)throw new Error('Chave local inválida; execute a descoberta primeiro');
  return key;
}

// Load the exact approved discovery, including an older preserved version when
// the discovery run has since produced another report. Never infer the universe
// from the history output being audited.
export async function readAuditedPeopleDiscovery(runId:string,expectedHash?:string,baseDirectory=path.resolve('data/private/people-discovery')):Promise<DiscoveryReport>{
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId)||expectedHash!==undefined&&!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('Referência da descoberta inválida');
  const root=path.join(baseDirectory,runId);
  const current=JSON.parse(await fs.readFile(path.join(root,'discovery.json'),'utf8')) as DiscoveryReport;
  const currentHash=hash(canonical(current));
  const archived=expectedHash!==undefined&&expectedHash!==currentHash;
  const report=archived?JSON.parse(await fs.readFile(path.join(root,'reports',expectedHash+'.json'),'utf8')) as DiscoveryReport:current;
  const reportHash=hash(canonical(report));
  const audit=JSON.parse(await fs.readFile(archived?path.join(root,'reports',reportHash+'.audit.json'):path.join(root,'audit.json'),'utf8'));
  if(report.schema!=='clareia.people-discovery.v1'||audit.schema!=='clareia.people-discovery-audit.v1'||audit.status!=='passed'||audit.reportSha256!==reportHash||expectedHash!==undefined&&reportHash!==expectedHash)throw new Error('Descoberta não tem auditoria correspondente aprovada');
  parseDiscoveryScope(report.scope);
  return report;
}
