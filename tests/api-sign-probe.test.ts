import test from 'node:test';
import assert from 'node:assert/strict';
import {probeApiSign} from '../src/api-sign-probe.ts';

const row=(valorDocumento=360,valorGlosa=0,valorLiquido=-360,tipoDespesa='TELEFONIA')=>({valorDocumento,valorGlosa,valorLiquido,tipoDespesa});
const reply=(dados:unknown[],next=false)=>Response.json({dados,links:next?[{rel:'next',href:'https://example.invalid/never-follow'}]:[]});

test('fixed sample counts signs per year, excludes air travel, marks pagination and stores no payloads',async()=>{
  const urls:string[]=[],delays:number[]=[];
  const report=await probeApiSign({now:()=> '2026-11-13T00:00:00Z',wait:async ms=>{delays.push(ms);},fetch:async input=>{
    urls.push(String(input));
    return reply([row(),row(360,0,360),row(360,1,-360),row(0,0,0),row(360,0,-360,'PASSAGEM AÉREA - SIGEPA'),row(360,0,-360,'PASSAGENS AÉREAS'),{...row(),supplier:'private supplier',document:'private document'}],true);
  }});
  assert.equal(urls.length,30);assert.equal(new Set(urls).size,30);assert.deepEqual(delays,Array(29).fill(700));
  for(const url of urls){const u=new URL(url);assert.equal(u.searchParams.get('pagina'),'1');assert.equal(u.searchParams.get('itens'),'100');}
  for(const year of report.years)assert.deepEqual(year,{year:year.year,combinations:10,successful:10,unavailable:0,paginated:10,nonAirRows:50,zeroGlosaRows:40,invertedRows:30,zeroDocumentMatches:10});
  assert.doesNotMatch(JSON.stringify(report),/private supplier|private document|never-follow/);
});

test('network, HTTP and malformed responses get only one spaced retry; failures never become zero expense months',async()=>{
  let calls=0;const urls:string[]=[],delays:number[]=[];
  const report=await probeApiSign({wait:async ms=>{delays.push(ms);},fetch:async input=>{
    calls++;urls.push(String(input));
    if(calls===1)throw Error('network');
    if(calls===3||calls===4)return new Response('',{status:503});
    if(calls===5)return Response.json({dados:[{...row(),valorLiquido:'-360'}],links:[]});
    return reply([row()]);
  }});
  assert.equal(calls,33);assert.equal(delays.length,32);assert.ok(delays.every(ms=>ms===700));
  assert.equal(urls[0],urls[1]);assert.equal(urls[2],urls[3]);assert.equal(urls[4],urls[5]);
  assert.equal(report.years[0].unavailable,1);assert.equal(report.years[0].successful,9);assert.equal(report.years[0].invertedRows,9);
  assert.equal(report.years[1].successful,10);
});
