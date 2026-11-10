import type {Publication} from './data.ts';
import type {Refusal,ClarifyCode} from './copy.ts';
import {clarifyIntro,copyInfo,refusal} from './copy.ts';
import type {Scope,ToolOutput} from './engine.ts';
import {MONTH_ABBR,dateBR,decimal,integer,money,numberTokens,percent,plural} from './format.ts';
import {categoryLabel} from './vocabulary.ts';

export type Evidence=
  |{action:'evidence';id:number;kind:'gastos'}
  |{action:'records';id:number;month?:number}
  |{action:'activity';id:number;kind:'bills'|'votes'}
  |{action:'profile';id:number}
  |{action:'methodology'}
  |{action:'external';url:string};

export interface ClarifyOption{label:string;deputyId?:number;supplier?:string;category?:string}
export interface Rendered{
  kind:'answer'|'refuse'|'clarify';
  lines:string[];evidence:Evidence[];
  refusal?:Refusal;
  clarify?:{code:ClarifyCode;title:string;text:string;options:ClarifyOption[]};
}

export const NOT_IRREGULARITY='Gasto maior não indica irregularidade.';
export const RANKING_NOTE='Ranking de despesas da cota parlamentar; não mede qualidade do mandato.';
export const ACTIVITY_NOTE='Quantidade mostra atividade, não qualidade, e não é comparada com gastos.';

const ctxOf=(p:{uf:string|null;party:string|null})=>[p.uf,p.party].filter(Boolean).join(' · ')||'Deputado(a) federal';
const who=(p:{name:string;uf:string|null;party:string|null})=>`${p.name} (${ctxOf(p)})`;
const rec=(n:number)=>`${integer(n)} ${plural(n,'registro','registros')}`;
const span=(s:Scope)=>s.months.from===s.months.to?`${MONTH_ABBR[s.months.from-1]} ${s.year}`:`${MONTH_ABBR[s.months.from-1]}–${MONTH_ABBR[s.months.to-1]} ${s.year}`;
const years=(ys:number[])=>ys.length?(ys.length===1?String(ys[0]):`${Math.min(...ys)} a ${Math.max(...ys)}`):'';

export function scopeLine(s:Scope):string{
  const parts=[`Período: ${span(s)}`];
  if(s.category)parts.push(`categoria: ${s.category.label}${s.category.officials.length>1?` (${s.category.officials.join('; ')})`:''}`);
  else parts.push('todas as categorias');
  if(s.uf)parts.push(`UF: ${s.uf}`);
  return parts.join(' · ');
}

function failure(pub:Publication,out:Extract<ToolOutput,{ok:false}>):Rendered{
  const info=copyInfo(pub),code=out.error.code;
  const map:Record<string,Parameters<typeof refusal>[0]>={period_out_of_scope:'period_out_of_scope',category_not_in_version:'category_not_in_version',unknown_person:'unknown_person',not_published:'not_published',unknown_supplier:'unknown_person'};
  const r=refusal(map[code]??'error',info);
  return {kind:'refuse',lines:[r.text],evidence:[],refusal:r};
}

const personEvidence=(id:number):Evidence[]=>[{action:'evidence',id,kind:'gastos'},{action:'records',id},{action:'profile',id}];
const clarify=(code:ClarifyCode,options:ClarifyOption[]):Rendered=>{const c=clarifyIntro(code);return {kind:'clarify',lines:[c.text],evidence:[],clarify:{code,...c,options}};};

export function clarifyPeople(people:{id:number;name:string;uf:string|null}[],code:ClarifyCode='ambiguous_person'):Rendered{
  return clarify(code,people.map(p=>({label:`${p.name}${p.uf?` · ${p.uf}`:''}`,deputyId:p.id})));
}
export function clarifyCategories(cats:{key:string;label:string}[]):Rendered{return clarify('ambiguous_category',cats.map(c=>({label:c.label,category:c.key})));}

export function renderOutput(pub:Publication,out:ToolOutput):Rendered{
  if(!out.ok)return failure(pub,out);
  const d=out.data,s=out.scope,lines:string[]=[],answer=(evidence:Evidence[]=[]):Rendered=>({kind:'answer',lines,evidence});
  switch(out.tool){
    case 'resolve_deputy':{
      if(d.status==='many')return clarifyPeople(d.candidates);
      if(d.status==='none')return {kind:'refuse',lines:[],evidence:[],refusal:refusal('unknown_person',copyInfo(pub))};
      const p=d.candidates[0];lines.push(`${who(p)}.`);return answer([{action:'profile',id:p.id}]);
    }
    case 'rank_spending':{
      const monthly=d.metric==='monthly';
      lines.push(`Quem ${d.order==='asc'?'menos':'mais'} gastou ${monthly?'por mês, em média':'no período'}:`,scopeLine(s));
      if(!d.rows.length){lines.push('Nenhum deputado com exercício confirmado nesse recorte.');return answer();}
      d.rows.forEach((r:any)=>lines.push(`${r.rank}. ${who(r)}: ${money(r.valueCents)}${monthly?` por mês (${money(r.cents)} em ${integer(r.monthsServed)} ${plural(r.monthsServed,'mês','meses')} de exercício)`:''} · ${rec(r.records)}`));
      lines.push(`Deputados considerados: ${integer(d.considered)}.`);
      if(monthly)lines.push('Média por mês: total no recorte dividido pelos meses de exercício publicados.');
      if(d.excludedNoExercise)lines.push(`Não entram ${integer(d.excludedNoExercise)} ${plural(d.excludedNoExercise,'deputado sem exercício confirmado','deputados sem exercício confirmado')} em ${s.year}.`);
      if(d.excludedHeld)lines.push(`Não entram ${integer(d.excludedHeld)} ${plural(d.excludedHeld,'deputado','deputados')} com mês retido para revisão, cuja média no período não pode ser calculada.`);
      if(d.includedHeld)lines.push(`${integer(d.includedHeld)} ${plural(d.includedHeld,'deputado tem','deputados têm')} mês retido para revisão, sem valor publicado; o total desse recorte pode estar incompleto.`);
      lines.push(RANKING_NOTE,NOT_IRREGULARITY);
      return answer([{action:'methodology'},...d.rows.slice(0,3).map((r:any)=>({action:'evidence' as const,id:r.id,kind:'gastos' as const}))]);
    }
    case 'deputy_spending':{
      const p=d.person;
      if(d.noExercise){lines.push(`${p.name} não tem exercício de mandato confirmado em ${s.year} nas fontes oficiais. Não há valor de despesas para mostrar.`);return answer([{action:'profile',id:p.id}]);}
      lines.push(`${who(p)} teve ${money(d.totalCents)} em despesas da cota parlamentar no recorte, em ${rec(d.records)}.`,scopeLine(s));
      if(d.monthlyAverageCents!==null)lines.push(`Média por mês: ${money(d.monthlyAverageCents)} (${integer(d.monthsServed)} ${plural(d.monthsServed,'mês','meses')} de exercício).`);
      if(d.heldMonths>0)lines.push(`${integer(d.heldMonths)} ${plural(d.heldMonths,'mês retido','meses retidos')} para revisão, sem valor publicado.`);
      if(d.byCategory.length){
        lines.push('Principais categorias:');
        d.byCategory.slice(0,5).forEach((c:any)=>lines.push(`- ${categoryLabel(c.category)}: ${money(c.cents)}${c.sharePercent!==null?` (${percent(c.sharePercent)})`:''}`));
        lines.push('Percentuais sobre a soma das categorias com valor positivo.');
        if(d.byCategory.some((c:any)=>c.cents<0))lines.push('Valores negativos são ajustes registrados na fonte e reduzem o total.');
      }
      lines.push(NOT_IRREGULARITY);
      return answer(personEvidence(p.id));
    }
    case 'compare_spending':{
      if(d.status==='no_exercise'){lines.push(`Sem exercício confirmado em ${s.year}: ${d.people.map((p:any)=>p.name).join(' e ')}. Não há valor para comparar.`);return answer();}
      const monthly=d.metric==='monthly',suffix=monthly?' por mês':'';
      lines.push(`${who(d.a)}: ${money(d.a.valueCents)}${suffix}`,`${who(d.b)}: ${money(d.b.valueCents)}${suffix}`,scopeLine(s));
      const first=d.a.name.split(' ')[0],second=d.b.name.split(' ')[0];
      if(d.more==='equal')lines.push('Os valores são iguais no recorte.');
      else{
        const more=d.more==='a';
        lines.push(`${first} gastou ${money(d.diffCents)} ${more?'a mais':'a menos'} que ${second}${d.percent!==null?` (${percent(d.percent)} ${more?'a mais':'a menos'})`:`. Sem percentual: o valor de ${second} é ${d.b.valueCents<0?'negativo':'zero'}`}.`);
      }
      if(d.monthsDiffer)lines.push(`Períodos de exercício diferentes: ${first} com ${integer(d.a.monthsServed)} ${plural(d.a.monthsServed,'mês','meses')} e ${second} com ${integer(d.b.monthsServed)}. Para uma base igual, peça a média por mês.`);
      lines.push(NOT_IRREGULARITY);
      return answer([{action:'evidence',id:d.a.id,kind:'gastos'},{action:'evidence',id:d.b.id,kind:'gastos'}]);
    }
    case 'top_suppliers':{
      lines.push(d.person?`Maiores fornecedores de ${who(d.person)}:`:'Maiores fornecedores entre os deputados desta versão:',scopeLine(s));
      if(!d.rows.length){lines.push('Nenhum registro nesse recorte.');return answer();}
      d.rows.forEach((r:any,i:number)=>lines.push(`${i+1}. ${r.supplier}: ${money(r.cents)} · ${rec(r.records)}${d.person?'':` · ${integer(r.people)} ${plural(r.people,'deputado','deputados')}`}`));
      lines.push(`Total no recorte: ${money(d.scopeTotalCents)} em ${integer(d.suppliers)} ${plural(d.suppliers,'fornecedor','fornecedores')}.`);
      if(d.privatePersonNote)lines.push('“Fornecedor pessoa física” reúne todos os prestadores pessoas físicas; o nome individual não é publicado.');
      lines.push(NOT_IRREGULARITY);
      return answer(d.person?[{action:'records',id:d.person.id}]:[]);
    }
    case 'supplier_spending':{
      if(d.status==='none'){lines.push('Não encontrei esse fornecedor nos registros publicados.');return answer();}
      if(d.status==='many')return clarify('ambiguous_supplier',d.candidates.map((c:string)=>({label:c,supplier:c})));
      lines.push(`${d.supplier} recebeu ${money(d.totalCents)} em ${rec(d.records)}${d.person?` de ${d.person.name}`:` de ${integer(d.deputies)} ${plural(d.deputies,'deputado','deputados')}`}.`,scopeLine(s));
      if(!d.person&&d.byDeputy.length){lines.push('Por deputado:');d.byDeputy.slice(0,5).forEach((r:any)=>lines.push(`- ${who(r)}: ${money(r.cents)} · ${rec(r.records)}`));}
      if(d.byCategory.length){lines.push('Por categoria:');d.byCategory.forEach((c:any)=>lines.push(`- ${categoryLabel(c.category)}: ${money(c.cents)}`));}
      if(d.supplier==='Fornecedor pessoa física')lines.push('“Fornecedor pessoa física” reúne todos os prestadores pessoas físicas; o nome individual não é publicado.');
      lines.push(NOT_IRREGULARITY);
      return answer();
    }
    case 'category_totals':{
      lines.push('Despesas por categoria:',scopeLine(s));
      d.rows.forEach((r:any)=>lines.push(`- ${categoryLabel(r.category)}: ${money(r.cents)}${r.sharePercent!==null?` (${percent(r.sharePercent)})`:''}`));
      lines.push(`Total: ${money(d.totalCents)}.`,'Percentuais sobre a soma das categorias com valor positivo.');
      if(d.negativeAdjustmentsCents<0)lines.push(`Ajustes negativos registrados na fonte: ${money(d.negativeAdjustmentsCents)}.`);
      lines.push(NOT_IRREGULARITY);
      return answer([{action:'methodology'}]);
    }
    case 'uf_totals':{
      const avg=d.metric==='average';
      lines.push(avg?'Média de despesas por deputado, por UF:':'Despesas por UF:',scopeLine(s));
      d.rows.forEach((r:any,i:number)=>lines.push(`${i+1}. ${r.uf}: ${money(avg?r.averageCents:r.cents)}${avg?` por deputado (${money(r.cents)} entre ${integer(r.people)})`:` · ${integer(r.people)} ${plural(r.people,'deputado','deputados')}`}`));
      lines.push('Só entram deputados com exercício confirmado e UF informada.');
      if(d.withoutUf)lines.push(`${integer(d.withoutUf)} ${plural(d.withoutUf,'deputado fica','deputados ficam')} de fora por não ter UF informada.`);
      lines.push(RANKING_NOTE,NOT_IRREGULARITY);
      return answer();
    }
    case 'expense_records':{
      lines.push(`Registros de ${d.person.name}: ${rec(d.matched)}, somando ${money(d.sumCents)}.`,scopeLine(s));
      d.rows.forEach((r:any)=>lines.push(`- ${r.date?dateBR(r.date):'sem data'} · ${r.supplier} · ${categoryLabel(r.category)} · ${money(r.cents)}`));
      if(d.matched>d.rows.length)lines.push(`Mostrando ${integer(d.rows.length)} de ${integer(d.matched)}.`);
      lines.push(NOT_IRREGULARITY);
      return answer([{action:'records',id:d.person.id,...(s.months.from===s.months.to?{month:s.months.from}:{})},...d.rows.flatMap((r:any)=>r.receipt?[{action:'external' as const,url:r.receipt}]:[])]);
    }
    case 'deputy_coverage':{
      const c=d.exerciseCounts;
      if(!d.coverageApproved){lines.push(`${d.person.name}: a cobertura mensal de exercício e partido ainda não foi aprovada para esta versão.`);return answer();}
      lines.push(`${who(d.person)}: exercício completo em ${integer(c.full)} ${plural(c.full,'mês','meses')}, parcial em ${integer(c.partial)} e fora do mandato em ${integer(c.outside)}, em ${s.year}.`);
      if(d.noExercise)lines.push(`Sem exercício confirmado em ${s.year}.`);
      return answer([{action:'profile',id:d.person.id}]);
    }
    case 'deputy_bills':{
      if(!d.available){lines.push('Projetos de lei ainda não foram coletados e conferidos nesta versão.');return answer();}
      const c=d.counts;
      lines.push(`${who(d.person)}, projetos de lei (PL, PLP e PEC) de ${years(d.years)}: ${integer(c.proposed)} como proponente (${integer(c.joint)} em conjunto com outros proponentes), ${integer(c.coauthored)} em coautoria e ${integer(c.norms)} que viraram norma jurídica.`);
      d.rows.forEach((r:any)=>lines.push(`- ${r.type} ${r.number}/${r.year} · ${r.proponent?'proponente':'coautoria'} · ${r.situation??'situação não informada'}: ${r.summary}`));
      if(d.rows.length&&d.matched>d.rows.length)lines.push(`Mostrando ${integer(d.rows.length)} de ${integer(d.matched)}.`);
      lines.push(ACTIVITY_NOTE);
      return answer([{action:'activity',id:d.person.id,kind:'bills'}]);
    }
    case 'deputy_votes':{
      if(!d.available){lines.push('Votações nominais ainda não foram coletadas e conferidas nesta versão.');return answer();}
      lines.push(`${who(d.person)}, votações nominais de ${years(d.years)}: ${integer(d.totalVotes)} votos registrados (${d.counts.map((c:any)=>`${c.category}: ${integer(c.n)}`).join('; ')}).`);
      if(d.votesHeld)lines.push(`${integer(d.votesHeld)} ${plural(d.votesHeld,'votação retida','votações retidas')} para revisão não entram na contagem.`);
      d.rows.forEach((r:any)=>lines.push(`- ${dateBR(r.date)} · ${r.organ} · voto ${r.category}${r.matters.length?` · ${r.matters.join(', ')}`:''}: ${r.description}`));
      if(d.rows.length&&d.matched>d.rows.length)lines.push(`Mostrando ${integer(d.rows.length)} de ${integer(d.matched)}.`);
      lines.push(ACTIVITY_NOTE);
      return answer([{action:'activity',id:d.person.id,kind:'votes'}]);
    }
    case 'rank_bills':{
      if(!d.available){lines.push('Projetos de lei ainda não foram coletados e conferidos nesta versão.');return answer();}
      const label:Record<string,string>={proposed:'como proponente',joint:'em conjunto com outros proponentes',coauthored:'em coautoria',norms:'que viraram norma jurídica'};
      lines.push(`Projetos de lei ${label[d.metric]}, ${d.order==='asc'?'menor':'maior'} quantidade (${years(d.years)}):`,scopeLine(s));
      d.rows.forEach((r:any)=>lines.push(`${r.rank}. ${who(r)}: ${integer(r.n)}`));
      lines.push(ACTIVITY_NOTE);
      return answer();
    }
  }
}

export function renderOutputs(pub:Publication,outs:ToolOutput[]):Rendered{
  const parts=outs.map(o=>renderOutput(pub,o));
  const stop=parts.find(p=>p.kind!=='answer');
  if(stop)return stop;
  const lines:string[]=[];
  parts.forEach((p,i)=>{if(i)lines.push('');lines.push(...p.lines);});
  return {kind:'answer',lines,evidence:parts.flatMap(p=>p.evidence)};
}

export const toText=(r:Rendered):string=>r.lines.join('\n');

function leaves(value:unknown,out:Set<string>):void{
  if(typeof value==='number'&&Number.isFinite(value)){
    out.add(String(value));out.add(integer(value));out.add(decimal(value));out.add(percent(value).replace('%',''));
    out.add(money(Math.abs(value)).replace(/[^\d.,]/g,''));out.add(integer(Math.abs(value)));
  }else if(typeof value==='string')for(const t of numberTokens(value))out.add(t);
  else if(Array.isArray(value)){out.add(String(value.length));value.forEach(v=>leaves(v,out));}
  else if(value&&typeof value==='object')Object.values(value).forEach(v=>leaves(v,out));
}

export function allowedTokens(outs:ToolOutput[]):Set<string>{
  const set=new Set<string>();
  for(const o of outs)leaves(o.ok?{scope:o.scope,data:o.data}:o.error,set);
  return set;
}

export function strayNumbers(text:string,outs:ToolOutput[]):string[]{
  const allowed=allowedTokens(outs);
  return numberTokens(text.replace(/^\d+\.\s/gm,'')).filter(t=>!allowed.has(t));
}
