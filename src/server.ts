import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openDB,readSnapshot} from './store.ts';
import {parseFilters,results,csv} from './queries.ts';
import {lock} from './lock.ts';

const release=await lock();
let db:Awaited<ReturnType<typeof openDB>>;
try{db=await openDB();}catch(error){await release();throw error;}
const port=Number(process.env.PORT||4174);
const files:Record<string,string>={'/':'real/index.html','/app.js':'real/app.js','/styles.css':'real/styles.css'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${port}`);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.camara.leg.br; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  const json=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  if(req.method!=='GET'&&req.method!=='HEAD'){json(405,{error:'Método não permitido'});return;}
  try {
    if(url.pathname==='/api/status'){
      const latest=await db.query('SELECT id,status,started_at,finished_at FROM runs ORDER BY started_at DESC LIMIT 1');const snapshot=await readSnapshot(db);
      json(200,{ready:!!snapshot,lastRun:latest.rows[0]||null,snapshotId:snapshot?.id||null,coverage:snapshot?.scope||null});return;
    }
    if(/^\/portraits\/\d+\.jpg$/.test(url.pathname)){
      const body=await fs.readFile(path.resolve('real',url.pathname.slice(1)));res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(body);return;
    }
    if(url.pathname==='/api/spending'||url.pathname==='/api/export'){
      const snapshot=await readSnapshot(db,url.searchParams.get('snapshot')||undefined);
      if(!snapshot){json(503,{error:'Nenhuma versão verificada disponível para este pedido. Execute a coleta antes de abrir a página.'});return;}
      let filters;try{filters=parseFilters(url.searchParams,snapshot);}catch{json(400,{error:'O recorte solicitado não está disponível nesta versão.'});return;}
      const data=results(snapshot,filters);
      const audit=JSON.parse(await fs.readFile('data/local/reconciliation.json','utf8').catch(()=>'null'));
      if(audit?.snapshotId===snapshot.id&&audit.status==='failed'){json(503,{error:'Esta versão foi retida: a conferência independente encontrou divergências. Nenhum valor será apresentado até a revisão.'});return;}
      const responseData={...data,externalReconciliation:audit?.snapshotId===snapshot.id?audit:null};
      if(url.pathname==='/api/export'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="clareia-${snapshot.id.slice(0,12)}.csv"`});res.end(csv(data.records));}else json(200,responseData);
      return;
    }
    const file=files[url.pathname];if(!file){res.writeHead(404);res.end('Não encontrado');return;}
    const body=await fs.readFile(path.resolve(file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(req.method==='HEAD'?undefined:body);
  }catch(e){console.error(e instanceof Error?e.message:'Falha interna');json(500,{error:'Falha ao consultar os dados. Nenhum valor foi estimado.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Clareia · dados oficiais: http://127.0.0.1:${port}`));
let closing=false;async function close(){if(closing)return;closing=true;server.close();await db.close();await release();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
server.on('error',async error=>{console.error(error.message);await db.close();await release();process.exit(1);});
