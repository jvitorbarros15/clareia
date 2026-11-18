import fs from 'node:fs/promises';
import path from 'node:path';
import {dataFolderId,WITHHELD} from '../../src/build-site.ts';

// Cuts a few deputies out of a built publication folder and rewrites summary, index and fornecedores so the subset is internally consistent.
const [source,outRoot]=process.argv.slice(2);
if(!source||!outRoot)throw new Error('Uso: make-fixture <pasta da publicação> <pasta de saída>');
const read=async(f:string)=>JSON.parse(await fs.readFile(path.join(source,f),'utf8'));
const summary=await read('summary.json'),index=await read('index.json'),suppliers=await read('fornecedores.json');

const INDIVIDUAL='Fornecedor pessoa física';
const features:Record<number,{records:any[];tags:Set<string>}>={};
for(const p of summary.people){
  const records:any[]=await fs.readFile(path.join(source,'deputados',String(p.id),'despesas.json'),'utf8').then(JSON.parse,()=>[]);
  const tags=new Set<string>();
  if(p.months.some((m:any)=>m.held))tags.add('held');
  for(const r of records){
    if(r.cents<0)tags.add('negative');
    if(r.supplier===INDIVIDUAL)tags.add('individual');
    if(r.supplier===WITHHELD)tags.add('withheld');
    if(JSON.stringify(r).includes('[CPF omitido]'))tags.add('cpf-omitted');
    if(r.sourceCents!==undefined)tags.add('sign-fixed');
  }
  features[p.id]={records,tags};
}
const need=['held','negative','individual','withheld','cpf-omitted','sign-fixed'];
const chosen:number[]=[];
const covered=()=>new Set(chosen.flatMap(id=>[...features[id].tags]));
while(need.some(t=>!covered().has(t))){
  const missing=need.filter(t=>!covered().has(t));
  const best=Object.keys(features).map(Number).filter(id=>features[id].records.length>0&&!chosen.includes(id))
    .map(id=>({id,gain:missing.filter(t=>features[id].tags.has(t)).length,size:features[id].records.length}))
    .filter(c=>c.gain>0).sort((a,b)=>b.gain-a.gain||a.size-b.size)[0];
  if(!best)throw new Error('Nenhum deputado cobre: '+missing.join(', '));
  chosen.push(best.id);
}
const empty=index.withoutData.map(Number).sort((a:number,b:number)=>a-b)[0];
const ids=[...chosen,empty].sort((a,b)=>a-b),keep=new Set(ids);
console.log('deputados:',ids.join(','),'tags:',[...covered()].join(','));

const people=summary.people.filter((p:any)=>keep.has(p.id));
const records=people.reduce((n:number,p:any)=>n+p.records,0),totalCents=people.reduce((n:number,p:any)=>n+p.cents,0);
const outSummary={...summary,scope:{...summary.scope,ids},totalCents,records,people};

const cellsOf=(id:number)=>suppliers.people[String(id)] as number[][];
const labels=[...new Set(ids.flatMap(id=>cellsOf(id).map(c=>suppliers.suppliers[c[2]] as string)))].sort();
const labelIndex=new Map(labels.map((l,i)=>[l,i]));
const outSuppliers={...suppliers,suppliers:labels,people:Object.fromEntries(ids.map(id=>[String(id),cellsOf(id).map(c=>[c[0],c[1],labelIndex.get(suppliers.suppliers[c[2]])!,c[3],c[4]])]))};

const v=index.validation;
const heldCompetences=v.heldCompetences.filter((h:any)=>keep.has(h.personId));
const heldMonths=Object.fromEntries(Object.entries(v.heldMonths).filter(([k])=>keep.has(Number(k))));
const validation={...v,heldCompetences,heldMonths,totalCents,recordCount:records,independentTotalCents:totalCents};
delete validation.signFix;
const outIndex={...index,scope:{...index.scope,ids},people:index.people.filter((p:any)=>keep.has(p.id)),withoutData:[empty],validation,audit:{...index.audit,selected:records}};

const tmp=path.join(outRoot,'.building');
await fs.rm(tmp,{recursive:true,force:true});
await fs.mkdir(path.join(tmp,'deputados'),{recursive:true});
const write=(f:string,v:unknown)=>fs.writeFile(path.join(tmp,f),JSON.stringify(v));
await write('summary.json',outSummary);
await write('index.json',outIndex);
await write('fornecedores.json',outSuppliers);
for(const id of ids)if(features[id].records.length){
  await fs.mkdir(path.join(tmp,'deputados',String(id)),{recursive:true});
  await fs.copyFile(path.join(source,'deputados',String(id),'despesas.json'),path.join(tmp,'deputados',String(id),'despesas.json'));
}
const id=await dataFolderId(tmp);
await fs.rm(path.join(outRoot,id),{recursive:true,force:true});
await fs.rename(tmp,path.join(outRoot,id));
console.log(`${id}: ${ids.length} deputados, ${records} registros, ${totalCents} centavos`);
