import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {servedSnapshot} from './store.ts';
import type {DB} from './store.ts';
import {parseFilters,results,csv} from './queries.ts';
import {ROOT} from './lock.ts';

const files:Record<string,string>={'/':'real/index.html','/app.js':'real/app.js','/styles.css':'real/styles.css'};
export function createApp(db:DB,port:number){
  return http.createServer(async(req,res)=>{
    const json=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      let url:URL;try{url=new URL(req.url||'/',`http://127.0.0.1:${port}`);}catch{json(400,{error:'Endereço inválido'});return;}
      if(req.method!=='GET'&&req.method!=='HEAD'){json(405,{error:'Método não permitido'});return;}
      if(url.pathname==='/api/status'){
        const latest=await db.query('SELECT id,status,started_at,finished_at FROM runs ORDER BY started_at DESC LIMIT 1');const served=await servedSnapshot(db);
        json(200,{ready:!!served,lastRun:latest.rows[0]||null,snapshotId:served?.snapshot.id||null,coverage:served?.snapshot.scope||null});return;
      }
      if(/^\/portraits\/\d+\.jpg$/.test(url.pathname)){
        const body=await fs.readFile(path.join(ROOT,'real',url.pathname.slice(1))).catch(()=>null);
        if(!body){res.writeHead(404);res.end('Não encontrado');return;}
        res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(body);return;
      }
      if(url.pathname==='/api/spending'||url.pathname==='/api/export'){
        const served=await servedSnapshot(db,url.searchParams.get('snapshot')||undefined);
        if(!served){json(503,{error:'Nenhuma versão conferida disponível para este pedido. Nenhum valor será apresentado até a conferência.'});return;}
        let filters;try{filters=parseFilters(url.searchParams,served.snapshot);}catch{json(400,{error:'O recorte solicitado não está disponível nesta versão.'});return;}
        const data=results(served.snapshot,filters);
        if(url.pathname==='/api/export'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="clareia-${served.snapshot.id.slice(0,12)}.csv"`});res.end(csv(data.records));}
        else json(200,{...data,current:served.current,externalReconciliation:served.audit});
        return;
      }
      const file=files[url.pathname];if(!file){res.writeHead(404);res.end('Não encontrado');return;}
      const body=await fs.readFile(path.join(ROOT,file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){console.error(e instanceof Error?e.message:'Falha interna');if(res.headersSent)res.destroy();else json(500,{error:'Falha ao consultar os dados. Nenhum valor foi estimado.'});}
  });
}
