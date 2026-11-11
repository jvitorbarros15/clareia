import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};

async function globalHeaders(root:string):Promise<[string,string][]>{
  const text=await fs.readFile(path.join(root,'_headers'),'utf8').catch(()=>'');
  const block=/^\/\*\r?\n((?:[ \t]+.*\r?\n)+)/m.exec(text)?.[1]||'';
  return block.split(/\r?\n/).filter(Boolean).map(line=>{const i=line.indexOf(':');return [line.slice(0,i).trim(),line.slice(i+1).trim()];});
}
// Development server for dist/: production is the same folder on a static host.
export function createApp(root:string,port:number){
  const base=path.resolve(root);
  return http.createServer(async(req,res)=>{
    try{
      for(const [name,value] of await globalHeaders(base))res.setHeader(name,value);
      res.setHeader('Cache-Control','no-store');
      let url:URL;try{url=new URL(req.url||'/',`http://127.0.0.1:${port}`);}catch{res.writeHead(400);res.end('Endereço inválido');return;}
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Método não permitido');return;}
      const target=path.resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      let file=target,body=target.startsWith(base+path.sep)&&path.basename(target)!=='_headers'?await fs.readFile(target).catch(()=>null):null;
      // Routes such as /deputado/123-nome have no file: like the static host, they answer with the page and the page reads the address.
      if(!body&&!path.extname(url.pathname)&&!url.pathname.startsWith('/data/')&&path.basename(target)!=='_headers'){file=path.join(base,'index.html');body=await fs.readFile(file).catch(()=>null);}
      if(!body){res.writeHead(404);res.end('Não encontrado');return;}
      res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){console.error(e instanceof Error?e.message:'Falha interna');if(res.headersSent)res.destroy();else{res.writeHead(400);res.end('Pedido inválido');}}
  });
}
