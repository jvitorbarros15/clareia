import {MONTH_ABBR,MONTH_NAMES} from './format.ts';

export const normalize=(text:string):string=>text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();

export interface CategoryGroup{key:string;label:string;terms:string[];match:(official:string)=>boolean;blockers?:string[]}

const exact=(name:string)=>(official:string)=>official===name;
export const CATEGORY_GROUPS:CategoryGroup[]=[
  {key:'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.',label:'Divulgação do mandato',terms:['divulga','propaganda','publicidade'],match:exact('DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.')},
  {key:'PASSAGENS AÉREAS',label:'Passagens aéreas',terms:['passage','aerea','aereo','voo','aviao'],match:o=>o.startsWith('PASSAGEM AÉREA'),blockers:['terrestr','rodoviar','onibus','fluvial','maritim']},
  {key:'PASSAGENS TERRESTRES, MARÍTIMAS OU FLUVIAIS',label:'Passagens terrestres, marítimas ou fluviais',terms:['terrestr','rodoviar','onibus','fluvial','maritim'],match:exact('PASSAGENS TERRESTRES, MARÍTIMAS OU FLUVIAIS')},
  {key:'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES',label:'Locação de veículos',terms:['locac','fretamento','veiculo','carro'],match:exact('LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES')},
  {key:'COMBUSTÍVEIS E LUBRIFICANTES.',label:'Combustíveis',terms:['combust','lubrific','gasolina','diesel','etanol'],match:exact('COMBUSTÍVEIS E LUBRIFICANTES.')},
  {key:'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR',label:'Escritório de apoio',terms:['escritorio'],match:exact('MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR')},
  {key:'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO',label:'Táxi, pedágio e estacionamento',terms:['taxi','pedagio','estacionamento','uber'],match:exact('SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO')},
  {key:'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.',label:'Hospedagem (fora do DF)',terms:['hospedag','hotel'],match:exact('HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.')},
  {key:'TELEFONIA',label:'Telefonia',terms:['telefon','celular'],match:exact('TELEFONIA')},
  {key:'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA',label:'Auxílio-moradia (complementação)',terms:['auxilio','moradia'],match:exact('COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA')},
  {key:'FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR',label:'Alimentação do parlamentar',terms:['alimenta','refeic','restaurante'],match:exact('FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR')},
  {key:'SERVIÇO DE SEGURANÇA PRESTADO POR EMPRESA ESPECIALIZADA.',label:'Segurança por empresa especializada',terms:['seguranca'],match:exact('SERVIÇO DE SEGURANÇA PRESTADO POR EMPRESA ESPECIALIZADA.')},
  {key:'SERVIÇOS POSTAIS',label:'Serviços postais',terms:['postal','postais','correios'],match:exact('SERVIÇOS POSTAIS')},
  {key:'AQUISIÇÃO DE TOKENS E CERTIFICADOS DIGITAIS',label:'Tokens e certificados digitais',terms:['token','tokens','certificado'],match:exact('AQUISIÇÃO DE TOKENS E CERTIFICADOS DIGITAIS')},
  {key:'ASSINATURA DE PUBLICAÇÕES',label:'Assinatura de publicações',terms:['assinatura'],match:exact('ASSINATURA DE PUBLICAÇÕES')}
];

export interface ResolvedCategory{key:string;label:string;officials:string[]}

export function categoryLabel(official:string):string{
  const group=CATEGORY_GROUPS.find(g=>g.key===official);
  if(group)return group.label;
  const text=official.replace(/\s+,/g,',').replace(/\.$/,'').trim().toLowerCase();
  return text.charAt(0).toUpperCase()+text.slice(1);
}

export function categoryByKey(categories:string[],key:string):ResolvedCategory|null{
  const group=CATEGORY_GROUPS.find(g=>g.key===key);
  if(group){const officials=categories.filter(group.match);return officials.length?{key:group.key,label:group.label,officials}:null;}
  return categories.includes(key)?{key,label:categoryLabel(key),officials:[key]}:null;
}

export function categoryKeys(categories:string[]):string[]{
  const keys=new Set<string>();
  for(const group of CATEGORY_GROUPS)if(categories.some(group.match))keys.add(group.key);
  for(const c of categories)if(!CATEGORY_GROUPS.some(g=>g.match(c)))keys.add(c);
  return [...keys];
}

export type CategoryMatch={status:'none'}|{status:'one';category:ResolvedCategory}|{status:'many';candidates:ResolvedCategory[]}|{status:'absent';groupLabel:string};

export function matchCategory(categories:string[],question:string):CategoryMatch{
  const q=normalize(question),hits:CategoryGroup[]=[];
  for(const group of CATEGORY_GROUPS){
    if(group.blockers?.some(b=>new RegExp(`\\b${b}`).test(q)))continue;
    if(group.terms.some(t=>new RegExp(`\\b${t}`).test(q)))hits.push(group);
  }
  if(!hits.length)return {status:'none'};
  const found=hits.flatMap(g=>{const c=categoryByKey(categories,g.key);return c?[c]:[];});
  if(!found.length)return {status:'absent',groupLabel:hits[0].label};
  return found.length===1?{status:'one',category:found[0]}:{status:'many',candidates:found};
}

export const UF_NAMES:Record<string,{name:string;terms:string[]}>={
  AC:{name:'Acre',terms:['acre','acreano']},AL:{name:'Alagoas',terms:['alagoas','alagoano']},AP:{name:'Amapá',terms:['amapa','amapaense']},
  AM:{name:'Amazonas',terms:['amazonas','amazonense']},BA:{name:'Bahia',terms:['bahia','baiano']},CE:{name:'Ceará',terms:['ceara','cearense']},
  DF:{name:'Distrito Federal',terms:['distrito federal','brasiliense']},ES:{name:'Espírito Santo',terms:['espirito santo','capixaba']},
  GO:{name:'Goiás',terms:['goias','goiano']},MA:{name:'Maranhão',terms:['maranhao','maranhense']},MT:{name:'Mato Grosso',terms:['mato grosso','mato grossense']},
  MS:{name:'Mato Grosso do Sul',terms:['mato grosso do sul','sul mato grossense']},MG:{name:'Minas Gerais',terms:['minas gerais','mineiro']},
  PA:{name:'Pará',terms:['para','paraense']},PB:{name:'Paraíba',terms:['paraiba','paraibano']},PR:{name:'Paraná',terms:['parana','paranaense']},
  PE:{name:'Pernambuco',terms:['pernambuco','pernambucano']},PI:{name:'Piauí',terms:['piaui','piauiense']},RJ:{name:'Rio de Janeiro',terms:['rio de janeiro','fluminense','carioca']},
  RN:{name:'Rio Grande do Norte',terms:['rio grande do norte','potiguar']},RS:{name:'Rio Grande do Sul',terms:['rio grande do sul','gaucho']},
  RO:{name:'Rondônia',terms:['rondonia','rondoniense']},RR:{name:'Roraima',terms:['roraima','roraimense']},SC:{name:'Santa Catarina',terms:['santa catarina','catarinense']},
  SP:{name:'São Paulo',terms:['sao paulo','paulista']},SE:{name:'Sergipe',terms:['sergipe','sergipano']},TO:{name:'Tocantins',terms:['tocantins','tocantinense']}
};

export function matchUF(question:string):string|null{
  const found=new Set<string>();
  for(const m of question.matchAll(/(?<![\p{L}\d])([A-Z]{2})(?![\p{L}\d])/gu))if(UF_NAMES[m[1]])found.add(m[1]);
  let q=` ${normalize(question)} `;
  const entries=Object.entries(UF_NAMES).flatMap(([uf,v])=>v.terms.map(t=>[uf,t] as const)).sort((a,b)=>b[1].length-a[1].length);
  for(const [uf,term] of entries){
    if(term==='para'&&!/\b(do|no|de|em|pelo|pelos|da|na)\s+para\b/.test(q))continue;
    for(const form of [term,term+'s'])if(q.includes(` ${form} `)){found.add(uf);q=q.replace(` ${form} `,' ');break;}
  }
  return found.size===1?[...found][0]:null;
}

export interface MonthRange{from:number;to:number}

const monthIndex=(word:string):number|null=>{
  const w=normalize(word);
  const full=MONTH_NAMES.findIndex(n=>normalize(n)===w);
  if(full>=0)return full+1;
  const abbr=MONTH_ABBR.findIndex(a=>normalize(a)===w);
  return abbr>=0?abbr+1:null;
};

export function parsePeriod(question:string):MonthRange|null{
  const q=normalize(question);
  const ordinals:Record<string,number>={'1':1,primeiro:1,'2':2,segundo:2,'3':3,terceiro:3,'4':4,quarto:4};
  const tri=/\b(1|2|3|4|primeiro|segundo|terceiro|quarto)\s*(?:o\s+)?trimestre\b/.exec(q);
  if(tri){const n=ordinals[tri[1]];return {from:(n-1)*3+1,to:n*3};}
  const sem=/\b(1|2|primeiro|segundo)\s*(?:o\s+)?semestre\b/.exec(q);
  if(sem){const n=ordinals[sem[1]];return {from:(n-1)*6+1,to:n*6};}
  const alt=[...new Set([...MONTH_NAMES,...MONTH_ABBR].map(normalize))].sort((a,b)=>b.length-a.length).join('|');
  const range=new RegExp(`\\b(?:de\\s+)?(${alt})\\s+(?:a|ate|ao)\\s+(${alt})\\b`).exec(q);
  if(range){const a=monthIndex(range[1]),b=monthIndex(range[2]);if(a&&b&&a<=b)return {from:a,to:b};}
  const until=new RegExp(`\\bate\\s+(?:o\\s+mes\\s+de\\s+)?(${alt})\\b`).exec(q);
  if(until){const b=monthIndex(until[1]);if(b)return {from:1,to:b};}
  const since=new RegExp(`\\bdesde\\s+(${alt})\\b`).exec(q);
  if(since){const a=monthIndex(since[1]);if(a)return {from:a,to:12};}
  const fullAlt=[...new Set(MONTH_NAMES.map(normalize))].join('|');
  const single=new RegExp(`\\b(${fullAlt})\\b`).exec(q);
  if(single){const a=monthIndex(single[1]);if(a)return {from:a,to:a};}
  return null;
}

export const NAME_STOPWORDS=new Set(['de','da','do','dos','das','e','di','du','van','von']);
export const QUESTION_WORDS=new Set([
  'quem','quanto','quantos','quantas','qual','quais','como','que','mais','menos','gastou','gastaram','gasto','gastos','gastar','despesa','despesas','cota','parlamentar',
  'deputado','deputada','deputados','deputadas','por','com','sem','entre','compare','comparar','comparacao','versus','sobre','mes','mensal','media','total','ano','periodo',
  'maior','menor','maiores','menores','top','lista','listar','mostre','mostrar','fornecedor','fornecedores','projeto','projetos','votou','votos','voto','votacao','votacoes',
  'passagens','passagem','combustivel','combustiveis','escritorio','telefonia','hospedagem','divulgacao','locacao','taxi','pedagio','estado','estados','partido','categoria',
  'categorias','registros','registro','nota','notas','tudo','todos','todas','foi','foram','tem','teve','tiveram','fez','fizeram','apresentou','apresentaram','autoria','pelo','pela',
  'dele','dela','nos','nas','para','ser','sao','era','uma','uns','umas','esse','essa','este','esta','isso','aquele','quando','onde','porque','vez','vezes','dia','dias',
  'janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro','trimestre','semestre','ate','desde','ver','veja','dizer','diga'
]);

export const levenshtein=(a:string,b:string):number=>{
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let diag=prev[0];prev[0]=i;
    for(let j=1;j<=b.length;j++){const tmp=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,diag+(a[i-1]===b[j-1]?0:1));diag=tmp;}
  }
  return prev[b.length];
};
