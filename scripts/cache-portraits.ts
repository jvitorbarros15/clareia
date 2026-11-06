import fs from 'node:fs/promises';
import {officialUrl} from '../src/model.ts';
const response=await fetch('http://127.0.0.1:4174/api/spending');if(!response.ok)throw new Error('Inicie o servidor');
const data=await response.json();await fs.mkdir('real/portraits',{recursive:true});const sources=[];
for(const person of data.people){const url=officialUrl(person.photo||'','photo');if(!url)continue;
  const r=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok)throw new Error('Retrato: HTTP '+r.status);
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>2000000||bytes[0]!==255||bytes[1]!==216)throw new Error('Retrato não é JPEG no limite esperado');
  await fs.writeFile(`real/portraits/${person.id}.jpg`,bytes);sources.push({id:person.id,name:person.name,url,fetchedAt:new Date().toISOString()});
}
await fs.writeFile('real/portraits/sources.json',JSON.stringify(sources,null,2));console.log(`${sources.length} retratos oficiais preservados.`);
