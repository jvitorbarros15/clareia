import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'yaml';

type Schema={$ref?:string;type?:string|string[];items?:Schema;enum?:unknown[];pattern?:string;minimum?:number;maximum?:number;minLength?:number;maxLength?:number;default?:unknown;description?:string;format?:string;properties?:Record<string,Schema>;required?:string[]};
type Param={name:string;in:string;required?:boolean;description?:string;schema:Schema};
type Operation={summary?:string;description?:string;parameters?:Param[];responses:Record<string,{$ref?:string;description?:string;content?:Record<string,{schema:Schema}>}>};
export type Spec={info:{title:string;version:string;description:string};paths:Record<string,Record<string,Operation>>;components:{responses:Record<string,{description:string}>;schemas:Record<string,Schema>}};

const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const TYPES:Record<string,string>={string:'texto',integer:'inteiro',number:'número',boolean:'verdadeiro ou falso',object:'objeto',array:'lista',null:'nulo'};
const code=(v:unknown)=>`<code>${esc(v)}</code>`;
const refName=(r:string)=>r.split('/').pop()!;
const anchor=(name:string)=>`modelo-${name}`;

export async function loadSpec(repo:string):Promise<Spec>{
  return parse(await fs.readFile(path.join(repo,'api','openapi.yaml'),'utf8')) as Spec;
}

const inline=(text:string)=>esc(text).replace(/`([^`]+)`/g,'<code>$1</code>');
function blocks(text:string):string{
  const out:string[]=[];let para:string[]=[],list:string[]=[];
  const flush=()=>{
    if(para.length)out.push(`<p>${inline(para.join(' '))}</p>`);
    if(list.length)out.push(`<ul>${list.map(i=>`<li>${inline(i)}</li>`).join('')}</ul>`);
    para=[];list=[];
  };
  for(const raw of text.split('\n')){
    const line=raw.trim();
    if(!line){flush();continue;}
    if(line.startsWith('- ')){if(para.length)flush();list.push(line.slice(2));}
    else if(list.length&&raw.startsWith(' '))list[list.length-1]+=' '+line;
    else{if(list.length)flush();para.push(line);}
  }
  flush();
  return out.join('');
}

function typeOf(s:Schema):string{
  if(s.$ref)return `<a href="#${anchor(refName(s.$ref))}">${esc(refName(s.$ref))}</a>`;
  const types=(Array.isArray(s.type)?s.type:s.type?[s.type]:[]);
  const base=types.map(t=>t==='array'&&s.items?`lista de ${typeOf(s.items)}`:TYPES[t]??t).join(' ou ');
  return base||'qualquer valor';
}
function limits(s:Schema):string{
  const out:string[]=[];
  if(s.enum)out.push(`valores: ${s.enum.map(code).join(', ')}`);
  if(s.pattern)out.push(`padrão ${code(s.pattern)}`);
  if(s.minimum!==undefined)out.push(`mínimo ${s.minimum}`);
  if(s.maximum!==undefined)out.push(`máximo ${s.maximum}`);
  if(s.minLength!==undefined)out.push(`mínimo ${s.minLength} caracteres`);
  if(s.maxLength!==undefined)out.push(`máximo ${s.maxLength} caracteres`);
  if(s.default!==undefined)out.push(`padrão ${code(s.default)}`);
  if(s.format)out.push(`formato ${code(s.format)}`);
  return out.join('; ');
}
const note=(description:string|undefined,s:Schema)=>[description?inline(description):'',limits(s)].filter(Boolean).join('<br>');
const table=(head:string[],rows:string[][])=>`<table class="doc-table"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// The spec shares one long Error description across every error status; each row says what its own code means.
const STATUS:Record<string,string>={'200':'ok','400':'pedido inválido','404':'não encontrado','409':'cursor de outra publicação','500':'erro interno','503':'indisponível'};
function operation(spec:Spec,method:string,route:string,op:Operation):string{
  const params=op.parameters??[];
  const responses=Object.entries(op.responses).map(([status,r])=>{
    const resolved=r.$ref?spec.components.responses[refName(r.$ref)]:r;
    const schema=resolved&&'content' in resolved?(resolved as {content?:Record<string,{schema:Schema}>}).content?.['application/json']?.schema:undefined;
    return [code(status),STATUS[status]??inline(resolved?.description??''),schema?typeOf(schema):''];
  });
  return `<h4 class="api-h" id="${esc(method+route)}"><code>${esc(method.toUpperCase())} ${esc(route)}</code></h4><p>${inline(op.summary??'')}</p>${op.description?blocks(op.description):''}`
    +(params.length?table(['Parâmetro','Onde','Tipo','Descrição'],params.map(p=>[code(p.name)+(p.required?' (obrigatório)':''),p.in==='path'?'caminho':'consulta',typeOf(p.schema),note(p.description,p.schema)])):'<p>Sem parâmetros.</p>')
    +table(['Resposta','Significado','Corpo'],responses);
}

function model(name:string,s:Schema):string{
  const required=new Set(s.required??[]);
  const rows=Object.entries(s.properties??{}).map(([field,f])=>[code(field)+(required.has(field)?'':' (opcional)'),typeOf(f),note(f.description,f)]);
  return `<h4 class="api-h" id="${anchor(name)}">${esc(name)}</h4>${s.description?`<p>${inline(s.description)}</p>`:''}${rows.length?table(['Campo','Tipo','Descrição'],rows):''}`;
}

export const API_PATHS=(spec:Spec)=>Object.keys(spec.paths);

export function apiDocsInner(spec:Spec):string{
  const notice=`<div class="doc-callout"><h3>A API ainda não é pública</h3><p>Esta página documenta o contrato: endpoints, parâmetros e respostas. Os mesmos dados já estão disponíveis hoje como arquivos na página <a href="/dados-abertos">Dados abertos</a>.</p><p><a href="/clareia-api.pdf" download>Baixar PDF</a></p></div>`;
  const overview=`<h3>Visão geral</h3><p>Versão ${esc(spec.info.version)} do contrato. Os textos abaixo vêm do arquivo <code>api/openapi.yaml</code>.</p>${blocks(spec.info.description)}`;
  const endpoints=`<h3>Endpoints</h3>${Object.entries(spec.paths).flatMap(([route,ops])=>Object.entries(ops).map(([method,op])=>operation(spec,method,route,op))).join('')}`;
  const models=`<h3>Modelos de resposta</h3>${Object.entries(spec.components.schemas).map(([name,s])=>model(name,s)).join('')}`;
  return notice+overview+endpoints+models;
}
