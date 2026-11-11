const REQUIRED=['Content-Security-Policy','Strict-Transport-Security'];
const blocks=(text:string)=>text.split(/\r?\n/).reduce<string[][]>((all,line)=>{if(/^\S/.test(line))all.push([line.trim()]);else if(line.trim()&&all.length)all[all.length-1].push(line.trim());return all;},[]);

export function addNoindex(text:string):string{
  const lines=text.split('\n'),start=lines.findIndex(l=>l.trim()==='/*');
  if(start<0)throw new Error('_headers sem bloco /*');
  let end=start+1;while(end<lines.length&&/^\s+\S/.test(lines[end]))end++;
  lines.splice(end,0,'  X-Robots-Tag: noindex, nofollow');
  return lines.join('\n');
}

export function assertHeaders(text:string,noindex:boolean):void{
  const all=blocks(text).filter(b=>b[0]==='/*');
  if(all.length!==1)throw new Error(`_headers deve ter exatamente um bloco /* (encontrados: ${all.length})`);
  const names=new Set(all[0].slice(1).map(l=>l.split(':')[0].trim().toLowerCase()));
  for(const name of [...REQUIRED,...noindex?['X-Robots-Tag']:[]])if(!names.has(name.toLowerCase()))throw new Error(`_headers sem ${name} no bloco /*`);
}

export function latestCheckedAt(audits:{checkedAt?:unknown}[]):string{
  const times=audits.map(a=>a.checkedAt).filter((t):t is string=>typeof t==='string'&&!Number.isNaN(Date.parse(t))).map(t=>new Date(t).toISOString()).sort();
  if(!times.length)throw new Error('Nenhuma auditoria de entrada com checkedAt válido');
  return times[times.length-1];
}
