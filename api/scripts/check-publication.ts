import fs from 'node:fs/promises';
import path from 'node:path';
import {LABELS,dataFolderId,publicId} from '../../src/build-site.ts';

const SUMMARY_SCHEMAS=['clareia.site-summary.v3'],SUPPLIER_SCHEMAS=['clareia.supplier-summary.v1'];
const dir=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Uso: check-publication <pasta de uma publicação>');
const refuse=(n:number,why:string):never=>{console.error(`RECUSA ${n}: ${why}`);process.exit(1);};
const json=async(file:string)=>JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));

const id=await dataFolderId(dir);
if(id!==path.basename(dir))refuse(1,`id recalculado ${id} difere do nome da pasta ${path.basename(dir)}`);
const summary=await json('summary.json'),suppliers=await json('fornecedores.json');
if(!SUMMARY_SCHEMAS.includes(summary.schema))refuse(2,`summary.schema ${summary.schema} não aceito`);
if(!SUPPLIER_SCHEMAS.includes(suppliers.schema))refuse(2,`fornecedores.schema ${suppliers.schema} não aceito`);

let checked=0;
for(const person of summary.people){
  const file=path.join(dir,'deputados',String(person.id),'despesas.json');
  let records:any[];
  try{records=JSON.parse(await fs.readFile(file,'utf8'));}catch(e:any){if(e.code==='ENOENT')continue;throw e;}
  for(const r of records){
    if(!r.supplierVerified&&(r.supplierKey!==undefined||r.source?.sha256!==undefined))refuse(3,`registro ${r.id} não verificado traz supplierKey ou source.sha256`);
    if(LABELS.has(r.supplier)&&r.receipt!==null)refuse(4,`registro ${r.id} com rótulo genérico traz recibo`);
    if(publicId(r)!==r.id)refuse(5,`registro ${r.id}: id não confere com os campos publicados`);
    checked++;
  }
}
console.log(`Recusas conferidas: pasta ${id}, ${checked} registros, nenhuma disparou.`);
