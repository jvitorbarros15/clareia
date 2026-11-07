import {pathToFileURL} from 'node:url';

const CAMARA='https://dadosabertos.camara.leg.br';
export const SOURCES=[
  {name:'camara-api',url:`${CAMARA}/api/v2/deputados/204534/despesas?ano=2025&mes=1&idLegislatura=57&itens=1`},
  {name:'camara-ceap',url:'https://www.camara.leg.br/cotas/Ano-2025.csv.zip'},
  {name:'camara-votacoes',url:`${CAMARA}/arquivos/votacoes/csv/votacoes-2025.csv`},
  {name:'camara-proposicoes',url:`${CAMARA}/arquivos/proposicoes/csv/proposicoes-2025.csv`},
  {name:'camara-foto',url:'https://www.camara.leg.br/internet/deputado/bandep/160976.jpg'},
  {name:'tse-candidatos',url:'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip'},
  {name:'cgu-emendas',url:'https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO'}
];
export function classify(status,bytes){
  if(status>=200&&status<300&&bytes>0)return 'ok';
  return [401,403,451].includes(status)?'blocked':'unstable';
}
async function attempt(url){
  try{
    const response=await fetch(url,{headers:{'User-Agent':'clareia-source-probe',Range:'bytes=0-1023'},signal:AbortSignal.timeout(45000)});
    const reader=response.body?.getReader();
    const first=reader?await reader.read():{value:undefined};
    await reader?.cancel().catch(()=>{});
    return {status:response.status,bytes:first.value?.length||0};
  }catch(error){return {status:0,bytes:0,error:String(error.cause?.code||error.name)};}
}
async function probe(source){
  let last;
  for(let i=0;i<3;i++){
    last=await attempt(source.url);
    if(classify(last.status,last.bytes)!=='unstable')break;
    await new Promise(done=>setTimeout(done,5000*(i+1)));
  }
  return {name:source.name,result:classify(last.status,last.bytes),...last};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const results=[];
  for(const source of SOURCES){const r=await probe(source);results.push(r);console.log(JSON.stringify(r));}
  if(results.some(r=>r.result!=='ok'))process.exitCode=1;
}
