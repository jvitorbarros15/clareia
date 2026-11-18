import {dataFolderId} from '../../src/build-site.ts';

const dir=process.argv[2];
if(!dir)throw new Error('Uso: folder-id <pasta>');
console.log(await dataFolderId(dir));
