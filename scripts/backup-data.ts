import path from 'node:path';
import {backupTree,restoreTree} from '../src/data-backup.ts';
import {storeFromEnv} from '../src/object-store.ts';
import {vaultKey} from '../src/vault.ts';

const [action,...args]=process.argv.slice(2),store=storeFromEnv();
const option=(name:string)=>{const at=args.indexOf(`--${name}`);return at>=0?args[at+1]:undefined;};
const name=option('name');
if(!store)throw new Error('R2_BUCKET é obrigatório');
if(!name||!/^[\w.-]+$/.test(name))throw new Error('Informe --name com letras, números, ponto, hífen ou sublinhado');
const prefix=`backups/${name}/`;
if(action==='backup'){
  const root=option('root');
  if(!root)throw new Error('Uso: backup-data backup --root <pasta> --name <nome>');
  const result=await backupTree(store,path.resolve(root),prefix,vaultKey());
  console.log(`${result.total} arquivos (${(result.bytes/1048576).toFixed(1)} MB): ${result.uploaded} enviados, ${result.skipped} já estavam na cópia`);
}else if(action==='restore'){
  const to=option('to');
  if(!to)throw new Error('Uso: backup-data restore --name <nome> --to <pasta>');
  console.log(`${await restoreTree(store,prefix,path.resolve(to),vaultKey())} arquivos restaurados`);
}else throw new Error('Uso: backup-data backup|restore');
