import path from 'node:path';
import {backupTree,restoreTree,verifyBackup} from '../src/data-backup.ts';
import {storeFromEnv} from '../src/object-store.ts';
import {vaultKey} from '../src/vault.ts';

const [action,...args]=process.argv.slice(2),store=storeFromEnv();
const option=(name:string)=>{const at=args.indexOf(`--${name}`);return at>=0?args[at+1]:undefined;};
const name=option('name');
if(!store)throw new Error('R2_BUCKET é obrigatório');
if(!name||!/^[A-Za-z0-9][\w-]*$/.test(name))throw new Error('Informe --name com letras, números, hífen ou sublinhado, começando por letra ou número');
const prefix=`backups/${name}/`;
if(action==='backup'){
  const root=option('root');
  if(!root)throw new Error('Uso: backup-data backup --root <pasta> --name <nome>');
  const result=await backupTree(store,path.resolve(root),prefix,vaultKey());
  if(result.skipped.count)console.log(`Ignorados ${result.skipped.count} (worktrees, node_modules, links simbólicos): ${result.skipped.examples.join(', ')}${result.skipped.count>result.skipped.examples.length?', ...':''}`);
  console.log(JSON.stringify({files:result.files,uploaded:result.uploaded,alreadyStored:result.alreadyStored,bytesUploaded:result.bytesUploaded,manifest:result.manifest}));
}else if(action==='restore'){
  const to=option('to');
  if(!to)throw new Error('Uso: backup-data restore --name <nome> --to <pasta> [--at <data-hora>]');
  console.log(`${await restoreTree(store,prefix,path.resolve(to),vaultKey(),option('at'))} arquivos restaurados`);
}else if(action==='verify'){
  const result=await verifyBackup(store,prefix,vaultKey());
  console.log(`${result.manifest}: ${result.files} arquivos, ${result.objects} objetos, ${result.missing.length} ausentes`);
  if(result.missing.length)throw new Error(`Cópia incompleta, faltam objetos de: ${result.missing.slice(0,5).join(', ')}${result.missing.length>5?', ...':''}`);
}else throw new Error('Uso: backup-data backup|restore|verify');
