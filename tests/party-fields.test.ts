import test from 'node:test';
import assert from 'node:assert/strict';
import {partyFieldsOf} from '../src/site-summary.ts';
import type {MonthSummary} from '../src/site-summary.ts';

// The logic real/data.js and src/prerender.ts applied before the build published it.
function oldRule(months:MonthSummary[],coverageId:string|null,current:string|null,note:string|null|undefined){
  const partyOfPeriod=()=>{
    if(!coverageId)return current?(note?current:`${current} (atual)`):null;
    const served=months.filter(m=>m.partyStatus!=='not-applicable');
    const doubt=served.some(m=>m.partyStatus==='review'||m.partyStatus==='conflict');
    if(!served.length||served.some(m=>m.partyStatus==='unavailable'||m.partyStatus==='unknown'))return note&&current&&!doubt?current:'Partido indisponível';
    if(doubt)return 'Partido em revisão';
    return [...new Set(served.flatMap(m=>m.party?[m.party]:m.partyValues))].join(' / ');
  };
  const party=partyOfPeriod();
  const last=[...months].filter(m=>m.partyStatus==='single'&&m.party).sort((a,b)=>b.month-a.month)[0]?.party??null;
  return {party,partyNote:current&&party===current&&!months.some(m=>m.partyStatus==='single')?note??null:null,partyInReview:party==='Partido em revisão',lastConfirmedParty:last};
}
const m=(month:number,partyStatus:string,party:string|null=null,partyValues:string[]=[]):MonthSummary=>({month,cents:0,records:0,exercise:null,exerciseReview:false,partyStatus,party,partyValues,ufStatus:'single',uf:'SP',held:false});
const check=(months:MonthSummary[],coverageId:string|null,current:string|null,note:string|null|undefined)=>{
  const got=partyFieldsOf(months,coverageId,current,note);
  assert.deepEqual(got,oldRule(months,coverageId,current,note));
  return got;
};

test('party fields match the old browser rule on every edge case',()=>{
  assert.equal(check([],null,null,null).party,null);
  assert.equal(check([m(1,'single','PL')],null,'PL',null).party,'PL (atual)');
  assert.equal(check([],null,'PL','eventos').partyNote,'eventos');
  const un=[m(1,'unavailable'),m(2,'unknown')];
  assert.equal(check(un,'c','PL','eventos').party,'PL');
  assert.equal(check(un,'c','PL','eventos').partyNote,'eventos');
  assert.equal(check(un,'c','PL',null).party,'Partido indisponível');
  assert.equal(check(un,'c',null,'eventos').party,'Partido indisponível');
  assert.equal(check([m(1,'unavailable'),m(2,'review')],'c','PL','eventos').party,'Partido indisponível');
  assert.equal(check([m(1,'unavailable'),m(2,'conflict')],'c','PL','eventos').partyInReview,false);
  assert.equal(check([m(1,'single','PL'),m(2,'review')],'c','PL','eventos').partyInReview,true);
  assert.equal(check([m(1,'single','PL'),m(2,'conflict')],'c','PL',null).lastConfirmedParty,'PL');
  assert.equal(check([m(1,'single','PL'),m(2,'single','PT')],'c','PL',null).party,'PL / PT');
  assert.equal(check([m(1,'single','PL'),m(2,'single','PL')],'c','PL','eventos').partyNote,null);
  assert.equal(check([m(1,'single','PL'),m(2,'changed',null,['PL','PT'])],'c','PL',null).party,'PL / PT');
  assert.equal(check([m(1,'not-applicable'),m(2,'single','PT')],'c','PT',null).party,'PT');
  assert.equal(check([m(1,'not-applicable')],'c','PT','eventos').party,'PT');
  assert.equal(check([m(1,'not-applicable')],'c',null,null).party,'Partido indisponível');
  assert.equal(check([m(3,'single','PL'),m(1,'single','PT'),m(2,'single',null)],'c','PL',null).lastConfirmedParty,'PL');
  assert.equal(check([m(1,'unavailable'),m(2,'single','PL')],'c','PL','eventos').partyNote,null);
});
