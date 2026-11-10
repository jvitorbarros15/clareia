import {copyInfo,refusal} from './copy.ts';
import type {RefusalCode} from './copy.ts';
import type {Publication} from './data.ts';
import {runTool} from './engine.ts';
import type {ToolOutput} from './engine.ts';
import {guard,sanitizeQuestion} from './guard.ts';
import {compose,plan} from './planner.ts';
import {costUsd} from './pricing.ts';
import {preroute} from './prerouter.ts';
import type {PlanStep} from './prerouter.ts';
import type {Provider,Usage} from './providers/types.ts';
import {renderOutputs,strayNumbers,toText} from './render.ts';
import type {Rendered} from './render.ts';

export interface Reply{
  kind:Rendered['kind'];rendered:Rendered;text:string;
  route:'guard'|'prerouter'|'llm'|'rules';
  plan:PlanStep[]|null;notes:string[];
  model:string|null;usage:Usage|null;costUsd:number|null;latencyMs:number;
}

const refused=(pub:Publication,code:RefusalCode):Rendered=>{const r=refusal(code,copyInfo(pub));return {kind:'refuse',lines:[r.text],evidence:[],refusal:r};};

export async function answerQuestion(rawQuestion:string,pub:Publication,options:{provider?:Provider}={}):Promise<Reply>{
  const started=Date.now(),question=sanitizeQuestion(rawQuestion);
  const done=(rendered:Rendered,route:Reply['route'],extra:Partial<Reply>={}):Reply=>({
    kind:rendered.kind,rendered,text:rendered.kind==='answer'?toText(rendered):rendered.refusal?.text??rendered.clarify?.text??toText(rendered),
    route,plan:null,notes:[],model:null,usage:null,costUsd:null,latencyMs:Date.now()-started,...extra
  });

  const verdict=guard(question,pub);
  if(verdict)return done(refused(pub,verdict.code),'guard',{notes:verdict.injection?['injection_attempt']:[]});

  const routed=preroute(pub,question);
  if(routed?.kind==='final')return done(routed.rendered,'prerouter');
  if(routed?.kind==='plan'){
    const outputs:ToolOutput[]=[];
    for(const step of routed.plan)outputs.push(await runTool(pub,step.tool,step.args));
    const rendered=renderOutputs(pub,outputs);
    if(rendered.kind==='answer'&&strayNumbers(toText(rendered),outputs).length)return done(refused(pub,'error'),'prerouter',{plan:routed.plan,notes:['render_check_failed']});
    return done(rendered,'prerouter',{plan:routed.plan});
  }

  if(!options.provider)return done(refused(pub,/gast|despesa|deputad|quem|quanto/.test(question.toLowerCase())?'too_broad':'out_of_scope'),'rules');
  const result=await plan(question,pub,options.provider);
  const composed=compose(pub,result),provider=options.provider;
  return done(composed.rendered,'llm',{
    notes:composed.notes,model:provider.model,usage:result.usage,
    costUsd:costUsd(provider.family,provider.model,result.usage)
  });
}
