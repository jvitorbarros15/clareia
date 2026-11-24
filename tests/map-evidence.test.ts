import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

test('map evidence shows the sum and count of only comparable profiles in average mode', async () => {
  const people = [
    {id:'1', uf:'SP', comparable:true, cells:[100, 200]},
    {id:'2', uf:'SP', comparable:true, cells:[501]},
    {id:'3', uf:'SP', comparable:false, cells:[900]},
    {id:'4', uf:'RJ', comparable:false, cells:[700]},
    {id:'5', uf:'RJ', comparable:true, noExercise:true, cells:[800]},
  ];
  const clickListeners: ((event:{target:{closest:(selector:string)=>unknown}}) => void)[] = [];
  const money = (cents:number|null) => cents === null ? 'Não informado' : (cents / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  let html = '';
  const source = await readFile(new URL('../real/portal.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window:{
      Clareia:{
        all:()=>people, byTotal:()=>people, comparable:(p:typeof people[number])=>p.comparable,
        cells:(p:typeof people[number])=>p.cells, sum:(cells:number[])=>cells.reduce((a,b)=>a+b,0), money,
        state:{category:'Todas'}, span:()=>'Jan 2025', parseRoute:()=>null,
        showDialog:(_title:string, body:string)=>{html=body;},
      },
      ClareiaData:{monthNames:['Jan'], coverage:[0], loadSuppliers:()=>new Promise(()=>{})},
    },
    document:{
      querySelector:()=>null,
      addEventListener:(name:string, listener:typeof clickListeners[number])=>{if(name==='click')clickListeners.push(listener);},
    },
    location:{pathname:'/'}, matchMedia:()=>({matches:true,addEventListener:()=>{}}), addEventListener:()=>{},
    ResizeObserver:class {},
  });
  const click = (p:string, value?:string) => {
    for (const listener of clickListeners) listener({target:{closest:selector=>selector.includes('[data-p],')?{dataset:{p,value}}:null}});
  };

  click('map-evidence');
  assert.ok(html.includes('<th>UF</th><th>Perfis</th><th>Valor</th>'));
  assert.ok(html.includes(`<td>SP / São Paulo</td><td>3</td><td>${money(1701)}</td>`));

  click('map-metric', 'average');
  click('map-evidence');
  assert.ok(html.includes('<div class="table-scroll"><table class="data-table map-average-table">'));
  assert.ok(html.includes('<th>UF</th><th>Soma</th><th>Comparáveis</th><th>Valor</th>'));
  assert.ok(html.includes(`<td>SP / São Paulo</td><td>${money(801)}</td><td>2</td><td>${money(400.5)}</td>`));
  assert.ok(html.includes('<td>RJ / Rio de Janeiro</td><td>Não informado</td><td>0</td><td>Não informado</td>'));
});
