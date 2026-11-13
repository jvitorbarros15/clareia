import type {Usage} from './providers/types.ts';

export interface Price{family:'anthropic'|'openai'|'local';model:string;inputPerM:number;outputPerM:number;cacheReadPerM:number;cacheWritePerM:number;checkedAt:string;source:string}

const ANTHROPIC_SOURCE='claude-api skill model table (cached 2026-10-06); confirm in the Anthropic Console before relying on it';

export const PRICES:Price[]=[
  {family:'anthropic',model:'claude-haiku-5-5',inputPerM:0.10,outputPerM:0.50,cacheReadPerM:0.01,cacheWritePerM:0.125,checkedAt:'2026-10-06',source:ANTHROPIC_SOURCE},
  {family:'anthropic',model:'claude-sonnet-5-5',inputPerM:2.00,outputPerM:10.00,cacheReadPerM:0.20,cacheWritePerM:2.50,checkedAt:'2026-10-06',source:ANTHROPIC_SOURCE},
  {family:'anthropic',model:'claude-opus-5-5',inputPerM:4.00,outputPerM:20.00,cacheReadPerM:0.20,cacheWritePerM:5.00,checkedAt:'2026-10-06',source:ANTHROPIC_SOURCE}
];

export function priceOf(family:string,model:string):Price|null{
  if(family==='local')return {family:'local',model,inputPerM:0,outputPerM:0,cacheReadPerM:0,cacheWritePerM:0,checkedAt:'n/a',source:'local model, no API charge'};
  return PRICES.find(p=>p.family===family&&p.model===model)??null;
}

export function costUsd(family:string,model:string,usage:Usage):number|null{
  const p=priceOf(family,model);
  if(!p)return null;
  return (usage.inputTokens*p.inputPerM+usage.outputTokens*p.outputPerM+usage.cacheReadTokens*p.cacheReadPerM+usage.cacheWriteTokens*p.cacheWritePerM)/1_000_000;
}
