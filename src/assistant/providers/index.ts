import {anthropicProvider} from './anthropic.ts';
import {openaiProvider} from './openai.ts';
import type {Provider} from './types.ts';

export type ProviderFamily='anthropic'|'openai'|'local';
export type ProviderLookup={status:'ready';provider:Provider}|{status:'skipped';reason:string};

export function createProvider(family:ProviderFamily,model:string,env:Record<string,string|undefined>=process.env):ProviderLookup{
  if(family==='anthropic'){
    if(!env.ANTHROPIC_API_KEY)return {status:'skipped',reason:'ANTHROPIC_API_KEY não definida'};
    return {status:'ready',provider:anthropicProvider(model)};
  }
  if(family==='openai'){
    if(!env.OPENAI_API_KEY)return {status:'skipped',reason:'OPENAI_API_KEY não definida'};
    return {status:'ready',provider:openaiProvider({family:'openai',model,baseUrl:env.OPENAI_BASE_URL??'https://api.openai.com/v1',apiKey:env.OPENAI_API_KEY})};
  }
  if(!env.LUME_LOCAL_BASE_URL)return {status:'skipped',reason:'LUME_LOCAL_BASE_URL não definida'};
  return {status:'ready',provider:openaiProvider({family:'local',model,baseUrl:env.LUME_LOCAL_BASE_URL,apiKey:env.LUME_LOCAL_API_KEY,timeoutMs:180_000})};
}
