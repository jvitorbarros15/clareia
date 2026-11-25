import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLegislatureSummary} from '../src/legislature-summary.ts';
import type {MonthSummary,PersonSummary,SiteSummary} from '../src/site-summary.ts';

function fixture(){
  const prior={publicationId:'prior',scope:{months:Array.from({length:12},(_,i)=>i+1)},totalCents:125,records:2,people:[
    {id:2,name:'Outra Pessoa',cents:25,records:1,months:[
      {month:1,cents:25,records:1,held:false,ufStatus:'review',uf:'RJ'} as MonthSummary
    ]} as PersonSummary,
    {id:1,name:'Nome Anterior',cents:100,records:1,months:[
      {month:1,cents:100,records:1,held:false,ufStatus:'single',uf:'SP'} as MonthSummary
    ]} as PersonSummary
  ]} as SiteSummary;
  const current={publicationId:'current',scope:{months:[1,2,3]},totalCents:350,records:4,people:[
    {id:1,name:'Nome Atual',cents:350,records:4,months:[
      {month:1,cents:200,records:2,held:false,ufStatus:'single',uf:'SP'},
      {month:2,cents:150,records:2,held:false,ufStatus:'single',uf:'MG'},
      {month:3,cents:0,records:0,held:true,ufStatus:'single',uf:'RS'}
    ] as MonthSummary[]} as PersonSummary
  ]} as SiteSummary;
  return [{year:2024,summary:current},{year:2023,summary:prior}];
}

test('combines published years, counting only confirmed months toward state attribution',()=>{
  const years=fixture();
  const summary=buildLegislatureSummary(years);
  assert.deepEqual(summary,{
    schema:'clareia.legislature-summary.v1',
    yearsPresent:[2023,2024],
    yearsMissing:[2025,2026],
    years:[
      {year:2023,publicationId:'prior',months:years[1].summary.scope.months,partial:false},
      {year:2024,publicationId:'current',months:[1,2,3],partial:true}
    ],
    people:[
      {id:1,name:'Nome Atual',cents:450,records:5,partial:true,years:[
        {year:2023,cents:100,records:1,confirmedMonths:1,heldMonths:[],partial:false},
        {year:2024,cents:350,records:4,confirmedMonths:2,heldMonths:[3],partial:true}
      ]},
      {id:2,name:'Outra Pessoa',cents:25,records:1,partial:false,years:[
        {year:2023,cents:25,records:1,confirmedMonths:1,heldMonths:[],partial:false}
      ]}
    ],
    states:[
      {uf:'MG',cents:150,records:2,deputies:1,years:[{year:2024,cents:150,records:2}]},
      {uf:'SP',cents:300,records:3,deputies:1,years:[{year:2023,cents:100,records:1},{year:2024,cents:200,records:2}]}
    ],
    unattributed:{cents:25,records:1},totalCents:475,records:6
  });
});

test('rejects years outside the legislature and repeated years',()=>{
  const [entry]=fixture();
  assert.throws(()=>buildLegislatureSummary([{...entry,year:2022}]),/Ano fora da legislatura/);
  assert.throws(()=>buildLegislatureSummary([entry,entry]),/Ano repetido/);
});

test('rejects held months with cents or records',()=>{
  for(const field of ['cents','records'] as const){
    const years=fixture();
    years[0].summary.people[0].months[2][field]=1;
    assert.throws(()=>buildLegislatureSummary(years),/Competência retida/);
  }
});

test('rejects inconsistent people and state totals',()=>{
  const years=fixture();
  const {summary}=years[0];
  summary.totalCents++;
  assert.throws(()=>buildLegislatureSummary(years),/Soma dos deputados/);
  summary.totalCents--;
  for(const field of ['cents','records'] as const){
    summary.people[0].months[0][field]++;
    assert.throws(()=>buildLegislatureSummary(years),/Soma dos estados/);
    summary.people[0].months[0][field]--;
  }
});

test('rejects totals outside the safe integer range',()=>{
  const years=fixture();
  const {summary}=years[1];
  summary.totalCents=Number.MAX_SAFE_INTEGER;
  summary.people[1].cents=Number.MAX_SAFE_INTEGER-25;
  summary.people[1].months[0].cents=Number.MAX_SAFE_INTEGER-25;
  assert.throws(()=>buildLegislatureSummary(years),/precisão segura/);
});
