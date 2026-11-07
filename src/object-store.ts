import {AwsClient} from 'aws4fetch';

export interface ObjectStore{put(key:string,body:Uint8Array):Promise<void>;get(key:string):Promise<Uint8Array|null>;list(prefix:string):Promise<string[]>;delete(key:string):Promise<void>}

export function memoryStore():ObjectStore{
  const items=new Map<string,Uint8Array>();
  return {
    put:async(key,body)=>{items.set(key,body);},
    get:async key=>items.get(key)??null,
    list:async prefix=>[...items.keys()].filter(key=>key.startsWith(prefix)),
    delete:async key=>{items.delete(key);}
  };
}
export function r2Store(env:NodeJS.ProcessEnv):ObjectStore{
  for(const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'])if(!env[name])throw new Error(`Falta ${name}`);
  const client=new AwsClient({accessKeyId:env.R2_ACCESS_KEY_ID as string,secretAccessKey:env.R2_SECRET_ACCESS_KEY as string,service:'s3',region:'auto'});
  const base=`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  const objectUrl=(key:string)=>`${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const call=async(url:string,init?:RequestInit,allowMissing=false)=>{
    const response=await client.fetch(url,init);
    if(!response.ok&&!(allowMissing&&response.status===404))throw new Error(`R2 respondeu ${response.status}`);
    return response;
  };
  return {
    put:async(key,body)=>{await call(objectUrl(key),{method:'PUT',body:body as BodyInit});},
    get:async key=>{const r=await call(objectUrl(key),undefined,true);return r.status===404?null:new Uint8Array(await r.arrayBuffer());},
    delete:async key=>{await call(objectUrl(key),{method:'DELETE'});},
    list:async prefix=>{
      const keys:string[]=[];let token:string|undefined;
      do{
        const query=new URLSearchParams({'list-type':'2',prefix});if(token)query.set('continuation-token',token);
        const xml=await (await call(`${base}?${query}`)).text();
        keys.push(...[...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(m=>m[1]));
        token=/<IsTruncated>true<\/IsTruncated>/.test(xml)?/<NextContinuationToken>([^<]*)</.exec(xml)?.[1]:undefined;
      }while(token);
      return keys;
    }
  };
}
export const storeFromEnv=(env:NodeJS.ProcessEnv=process.env):ObjectStore|null=>env.R2_BUCKET?r2Store(env):null;
