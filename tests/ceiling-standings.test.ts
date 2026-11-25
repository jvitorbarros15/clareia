import assert from 'node:assert/strict';
import test from 'node:test';
import {ceilingUse,ufStandings,type UseMonth} from '../src/ceiling-use.ts';

const ceiling={year:2025,byUf:{SP:[100000,100000],RR:[100000,100000]}};
const month=(cents:number,overrides:Partial<UseMonth>={}):UseMonth=>({
  month:1,cents,records:1,exercise:'full',held:false,ufStatus:'single',uf:'SP',...overrides
});

test('UF standings break ties on tenths by name and rank each state independently',()=>{
  const standings=ufStandings([
    {id:1,name:'Zélia',comparable:true,use:ceilingUse([month(50040)],ceiling,true)},
    {id:2,name:'Álvaro',comparable:true,use:ceilingUse([month(50010)],ceiling,true)},
    {id:3,name:'Bruno',comparable:true,use:ceilingUse([month(90000,{uf:'RR'})],ceiling,true)},
    {id:4,name:'Carla',comparable:true,use:ceilingUse([month(40000)],ceiling,true)}
  ]);
  assert.deepEqual(standings,new Map([
    [1,{uf:'SP',rank:2,total:3}],
    [2,{uf:'SP',rank:1,total:3}],
    [3,{uf:'RR',rank:1,total:1}],
    [4,{uf:'SP',rank:3,total:3}]
  ]));
});

test('UF standings exclude held, partial, unconfirmed and mixed-UF deputies from ranks and totals',()=>{
  const standings=ufStandings([
    {id:1,name:'Ana',comparable:true,use:ceilingUse([month(20000)],ceiling,true)},
    {id:2,name:'Bia',comparable:false,use:ceilingUse([month(90000),month(0,{month:2,held:true})],ceiling,true)},
    {id:3,name:'Caio',comparable:false,use:ceilingUse([month(90000),month(0,{month:2,exercise:'partial'})],ceiling,true)},
    {id:4,name:'Davi',comparable:true,use:ceilingUse([month(90000),month(90000,{month:2,ufStatus:'review'})],ceiling,true)},
    {id:5,name:'Eva',comparable:true,use:ceilingUse([month(90000),month(90000,{month:2,uf:'RR'})],ceiling,true)}
  ]);
  assert.deepEqual(standings,new Map([[1,{uf:'SP',rank:1,total:1}]]));
});
