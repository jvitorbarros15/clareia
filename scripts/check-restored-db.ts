import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {activeExpensePublication} from '../src/restore-check.ts';

const dir=process.argv[2];
if(!dir)throw new Error('Uso: check-restored-db <pasta de dados restaurada>');
const lite=new PGlite(path.resolve(dir,'local','postgres'));
try{
  const found=await activeExpensePublication({query:<T>(sql:string,params?:unknown[])=>lite.query<T>(sql,params),close:()=>lite.close()});
  console.log(JSON.stringify(found));
  if(!found||found.audit!=='passed'||!found.rows)throw new Error('Publicação de despesas aprovada não encontrada no banco restaurado');
}finally{await lite.close();}
