import fs from 'node:fs/promises';
const base='https://dadosabertos.camara.leg.br/api/v2';
await fs.mkdir('data/raw/probe',{recursive:true});
for (const [name,url] of [['contract',base+'/api-docs'],['people',base+'/deputados?idLegislatura=57&itens=3&ordem=ASC&ordenarPor=id']]) {
  const r=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw new Error(String(r.status));
  const text=await r.text();await fs.writeFile(`data/raw/probe/${name}.json`,text);
  const j=JSON.parse(text);
  if(name==='people')console.log(j.dados.map(p=>({id:p.id,nome:p.nome,uf:p.siglaUf})));
  else {const e=j.paths['/deputados/{id}/despesas'].get;console.log(JSON.stringify({description:e.description,parameters:e.parameters.map(p=>({name:p.name,description:p.description})),schemas:Object.fromEntries(Object.entries(j.components.schemas).filter(([k])=>/Despesa/.test(k)))},null,2));}
}
