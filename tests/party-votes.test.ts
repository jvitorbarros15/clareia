import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPartyVotes,selectKeyVotes} from '../src/party-votes.ts';
import type {CoverageRow} from '../src/people-publication.ts';
import type {Ballot,Vote} from '../src/votes.ts';

const vote:Vote={id:'vote',date:'2025-02-03',organ:'PLEN',approved:'1',kind:'merito',description:'Aprovado o Projeto',objects:[],declared:{yes:2,no:1,other:3},observed:{},ballots:6,issues:[]};

test('empty key vote config selects the latest ten eligible votes with ties ordered by id',()=>{
  const eligible=Array.from({length:11},(_,i)=>({...vote,id:`vote-${i+10}`,date:`2025-02-${String(i+1).padStart(2,'0')}`}));
  const votes=[{...vote,id:'vote-99',date:eligible[10].date},...eligible,
    {...vote,id:'committee',date:'2025-03-01',organ:'CCJC'},
    {...vote,id:'procedural',date:'2025-03-01',kind:'requerimento' as const},
    {...vote,id:'held',date:'2025-03-01',issues:['empty-ballot']}];
  assert.deepEqual(selectKeyVotes(votes,[]).map(v=>v.id),['vote-20','vote-99','vote-19','vote-18','vote-17','vote-16','vote-15','vote-14','vote-13','vote-12']);
});

test('listed votes keep config order and skip unknown and held ids',()=>{
  const procedural={...vote,id:'procedural',organ:'CCJC',kind:'requerimento' as const};
  const held={...vote,id:'held',issues:['empty-ballot']};
  assert.deepEqual(selectKeyVotes([vote,held,procedural],['unknown','procedural','held','vote']),[procedural,vote]);
});

test('party vote rows join the vote month, count ballots and include eligible deputies without ballots',()=>{
  const row:CoverageRow={personId:1,year:2025,month:2,exercise:'full',partyStatus:'single',party:'PL',partyValues:[],ufStatus:'single',uf:'SP',review:false,partialScope:false};
  const coverage=[row,{...row,month:1,party:'PT'},
    {...row,personId:2,party:'PT',exercise:'partial'},
    {...row,personId:4,partyStatus:'review',review:true},
    {...row,personId:5,partyStatus:'changed'},
    {...row,personId:6,party:null},
    {...row,personId:7},
    {...row,personId:8,exercise:'outside'},
    {...row,personId:9,month:1},
    {...row,personId:10,year:2024}];
  const ballots:Ballot[]=[['vote',7,'Não'],['vote',6,'Obstrução'],['vote',5,'Outra'],['vote',4,'Abstenção'],['vote',3,'Sim'],['vote',1,'Sim'],['different',2,'Não']];
  assert.deepEqual(buildPartyVotes(vote,ballots,coverage),{
    rows:[
      {party:'PL',label:'PL',counts:{Sim:1,'Não':1,'Abstenção':0,'Obstrução':0,Outra:0,semVoto:0},deputies:[{id:1,category:'Sim'},{id:7,category:'Não'}]},
      {party:'PT',label:'PT',counts:{Sim:0,'Não':0,'Abstenção':0,'Obstrução':0,Outra:0,semVoto:1},deputies:[{id:2,category:null}]},
      {party:null,label:'Partido não confirmado',counts:{Sim:1,'Não':0,'Abstenção':1,'Obstrução':1,Outra:1,semVoto:0},deputies:[{id:3,category:'Sim'},{id:4,category:'Abstenção'},{id:5,category:'Outra'},{id:6,category:'Obstrução'}]}
    ],declared:vote.declared,differences:{yes:0,no:0,other:0},matchesDeclared:true
  });
});

test('a declared sum mismatch reports signed differences and retains the rows',()=>{
  const result=buildPartyVotes(vote,[['vote',1,'Sim'],['vote',2,'Sim'],['vote',3,'Sim'],['vote',4,'Não']],[]);
  assert.equal(result.matchesDeclared,false);
  assert.deepEqual(result.differences,{yes:1,no:0,other:-3});
  assert.deepEqual(result.rows[0].counts,{Sim:3,'Não':1,semVoto:0});
});
