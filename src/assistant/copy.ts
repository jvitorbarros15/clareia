import type {Publication} from './data.ts';
import {MONTH_ABBR} from './format.ts';
import {categoryKeys,categoryLabel,CATEGORY_GROUPS} from './vocabulary.ts';

export type RefusalCode='out_of_scope'|'not_published'|'period_out_of_scope'|'opinion'|'defamation'|'unknown_person'|'category_not_in_version'|'party_unavailable'|'too_broad'|'unavailable'|'error';
export type ClarifyCode='ambiguous_person'|'ambiguous_supplier'|'ambiguous_category'|'missing_second_person'|'too_many_people';

export interface Refusal{code:RefusalCode;title:string;text:string}
export interface CopyInfo{span:string;year:number;billsApproved:boolean;votesApproved:boolean;people:number;categoryLabels:string[];examples:string[]}

export const EXAMPLES=['Quem mais gastou com passagens?','Quem mais gastou por mês?','Quem gastou menos?'];

export function copyInfo(pub:Publication):CopyInfo{
  const lo=Math.min(...pub.months),hi=Math.max(...pub.months);
  const labels=categoryKeys(pub.categories).map(k=>CATEGORY_GROUPS.find(g=>g.key===k)?.label??categoryLabel(k));
  return {span:`${MONTH_ABBR[lo-1]}–${MONTH_ABBR[hi-1]} ${pub.year}`,year:pub.year,billsApproved:pub.billsApproved,votesApproved:pub.votesApproved,people:pub.people.length,categoryLabels:labels,examples:EXAMPLES};
}

const list=(items:string[])=>items.length<2?items.join(''):`${items.slice(0,-1).join(', ')} e ${items.at(-1)}`;

export function refusal(code:RefusalCode,info:CopyInfo):Refusal{
  const published=['despesas da cota parlamentar',...(info.billsApproved?['projetos de lei']:[]),...(info.votesApproved?['votações nominais']:[])];
  switch(code){
    case 'out_of_scope':return {code,title:'Fora do que o Clareia publica',text:`Eu respondo só sobre o que está publicado aqui: ${list(published)} dos deputados desta versão. Essa pergunta fica fora disso. Experimente: “${info.examples[0]}”.`};
    case 'not_published':{
      const missing=[...(info.billsApproved?[]:['projetos de lei']),...(info.votesApproved?[]:['votações']),'emendas','eleições','patrimônio','salários'];
      const text=list(missing);
      return {code,title:'Esse dado ainda não foi publicado',text:`O Clareia ainda não coletou e conferiu isso. Nesta versão estão ${list(published)}. ${text.charAt(0).toUpperCase()+text.slice(1)} não estão aqui, então não há número para mostrar.`};
    }
    case 'period_out_of_scope':return {code,title:'Período fora desta versão',text:`Esta versão cobre ${info.span}. Outros períodos ainda não foram publicados; nenhum valor foi estimado.`};
    case 'opinion':return {code,title:'Sem opinião, só registros',text:'Não avalio nem comparo deputados em qualidade, mérito ou intenção. Posso mostrar os números e os registros oficiais. Gasto maior não indica irregularidade.'};
    case 'defamation':return {code,title:'Não afirmo irregularidade',text:'Não afirmo crime, fraude ou má conduta de ninguém. O Clareia publica registros oficiais, não julgamentos. Se quiser, mostro as despesas, os projetos ou os votos registrados dessa pessoa.'};
    case 'unknown_person':return {code,title:'Não encontrei esse nome',text:`Não encontrei esse nome entre os ${info.people} deputados desta versão. Confira a grafia, informe o sobrenome ou a UF, ou escolha na lista de representantes.`};
    case 'category_not_in_version':return {code,title:'Categoria não está nesta versão',text:`Não há despesas nessa categoria nos registros publicados. As categorias desta versão são: ${info.categoryLabels.join('; ')}.`};
    case 'party_unavailable':return {code,title:'Partido indisponível nesta versão',text:'A filiação por mês de competência ainda não foi aprovada para esta versão, e o partido atual não é aplicado a despesas passadas. Por isso não respondo por partido aqui.'};
    case 'too_broad':return {code,title:'Vamos delimitar',text:`Preciso de um recorte: uma pessoa, um estado, uma categoria ou um período. Exemplos: “${info.examples[0]}”, “${info.examples[1]}”.`};
    case 'unavailable':return {code,title:'Assistente indisponível',text:'O assistente está desligado ou indisponível agora. Nenhum valor foi estimado. As perguntas simples continuam funcionando pela busca local.'};
    case 'error':return {code,title:'Não consegui responder',text:'Algo falhou ao montar a resposta. Nenhum valor foi estimado. Tente reformular ou use os rankings da página.'};
  }
}

export function clarifyIntro(code:ClarifyCode):{title:string;text:string}{
  switch(code){
    case 'ambiguous_person':return {title:'Qual deles?',text:'Encontrei mais de um deputado com esse nome. Escolha um:'};
    case 'ambiguous_supplier':return {title:'Qual fornecedor?',text:'Há mais de um fornecedor com esse nome nos registros. Escolha um:'};
    case 'ambiguous_category':return {title:'Qual categoria?',text:'Sua pergunta cita mais de uma categoria. Escolha uma por vez:'};
    case 'missing_second_person':return {title:'Qual é o outro representante?',text:'Para comparar, preciso de dois deputados. Diga o nome do outro.'};
    case 'too_many_people':return {title:'Escolha duas pessoas para comparar',text:'Comparo dois deputados por vez. Diga quais dois.'};
  }
}
