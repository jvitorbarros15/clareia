import type {Completion,CompletionRequest,Provider,ToolCall} from '../../src/assistant/providers/types.ts';

export const call=(name:string,args:unknown,id=`c-${name}-${Math.random().toString(36).slice(2,7)}`):ToolCall=>({id,name,args});
export const turn=(...toolCalls:ToolCall[]):Completion=>({text:null,toolCalls,stop:'tool_use',usage:{inputTokens:1000,outputTokens:100,cacheReadTokens:0,cacheWriteTokens:0}});
export const finalAnswer=(f:{kind:'answer'|'clarify'|'refuse';connective?:string|null;refusal_code?:string|null;clarify_code?:string|null}):Completion=>
  turn(call('final_answer',{connective:null,refusal_code:null,clarify_code:null,...f}));

export function fakeProvider(script:(Completion|Error|((req:CompletionRequest)=>Completion))[]):Provider&{requests:CompletionRequest[]}{
  const requests:CompletionRequest[]=[];
  let i=0;
  return {
    family:'fake',model:'fake',requests,
    async complete(req){
      requests.push(JSON.parse(JSON.stringify(req)));
      const step=script[i++];
      if(!step)throw new Error('script exhausted');
      if(step instanceof Error)throw step;
      return typeof step==='function'?step(req):step;
    }
  };
}
