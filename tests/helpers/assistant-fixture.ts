import type {DataSource,ExpenseRow} from '../../src/assistant/data.ts';

export const CATEGORIES=['COMBUSTÍVEIS E LUBRIFICANTES.','DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.','PASSAGEM AÉREA - RPA','PASSAGEM AÉREA - SIGEPA','TELEFONIA'];
export const SUPPLIERS=['Agência Delta','Cia Aérea Alfa','Fornecedor pessoa física','Posto Beta','Telecom Gama'];

export interface FixturePerson{id:number;name:string;uf:string|null;party:string|null;outside:number[];held:number}
export const PEOPLE:FixturePerson[]=[
  {id:101,name:'Tabata Amaral',uf:'SP',party:'PSB',outside:[],held:0},
  {id:102,name:'Tiririca',uf:'SP',party:'PSD',outside:[],held:0},
  {id:103,name:'João Silva',uf:'MG',party:'PT',outside:[1,2],held:0},
  {id:104,name:'João Souza',uf:'GO',party:'PL',outside:[],held:0},
  {id:105,name:'Maria Souza',uf:'MG',party:'PP',outside:[],held:0},
  {id:106,name:'Ana Pereira',uf:'RJ',party:'MDB',outside:[1,2,3,4,5,6,7,8,9,10,11,12],held:0},
  {id:107,name:'Carlos Estorno',uf:'BA',party:'PDT',outside:[],held:0},
  {id:108,name:'Dimas Retido',uf:'MG',party:'PP',outside:[],held:2}
];

export interface Fixture{source:DataSource;records:Map<number,ExpenseRow[]>;activity:Map<number,any>;files:Map<string,unknown>}

function lcg(seed:number){let s=seed;return ()=>{s=(s*1664525+1013904223)%4294967296;return s/4294967296;};}

export function makeFixture():Fixture{
  const base='data/fixture',year=2025,months=Array.from({length:12},(_,i)=>i+1);
  const records=new Map<number,ExpenseRow[]>(),activity=new Map<number,any>();
  const cellsByPerson:Record<string,number[][]>={};
  const summaryPeople:any[]=[];
  PEOPLE.forEach((p,pi)=>{
    const rand=lcg(1000+pi),rows:ExpenseRow[]=[];
    for(const m of months){
      if(p.outside.includes(m))continue;
      const n=p.id===107?(m===3?1:0):Math.floor(rand()*4);
      for(let k=0;k<n;k++){
        const category=CATEGORIES[Math.floor(rand()*CATEGORIES.length)],supplier=SUPPLIERS[Math.floor(rand()*SUPPLIERS.length)];
        const cents=p.id===107?-50000:Math.floor(rand()*900000)+1000;
        rows.push({id:`r${p.id}-${m}-${k}`,date:`${year}-${String(m).padStart(2,'0')}-1${k}T00:00:00`,month:m,cents,category,supplier,documentId:`${p.id}${m}${k}`,receipt:`https://www.camara.leg.br/cota-parlamentar/documentos/publ/${p.id}/${year}/${m}${k}.pdf`});
      }
    }
    records.set(p.id,rows);
    const cell=new Map<string,[number,number,number,number,number]>();
    for(const r of rows){
      const key=`${r.month}|${r.category}|${r.supplier}`,c=cell.get(key)??[r.month,CATEGORIES.indexOf(r.category),SUPPLIERS.indexOf(r.supplier),0,0];
      c[3]+=r.cents;c[4]++;cell.set(key,c);
    }
    cellsByPerson[String(p.id)]=[...cell.values()];
    const monthRows=months.map(m=>{
      const own=rows.filter(r=>r.month===m),out=p.outside.includes(m);
      return {month:m,cents:own.reduce((s,r)=>s+r.cents,0),records:own.length,exercise:out?'outside':'full',partyStatus:out?'not-applicable':'single',party:out?null:p.party,partyValues:[],ufStatus:'single',uf:out?null:p.uf,review:false,partialScope:false};
    });
    const bills=Array.from({length:3+pi},(_,i)=>({id:9000+pi*100+i,type:['PL','PLP','PEC'][i%3],number:100+i,year:2025,summary:`Dispõe sobre assunto ${i} da pauta`,situation:'Em tramitação',situationAt:'2025-05-01T00:00:00',norm:i===0&&pi%2===0?{kind:'Lei Ordinária',year:2025,number:'15000'}:null,proponent:i%3!==2,joint:i%3===1}));
    const cats=['Sim','Não','Abstenção'];
    const votes=Array.from({length:10+pi},(_,i)=>({id:`v${p.id}-${i}`,date:`2025-0${1+(i%9)}-1${i%9}`,organ:'PLEN',kind:['merito','requerimento','destaque','outro'][i%4],description:`Votação número ${i}`,matters:[`PL ${200+i}/2025`],category:cats[(i+pi)%3]}));
    activity.set(p.id,{bills,votes});
    const voteCounts:Record<string,number>={};for(const v of votes)voteCounts[v.category]=(voteCounts[v.category]??0)+1;
    summaryPeople.push({id:p.id,name:p.name,photo:null,cents:rows.reduce((s,r)=>s+r.cents,0),records:rows.length,months:monthRows,categories:[],
      bills:{proposed:bills.filter(b=>b.proponent).length,joint:bills.filter(b=>b.proponent&&b.joint).length,coauthored:bills.filter(b=>!b.proponent).length,norms:bills.filter(b=>b.proponent&&b.norm).length},
      votes:voteCounts,votesHeld:pi%2});
  });
  const files=new Map<string,unknown>();
  files.set('manifest.json',{base});
  files.set(`${base}/index.json`,{scope:{ids:PEOPLE.map(p=>p.id),year,months,legislature:57},people:PEOPLE.map(p=>({id:p.id,uf:p.uf,name:p.name,party:p.party})),validation:{heldMonths:Object.fromEntries(PEOPLE.filter(p=>p.held).map(p=>[String(p.id),p.held]))}});
  files.set(`${base}/summary.json`,{publicationId:'pub-fixture',coverageId:'cov',billsId:'bills',votesId:'votes',billsYears:[2023,2024,2025],votesYears:[2023,2024,2025],scope:{year,months},categories:CATEGORIES,people:summaryPeople});
  files.set(`${base}/fornecedores.json`,{publicationId:'pub-fixture',categories:CATEGORIES,suppliers:SUPPLIERS,people:cellsByPerson});
  for(const p of PEOPLE){files.set(`${base}/atividade/${p.id}.json`,activity.get(p.id));files.set(`${base}/deputados/${p.id}/despesas.json`,records.get(p.id));}
  const source:DataSource={async json<T>(path:string){if(!files.has(path))throw new Error('missing '+path);return files.get(path) as T;}};
  return {source,records,activity,files};
}
