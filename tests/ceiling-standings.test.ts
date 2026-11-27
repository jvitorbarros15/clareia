import assert from 'node:assert/strict';
import test from 'node:test';
import {ceilingUse,ufStandings,type UseMonth} from '../src/ceiling-use.ts';
import {mixedCeiling2026} from './fixtures/cota-ceiling.ts';

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

test('UF standings with mixed 2026 ceiling leave February out on both sides',()=>{
  const c2026=mixedCeiling2026();
  const ana=ceilingUse([month(100000,{month:1}),month(9999999,{month:2}),month(200000,{month:3})],c2026,true);
  const bia=ceilingUse([month(200000,{month:1}),month(0,{month:2}),month(200000,{month:3})],c2026,true);
  assert.equal(ana.status,'ok');assert.equal(bia.status,'ok');
  const standings=ufStandings([
    {id:1,name:'Ana',comparable:true,use:ana},
    {id:2,name:'Bia',comparable:true,use:bia}
  ]);
  assert.deepEqual(standings,new Map([[2,{uf:'SP',rank:1,total:2}],[1,{uf:'SP',rank:2,total:2}]]));
});
