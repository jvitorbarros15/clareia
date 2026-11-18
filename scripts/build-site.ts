import {buildSite} from '../src/build-site.ts';
import {writeReview} from '../src/review-list.ts';
import {withLock} from '../src/lock.ts';
import {openDB} from '../src/store.ts';

await withLock(async()=>{
  const db=await openDB();
  try{const {review,partyReview,names,...built}=await buildSite(db,'dist','real/portraits');await writeReview(built.publicationId,review,names,partyReview);console.log(JSON.stringify({...built,ufPendencias:review.length,partidoPendencias:partyReview.length,nomesOcultados:names.withheld.length}));}finally{await db.close();}
});
