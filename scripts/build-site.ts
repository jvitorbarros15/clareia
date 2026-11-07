import {buildSite} from '../src/build-site.ts';
import {withLock} from '../src/lock.ts';
import {openDB} from '../src/store.ts';

await withLock(async()=>{
  const db=await openDB();
  try{console.log(JSON.stringify(await buildSite(db,'dist','real/portraits')));}finally{await db.close();}
});
