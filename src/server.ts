import {openDB} from './store.ts';
import {lock} from './lock.ts';
import {createApp} from './app.ts';

// The embedded database allows one process; a shared Postgres does not need the file lock to serve reads.
const release=process.env.DATABASE_URL?async()=>{}:await lock();
let db:Awaited<ReturnType<typeof openDB>>;
try{db=await openDB();}catch(error){await release();throw error;}
const port=Number(process.env.PORT||4174);
const server=createApp(db,port);
server.listen(port,'127.0.0.1',()=>console.log(`Clareia · dados oficiais: http://127.0.0.1:${port}`));
let closing=false;
async function stop(code:number){if(closing)return;closing=true;server.close();await db.close().catch(()=>{});await release().catch(()=>{});process.exit(code);}
const fatal=(error:unknown)=>{console.error(error instanceof Error?error.message:'Falha interna');return stop(1);};
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);server.on('error',fatal);
