import {restoreState,saveState} from '../src/db-state.ts';
import {storeFromEnv} from '../src/object-store.ts';
import {vaultKey} from '../src/vault.ts';

const [action]=process.argv.slice(2),url=process.env.DATABASE_URL,store=storeFromEnv();
if(!url||!store)throw new Error('DATABASE_URL e R2_BUCKET são obrigatórios');
if(action==='restore')await restoreState(store,url,process.argv.includes('--bootstrap'),{key:vaultKey()});
else if(action==='save')console.log(await saveState(store,url,new Date(),{key:vaultKey()}));
else throw new Error('Uso: db-state restore|save');
