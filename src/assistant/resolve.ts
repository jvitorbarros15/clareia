import type {Person,Publication} from './data.ts';
import {NAME_STOPWORDS,QUESTION_WORDS,levenshtein,normalize} from './vocabulary.ts';

export const MAX_CANDIDATES=8;

export type Resolution<T>={status:'one';match:T}|{status:'many';candidates:T[]}|{status:'none';total:number};

const tokenCache=new WeakMap<Publication,{tokens:Map<string,Person[]>;byPerson:Map<number,Set<string>>}>();
const nameTokens=(name:string)=>normalize(name).split(' ').filter(t=>t.length>=3&&!NAME_STOPWORDS.has(t));

function index(pub:Publication){
  let hit=tokenCache.get(pub);
  if(!hit){
    const tokens=new Map<string,Person[]>(),byPerson=new Map<number,Set<string>>();
    for(const p of pub.people){
      const set=new Set(nameTokens(p.name));byPerson.set(p.id,set);
      for(const t of set)tokens.set(t,[...(tokens.get(t)??[]),p]);
    }
    hit={tokens,byPerson};tokenCache.set(pub,hit);
  }
  return hit;
}

const byName=(a:Person,b:Person)=>a.name.localeCompare(b.name,'pt-BR');

function best(pub:Publication,words:string[],uf:string|null):Person[]{
  const {tokens}=index(pub),scores=new Map<number,number>();
  for(const w of new Set(words))for(const p of tokens.get(w)??[])scores.set(p.id,(scores.get(p.id)??0)+1);
  let candidates=pub.people.filter(p=>scores.has(p.id));
  const exactFull=candidates.filter(p=>normalize(p.name)===words.join(' '));
  if(exactFull.length)candidates=exactFull;
  else{
    const top=Math.max(0,...candidates.map(p=>scores.get(p.id)!));
    candidates=candidates.filter(p=>scores.get(p.id)===top);
  }
  if(uf&&candidates.length>1){const same=candidates.filter(p=>p.uf===uf);if(same.length)candidates=same;}
  return candidates.sort(byName);
}

export function resolveDeputy(pub:Publication,query:string,uf:string|null=null):Resolution<Person>{
  const words=normalize(query).split(' ').filter(w=>w.length>=3&&!NAME_STOPWORDS.has(w));
  if(!words.length)return {status:'none',total:pub.people.length};
  const candidates=best(pub,words,uf);
  if(!candidates.length)return {status:'none',total:pub.people.length};
  if(candidates.length===1)return {status:'one',match:candidates[0]};
  if(candidates.length>MAX_CANDIDATES)return {status:'none',total:pub.people.length};
  return {status:'many',candidates};
}

export interface Mention{text:string;status:'one'|'many'|'fuzzy'|'mismatch';candidates:Person[]}

export function findMentions(pub:Publication,question:string,uf:string|null=null):Mention[]{
  const {tokens}=index(pub);
  const rawWords=question.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const words=rawWords.map(w=>normalize(w)),mentions:Mention[]=[];
  const isNameWord=(w:string)=>w.length>=3&&tokens.has(w)&&!QUESTION_WORDS.has(w);
  let i=0;
  while(i<words.length){
    if(!isNameWord(words[i])){i++;continue;}
    let j=i;while(j<words.length&&isNameWord(words[j]))j++;
    const segment=words.slice(i,j),candidates=best(pub,segment,uf);
    const adjacent=[i-1,j].filter(k=>k>0&&k<words.length);
    const stray=adjacent.some(k=>/^\p{Lu}/u.test(rawWords[k])&&words[k].length>=3&&!tokens.has(words[k])&&!QUESTION_WORDS.has(words[k])&&!NAME_STOPWORDS.has(words[k])&&!/^\d/.test(words[k]));
    const text=rawWords.slice(i,j).join(' ');
    if(candidates.length===1)mentions.push({text,status:stray?'mismatch':'one',candidates});
    else mentions.push({text,status:'many',candidates:candidates.length>MAX_CANDIDATES?candidates.slice(0,0):candidates});
    i=j;
  }
  if(!mentions.length){
    for(const w of words){
      if(w.length<6||QUESTION_WORDS.has(w)||tokens.has(w)||/\d/.test(w))continue;
      const near=pub.people.filter(p=>nameTokens(p.name).some(t=>t.length>=6&&levenshtein(t,w)===1));
      if(near.length&&near.length<=MAX_CANDIDATES){mentions.push({text:w,status:'fuzzy',candidates:near.sort(byName)});break;}
    }
  }
  return mentions;
}

const supplierCache=new WeakMap<Publication,string[]>();
export function supplierNames(pub:Publication):string[]{
  let names=supplierCache.get(pub);
  if(!names){names=[...new Set(pub.people.flatMap(p=>p.cells.map(c=>c.supplier)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));supplierCache.set(pub,names);}
  return names;
}

export function resolveSupplier(pub:Publication,query:string):Resolution<string>{
  const q=normalize(query);
  if(q.length<3)return {status:'none',total:supplierNames(pub).length};
  const all=supplierNames(pub),exact=all.filter(s=>normalize(s)===q);
  if(exact.length===1)return {status:'one',match:exact[0]};
  const found=all.filter(s=>normalize(s).includes(q));
  if(found.length===1)return {status:'one',match:found[0]};
  if(!found.length||found.length>MAX_CANDIDATES)return found.length?{status:'many',candidates:found.slice(0,MAX_CANDIDATES)}:{status:'none',total:all.length};
  return {status:'many',candidates:found};
}
