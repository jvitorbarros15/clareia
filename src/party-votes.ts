import type {CoverageRow} from './people-publication.ts';
import type {Ballot,Vote} from './votes.ts';

export function selectKeyVotes(votes:readonly Vote[],keyIds:readonly string[]):Vote[]{
  const eligible=votes.filter(v=>!v.issues.length);
  if(keyIds.length){
    const byId=new Map(eligible.map(v=>[v.id,v]));
    return [...new Set(keyIds)].flatMap(id=>byId.get(id)??[]);
  }
  return eligible.filter(v=>v.organ==='PLEN'&&v.kind==='merito').sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,10);
}

export function buildPartyVotes(vote:Vote,ballots:readonly Ballot[],coverage:readonly CoverageRow[]){
  const year=Number(vote.date.slice(0,4)),month=Number(vote.date.slice(5,7));
  const monthlyCoverage=new Map(coverage.filter(r=>r.year===year&&r.month===month).map(r=>[r.personId,r]));
  const deputies=new Map<number,string|null>(),categories=new Set(['semVoto']);
  for(const [voteId,id,category] of ballots){
    if(voteId!==vote.id)continue;
    deputies.set(id,category);
    categories.add(category);
  }
  for(const [id,row] of monthlyCoverage){
    if((row.exercise==='full'||row.exercise==='partial')&&!deputies.has(id))deputies.set(id,null);
  }

  const emptyCounts=Object.fromEntries([...categories].map(category=>[category,0]));
  const byParty=new Map<string|null,{party:string|null;label:string;counts:Record<string,number>;deputies:{id:number;category:string|null}[]}>();
  for(const [id,category] of [...deputies].sort(([a],[b])=>a-b)){
    const covered=monthlyCoverage.get(id),party=covered?.partyStatus==='single'?covered.party:null;
    let row=byParty.get(party);
    if(!row){
      row={party,label:party??'Partido não confirmado',counts:{...emptyCounts},deputies:[]};
      byParty.set(party,row);
    }
    row.counts[category??'semVoto']++;
    row.deputies.push({id,category});
  }
  const rows=[...byParty.values()].sort((a,b)=>a.party===null?1:b.party===null?-1:a.party.localeCompare(b.party));
  const {declared}=vote,totals={yes:0,no:0,other:0};
  for(const {counts} of rows){
    for(const [category,count] of Object.entries(counts)){
      if(category!=='semVoto')totals[category==='Sim'?'yes':category==='Não'?'no':'other']+=count;
    }
  }
  const differences={yes:totals.yes-declared.yes,no:totals.no-declared.no,other:totals.other-declared.other};
  const matchesDeclared=Object.values(differences).every(n=>n===0);
  return {rows,declared,differences,matchesDeclared};
}
