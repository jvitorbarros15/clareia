import {zipSync,strToU8} from 'fflate';
import {hash} from './model.ts';
import type {Expense} from './model.ts';
import {csv} from './view.ts';

export const ZIP_MAX_BYTES=25*1024*1024;
export type OpenFile={name:string;path:string;bytes:number;sha256:string;records:number|null;kind:'month'|'zip'|'json'};
export type Quirks={records:number;noDate:number;monthDiffers:number;unverifiedSupplier:number;possibleDuplicates:number;heldMonths:number;heldPeople:number;negative:number;withheldNames:number;individualSuppliers:number};
export type OpenData={schema:'clareia.open-data.v1';year:number;publishedAt:string;collectedAt:string;files:OpenFile[];quirks:Quirks};
export type MonthTable={month:number;name:string;text:string;records:number};

// Same writer as each deputy's despesas.csv, so the columns and the header are identical.
export function monthlyTables(records:Expense[]):MonthTable[]{
  const by=new Map<string,Expense[]>();
  for(const r of records){const key=`${r.year}-${String(r.month).padStart(2,'0')}`,list=by.get(key);if(list)list.push(r);else by.set(key,[r]);}
  return [...by].sort(([a],[b])=>a<b?-1:1).map(([key,rows])=>({month:rows[0].month,name:`despesas-${key}.csv`,text:csv(rows),records:rows.length}));
}
export function zipOf(tables:MonthTable[],when:string):Uint8Array|null{
  const mtime=new Date(when);
  const zip=zipSync(Object.fromEntries(tables.map(t=>[t.name,[strToU8(t.text),{level:6,mtime}]])));
  return zip.length<=ZIP_MAX_BYTES?zip:null;
}
export const fileEntry=(name:string,path:string,bytes:Uint8Array|string,kind:OpenFile['kind'],records:number|null=null):OpenFile=>({name,path,bytes:typeof bytes==='string'?Buffer.byteLength(bytes):bytes.length,sha256:hash(bytes),records,kind});
export function quirkCounts(records:Expense[],held:{personId:number}[],labels:{withheld:string;individual:string}):Quirks{
  const q:Quirks={records:records.length,noDate:0,monthDiffers:0,unverifiedSupplier:0,possibleDuplicates:0,heldMonths:held.length,heldPeople:new Set(held.map(h=>h.personId)).size,negative:0,withheldNames:0,individualSuppliers:0};
  for(const r of records){
    if(!r.date)q.noDate++;else if(Number(r.date.slice(5,7))!==r.month)q.monthDiffers++;
    if(!r.supplierVerified)q.unverifiedSupplier++;
    if(r.duplicateFlag==='possible')q.possibleDuplicates++;
    if(r.cents<0)q.negative++;
    if(r.supplier===labels.withheld)q.withheldNames++;else if(r.supplier===labels.individual)q.individualSuppliers++;
  }
  return q;
}
