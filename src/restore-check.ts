import type {DB} from './store.ts';

export type ExpensePublication={id:string;audit:string|null;rows:number};
export async function activeExpensePublication(db:DB):Promise<ExpensePublication|null>{
  const result=await db.query<ExpensePublication>(`SELECT a.publication_id AS id,(SELECT status FROM publication_audits WHERE publication_id=a.publication_id) AS audit,(SELECT count(*)::int FROM expenses_v2 WHERE publication_id=a.publication_id) AS rows FROM active_publication a WHERE a.domain='despesas'`);
  return result.rows[0]??null;
}
