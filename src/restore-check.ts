import type {DB} from './store.ts';

export type ExpensePublication={id:string;audit:string|null;rows:number};
export async function activeExpensePublication(db:DB):Promise<ExpensePublication|null>{
  const result=await db.query<ExpensePublication>(`SELECT a.publication_id AS id,(SELECT status FROM publication_audits WHERE publication_id=a.publication_id) AS audit,(SELECT count(*)::int FROM expenses_v2 WHERE publication_id=a.publication_id) AS rows FROM active_publication a WHERE a.domain='despesas'`);
  return result.rows[0]??null;
}
export function assertExpensePublication(found:ExpensePublication|null,id:string,rows:number){
  if(!found)throw new Error('Nenhuma publicação ativa de despesas no banco restaurado');
  if(found.id!==id)throw new Error(`Publicação ativa de despesas é ${found.id}, esperada ${id}`);
  if(found.audit!=='passed')throw new Error(`Auditoria da publicação ${found.id} não passou (${found.audit??'sem auditoria'})`);
  if(found.rows!==rows)throw new Error(`A publicação tem ${found.rows} linhas de despesas, esperadas ${rows}`);
}
