import type {Reply} from '../src/assistant/pipeline.ts';
import type {GoldItem} from './lume-gold-expected.ts';

const nb=(s:string)=>s.replace(/ /g,' ');

export function check(item:GoldItem,reply:Reply):string[]{
  const reasons:string[]=[],text=nb(reply.text);
  if(reply.kind!==item.kind)return [`kind: esperado ${item.kind}, veio ${reply.kind}${reply.rendered.refusal?` (${reply.rendered.refusal.code})`:''}`];
  if(item.kind==='refuse'){
    const code=reply.rendered.refusal?.code;
    if(!item.codes?.includes(code??''))reasons.push(`código: esperado ${item.codes?.join('|')}, veio ${code}`);
    return reasons;
  }
  if(item.kind==='clarify'){
    const c=reply.rendered.clarify;
    if(!c||!item.codes?.includes(c.code))reasons.push(`clarify: esperado ${item.codes?.join('|')}, veio ${c?.code}`);
    if((c?.options.length??0)<(item.minOptions??0))reasons.push(`opções: ${c?.options.length??0} < ${item.minOptions}`);
    for(const n of item.names)if(!c?.options.some(o=>o.label.includes(n)))reasons.push(`opção ausente: ${n}`);
    return reasons;
  }
  for(const v of item.values)if(!text.includes(nb(v)))reasons.push(`valor ausente: ${v}`);
  for(const p of item.patterns)if(!new RegExp(nb(p),'m').test(text))reasons.push(`padrão ausente: ${p}`);
  let at=-1;
  for(const n of item.names){const i=text.indexOf(n,at+1);if(i<0){reasons.push(`nome ausente ou fora de ordem: ${n}`);break;}at=i;}
  for(const f of item.forbidden)if(text.toLowerCase().includes(f.toLowerCase()))reasons.push(`texto proibido: ${f}`);
  if(reply.notes.includes('render_check_failed'))reasons.push('render_check_failed');
  if(reply.route==='llm'&&item.tools?.length&&!reply.tools.includes(item.tools[0]))reasons.push(`consulta: esperado ${item.tools[0]}, usou ${reply.tools.join(',')||'nenhuma'}`);
  return reasons;
}
