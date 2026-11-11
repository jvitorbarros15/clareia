import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {activeExpensePublication,assertExpensePublication} from '../src/restore-check.ts';

const args=process.argv.slice(2),dir=args[0]?.startsWith('--')?undefined:args[0];
const option=(name:string)=>{const at=args.indexOf(`--${name}`);return at>=0?args[at+1]:undefined;};
const id=option('expect-id'),rows=Number(option('expect-rows'));
if(!dir||!id||!Number.isInteger(rows)||rows<=0)throw new Error('Uso: check-restored-db <pasta de dados restaurada> --expect-id <id da publicação> --expect-rows <linhas>');
const lite=new PGlite(path.resolve(dir,'local','postgres'));
try{
  const found=await activeExpensePublication({query:<T>(sql:string,params?:unknown[])=>lite.query<T>(sql,params),close:()=>lite.close()});
  console.log(JSON.stringify(found));
  assertExpensePublication(found,id,rows);
}finally{await lite.close();}
