import fs from 'node:fs/promises';
import path from 'node:path';
import type {DataSource} from './data.ts';

export function dirSource(root:string):DataSource{
  return {async json<T>(file:string){return JSON.parse(await fs.readFile(path.join(root,file),'utf8')) as T;}};
}
