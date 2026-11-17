import {buildSite} from '../src/build-site.ts';
import {writeReview} from '../src/review-list.ts';
import {withLock} from '../src/lock.ts';
import {openDB} from '../src/store.ts';

await withLock(async()=>{
  const db=await openDB();
  try{const {review,withheld,...built}=await buildSite(db,'dist','real/portraits');await writeReview(built.publicationId,review,withheld);console.log(JSON.stringify({...built,ufPendencias:review.length,nomesOcultados:withheld.length}));}finally{await db.close();}
});
