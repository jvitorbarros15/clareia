import type {RefusalCode} from './copy.ts';
import type {Publication} from './data.ts';
import {normalize} from './vocabulary.ts';

export const MAX_QUESTION=300;

export interface GuardVerdict{code:RefusalCode;injection?:boolean}

export function sanitizeQuestion(raw:string):string{
  return raw.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_QUESTION);
}

const INJECTION=/ignor\w*\s+(as|suas|seus|todas|tudo|previous|prior|the|your|all)|ignore\s+(previous|prior|all|the|your)|system\s*prompt|prompt\s+do\s+sistema|instrucoes?\s+(anteriores|do\s+sistema|acima)|voce\s+agora\s+e|a\s+partir\s+de\s+agora\s+voce|finja|jailbreak|developer\s*mode|modo\s+desenvolvedor|repita\s+(o\s+)?(prompt|texto|instrucoes)|revele|esqueca\s+(as|tudo|suas)|desconsidere|act\s+as|you\s+are\s+now|reveal\s+your/;
const DEFAMATION=/\bculp\w*|\bcrim\w*|fraud\w*|escandal\w*|suspeit\w*|propina|ilegal\w*|ilicit\w*|irregular\w*|lavagem|improbidade|\bladr[aãoõ]\w*|roub\w*|furt\w*|bandid\w*|safad\w*|corrup\w*|desvi\w*|esquema|criminos\w*/;
const OPINION=/melhor|\bpior|honest|vergonh|confi(a|ar|avel|aveis)\b|vale a pena|deveria|merece|bom deputado|mau deputado|competent|incompetent|trabalha mais|trabalha menos|preguic|vagabund/;
const UNPUBLISHED=/patrimon|bens declarados|emenda|eleic|eleitor|votos recebidos|salario|remunera|verba de gabinete|secretari|assessor|senador|senado\b|presidente|governador|prefeit|vereador|ministro|\bstf\b|\btse\b|\bcpf\b|cnpj|imovel|imoveis|processo judicial|condenac|processo no/;
const BILLS=/projet|propost|\blei\b|\bleis\b|\bpec\b|\bplp?\b|\bautoria|autor\b/;
const VOTES=/\bvot\w*|votac\w*|\bplenario/;
const PARTY=/\bpartido|\bpartidos|\blegenda|\bfiliac/;

export function guard(rawQuestion:string,pub:Publication):GuardVerdict|null{
  const question=sanitizeQuestion(rawQuestion),q=normalize(question);
  if(!q)return {code:'too_broad'};
  if(INJECTION.test(q))return {code:'out_of_scope',injection:true};
  if(DEFAMATION.test(q))return {code:'defamation'};
  if(OPINION.test(q))return {code:'opinion'};
  const years=q.match(/\b(?:19|20)\d{2}\b/g);
  if(years?.some(y=>y!==String(pub.year)))return {code:'period_out_of_scope'};
  if(UNPUBLISHED.test(q))return {code:'not_published'};
  if((!pub.billsApproved&&BILLS.test(q))||(!pub.votesApproved&&VOTES.test(q)))return {code:'not_published'};
  if(!pub.coverageApproved&&PARTY.test(q))return {code:'party_unavailable'};
  return null;
}
