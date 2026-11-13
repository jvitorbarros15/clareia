export interface ToolSpec{name:string;description:string;parameters:Record<string,unknown>}
export interface ToolCall{id:string;name:string;args:unknown}
export type Message=
  |{role:'user';content:string}
  |{role:'assistant';text:string|null;toolCalls:ToolCall[]}
  |{role:'tool';results:{id:string;name:string;content:string}[]};

export interface Usage{inputTokens:number;outputTokens:number;cacheReadTokens:number;cacheWriteTokens:number}
export const NO_USAGE:Usage={inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0};
export const addUsage=(a:Usage,b:Usage):Usage=>({inputTokens:a.inputTokens+b.inputTokens,outputTokens:a.outputTokens+b.outputTokens,cacheReadTokens:a.cacheReadTokens+b.cacheReadTokens,cacheWriteTokens:a.cacheWriteTokens+b.cacheWriteTokens});

export interface Completion{text:string|null;toolCalls:ToolCall[];stop:'tool_use'|'end'|'refusal'|'max_tokens'|'other';usage:Usage}
export interface CompletionRequest{system:string;messages:Message[];tools:ToolSpec[];maxTokens:number}

export interface Provider{
  family:'anthropic'|'openai'|'local'|'fake';
  model:string;
  complete(request:CompletionRequest):Promise<Completion>;
}
