import type {Completion,CompletionRequest,Message,Provider} from './types.ts';

type Fetch=typeof fetch;

function toMessages(system:string,messages:Message[]):unknown[]{
  const out:unknown[]=[{role:'system',content:system}];
  for(const m of messages){
    if(m.role==='user')out.push({role:'user',content:m.content});
    else if(m.role==='assistant')out.push({role:'assistant',content:m.text,...(m.toolCalls.length?{tool_calls:m.toolCalls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{})});
    else for(const r of m.results)out.push({role:'tool',tool_call_id:r.id,content:r.content});
  }
  return out;
}

function parseArgs(raw:unknown):unknown{
  if(typeof raw!=='string')return raw;
  try{return JSON.parse(raw);}catch{return null;}
}

export interface OpenAIOptions{family:'openai'|'local';model:string;baseUrl:string;apiKey?:string;fetchImpl?:Fetch;timeoutMs?:number}

export function openaiProvider(o:OpenAIOptions):Provider{
  const doFetch=o.fetchImpl??fetch,url=`${o.baseUrl.replace(/\/+$/,'')}/chat/completions`,strict=o.family==='openai';
  return {
    family:o.family,model:o.model,
    async complete(req:CompletionRequest):Promise<Completion>{
      const body={
        model:o.model,messages:toMessages(req.system,req.messages),
        tools:req.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters,...(strict?{strict:true}:{})}})),
        tool_choice:'auto',
        ...(strict?{max_completion_tokens:req.maxTokens}:{max_tokens:req.maxTokens})
      };
      const response=await doFetch(url,{method:'POST',headers:{'content-type':'application/json',...(o.apiKey?{authorization:`Bearer ${o.apiKey}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(o.timeoutMs??60_000)});
      if(!response.ok)throw new Error(`${o.family} provider returned HTTP ${response.status}`);
      const json=await response.json() as any,choice=json.choices?.[0];
      if(!choice)throw new Error(`${o.family} provider returned no choice`);
      const toolCalls=(choice.message?.tool_calls??[]).map((c:any)=>({id:String(c.id),name:String(c.function?.name),args:parseArgs(c.function?.arguments)}));
      const finish=choice.finish_reason;
      const stop=toolCalls.length?'tool_use':finish==='stop'?'end':finish==='length'?'max_tokens':finish==='content_filter'?'refusal':'other';
      const u=json.usage??{},cached=u.prompt_tokens_details?.cached_tokens??0;
      return {text:choice.message?.content??null,toolCalls,stop,usage:{inputTokens:Math.max(0,(u.prompt_tokens??0)-cached),outputTokens:u.completion_tokens??0,cacheReadTokens:cached,cacheWriteTokens:0}};
    }
  };
}
