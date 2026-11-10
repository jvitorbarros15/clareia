import Anthropic from '@anthropic-ai/sdk';
import type {Completion,CompletionRequest,Message,Provider} from './types.ts';

type Client=Pick<Anthropic,'messages'>;

const toMessages=(messages:Message[]):Anthropic.MessageParam[]=>messages.map((m):Anthropic.MessageParam=>{
  if(m.role==='user')return {role:'user',content:m.content};
  if(m.role==='assistant')return {role:'assistant',content:[...(m.text?[{type:'text' as const,text:m.text}]:[]),...m.toolCalls.map(c=>({type:'tool_use' as const,id:c.id,name:c.name,input:c.args as Record<string,unknown>}))]};
  return {role:'user',content:m.results.map(r=>({type:'tool_result' as const,tool_use_id:r.id,content:r.content}))};
});

export function anthropicProvider(model:string,client:Client=new Anthropic({timeout:20_000,maxRetries:1})):Provider{
  return {
    family:'anthropic',model,
    async complete(req:CompletionRequest):Promise<Completion>{
      const response=await client.messages.create({
        model,max_tokens:req.maxTokens,
        system:[{type:'text',text:req.system,cache_control:{type:'ephemeral'}}],
        tools:req.tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters as Anthropic.Tool.InputSchema,strict:true})),
        tool_choice:{type:'auto'},
        output_config:{effort:'low'},
        messages:toMessages(req.messages)
      });
      const text=response.content.flatMap(b=>b.type==='text'?[b.text]:[]).join('')||null;
      const toolCalls=response.content.flatMap(b=>b.type==='tool_use'?[{id:b.id,name:b.name,args:b.input}]:[]);
      const stop=response.stop_reason==='tool_use'?'tool_use':response.stop_reason==='end_turn'?'end':response.stop_reason==='refusal'?'refusal':response.stop_reason==='max_tokens'?'max_tokens':'other';
      const u=response.usage;
      return {text,toolCalls,stop,usage:{inputTokens:u.input_tokens,outputTokens:u.output_tokens,cacheReadTokens:u.cache_read_input_tokens??0,cacheWriteTokens:u.cache_creation_input_tokens??0}};
    }
  };
}
