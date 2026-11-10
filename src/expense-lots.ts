import {canonical,hash} from './model.ts';
import type {DiscoveryReport} from './people-discovery.ts';
import type {TemporalReport} from './people-temporal.ts';
import type {CrosscheckReport} from './people-legacy.ts';

export const LOT_SIZE=50;

// Everyone with a month of exercise in the year, plus everyone the annual expense file names:
// an expense filed for someone reported outside exercise must be collected and held, never missed.
export function lotUniverse(temporal:TemporalReport,discovery:DiscoveryReport,year:number):number[]{
  const annual=discovery.annuals.find(a=>a.year===year);if(!annual)throw Error(`Índice anual de ${year} ausente`);
  const known=new Set(temporal.people.map(p=>p.id)),ids=new Set<number>();
  for(const p of temporal.people)if(p.months.some(m=>m.year===year&&m.exercise!=='outside'))ids.add(p.id);
  for(const p of annual.people){if(!known.has(p.id))throw Error('Pessoa do arquivo anual fora do histórico');ids.add(p.id);}
  return [...ids].sort((a,b)=>a-b);
}
export function selectLot(universe:number[],lot:number,size=LOT_SIZE):number[]{
  if(!Number.isInteger(lot)||lot<0||!Number.isInteger(size)||size<1||size>100)throw Error('Lote inválido');
  const ids=universe.slice(lot*size,(lot+1)*size);if(!ids.length)throw Error('Lote vazio');
  return ids;
}
// Shaped like the intermediate proposal, so the collector and the independent audit read it unchanged.
export function lotProposal(temporal:TemporalReport,cross:CrosscheckReport,discovery:DiscoveryReport,year:number,lot:number,size=LOT_SIZE){
  const universe=lotUniverse(temporal,discovery,year);
  return {schema:'clareia.expense-lot.v1' as const,year,months:[1,2,3,4,5,6,7,8,9,10,11,12],lot,lotSize:size,lots:Math.ceil(universe.length/size),universeSize:universe.length,universeSha256:hash(canonical(universe)),people:selectLot(universe,lot,size).map(id=>({id})),temporalSha256:hash(canonical(temporal)),crosscheckSha256:hash(canonical(cross))};
}
