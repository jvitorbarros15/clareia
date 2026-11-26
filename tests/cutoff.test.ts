import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffLine} from '../src/view.ts';
import {renderDeputy,renderState,type Deputy,type Period} from '../src/prerender.ts';

const collectedAt='2025-03-01T15:00:00Z';
const collected='Dados até março de 2025 · coletados em 01/03/2025';
const missing='Dados até março de 2025 · data de coleta não informada';

test('cutoff line uses the largest published month and reports missing dates or months',()=>{
  assert.equal(cutoffLine([1,2,3],2025,collectedAt),collected);
  assert.equal(cutoffLine([3,1,2],2025,collectedAt),collected);
  for(const value of [null,undefined,'','lixo'])assert.equal(cutoffLine([1,2,3],2025,value),missing);
  assert.equal(cutoffLine([],2025,collectedAt),'Dados sem mês informado · coletados em 01/03/2025');
  assert.equal(cutoffLine([],2025,null),'Dados sem mês informado · data de coleta não informada');
});

test('cutoff line uses São Paulo time independently of the system clock and time zone',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-06-01T00:00:00Z')});
  const tz=process.env.TZ;
  try{
    for(const zone of ['UTC','Asia/Tokyo']){
      process.env.TZ=zone;
      for(const now of ['2026-06-01T00:00:00Z','2027-10-01T00:00:00Z']){
        t.mock.timers.setTime(Date.parse(now));
        assert.equal(cutoffLine([1,2,3],2025,'2025-03-02T01:00:00Z'),collected);
        assert.equal(cutoffLine([1,2,3],2025,'2025-03-02T01:00:00'),collected);
      }
    }
  }finally{
    if(tz===undefined)delete process.env.TZ;
    else process.env.TZ=tz;
  }
});

test('deputy and state noscript show the period collection date or the fallback',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-06-01T12:00:00Z')});
  const shell='<title>Clareia</title><meta name="description" content="Clareia"><noscript>Clareia</noscript>';
  const site='https://example.test';
  const deputy:Deputy={id:1,name:'Maria da Silva',uf:'SP',ufNote:null,party:null,partyNote:null,partyInReview:false,lastConfirmedParty:null,sourceUrl:'',exercisedMonths:3,noExercise:false,heldMonths:[],exerciseReviewMonths:[],comparable:true,cents:100,hasCells:true,projects:null};
  const period:Period={year:'2025',coverage:[0,1,2],minMonths:3};
  const withCollection={...period,collectedAt};
  for(const [html,expected] of [
    [renderDeputy(shell,deputy,withCollection,site,null),collected],
    [renderState(shell,'SP',[deputy],withCollection,site),collected],
    [renderDeputy(shell,deputy,period,site,null),missing],
    [renderState(shell,'SP',[deputy],period,site),missing],
  ]){
    const noscript=/<noscript>(.*?)<\/noscript>/.exec(html)?.[1];
    assert.ok(noscript?.includes(`<p class="cutoff">${expected}</p>`));
  }
});
