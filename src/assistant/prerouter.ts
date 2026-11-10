import {copyInfo,refusal} from './copy.ts';
import type {Publication} from './data.ts';
import type {ToolName} from './engine.ts';
import {clarifyCategories,clarifyPeople} from './render.ts';
import type {Rendered} from './render.ts';
import {findMentions} from './resolve.ts';
import {matchCategory,matchUF,normalize,parsePeriod} from './vocabulary.ts';

export interface PlanStep{tool:ToolName;args:Record<string,unknown>}
export type Preroute={kind:'plan';plan:PlanStep[]}|{kind:'final';rendered:Rendered}|null;

const OTHER_DOMAINS=/projet|propost|\bvot|votac|\blei\b|\bpec\b|\bplp?\b|fornecedor|partido|emenda|registro|nota fiscal|maior despesa|menor despesa|categoria/;
const COMPARE=/compar|\bmais que\b|\bmenos que\b|\bversus\b|\bvs\b/;
const SPEND_INTENT=/gast|despes|cota|custo|custou|total|compar|\bmais que\b|\bmenos que\b|\bversus\b/;
const RANK=/\bquem\b|maiores gastos|menores gastos|^(gastos|despesas)$/;

export function preroute(pub:Publication,question:string):Preroute{
  const q=normalize(question);
  if(!q||OTHER_DOMAINS.test(q))return null;
  const uf=matchUF(question),period=parsePeriod(question),cat=matchCategory(pub.categories,question);
  if(cat.status==='many')return {kind:'final',rendered:clarifyCategories(cat.candidates)};
  if(cat.status==='absent')return {kind:'final',rendered:{kind:'refuse',lines:[],evidence:[],refusal:refusal('category_not_in_version',copyInfo(pub))}};
  const category=cat.status==='one'?cat.category.key:null;
  const metric=/por mes|mensal|media/.test(q)?'monthly':'total';
  const mentions=findMentions(pub,question,uf);
  if(mentions.length&&!SPEND_INTENT.test(q))return null;
  const unsure=mentions.find(m=>m.status!=='one');
  if(unsure){
    if(!unsure.candidates.length)return null;
    return {kind:'final',rendered:clarifyPeople(unsure.candidates)};
  }
  if(mentions.length>2)return {kind:'final',rendered:clarifyPeople(mentions.map(m=>m.candidates[0]),'too_many_people')};
  if(mentions.length===2){
    const [a,b]=mentions.map(m=>m.candidates[0]);
    if(a.id===b.id)return null;
    return {kind:'plan',plan:[{tool:'compare_spending',args:{a:a.id,b:b.id,metric,category,months:period}}]};
  }
  if(mentions.length===1){
    if(COMPARE.test(q))return {kind:'final',rendered:{kind:'clarify',lines:[],evidence:[],clarify:{code:'missing_second_person',title:'Qual é o outro representante?',text:'Para comparar, preciso de dois deputados. Diga o nome do outro.',options:[]}}};
    return {kind:'plan',plan:[{tool:'deputy_spending',args:{deputy_id:mentions[0].candidates[0].id,category,months:period}}]};
  }
  if(RANK.test(q)&&SPEND_INTENT.test(q)){
    const order=/quem.*menos|menor gasto|menores gastos|gastou menos/.test(q)?'asc':'desc';
    return {kind:'plan',plan:[{tool:'rank_spending',args:{metric,order,category,uf,months:period,limit:5}}]};
  }
  return null;
}
