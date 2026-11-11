import {createHash} from 'node:crypto';
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
export type R2Options={fetch?:typeof fetch;sleep?:(ms:number)=>Promise<void>};
const ATTEMPTS=7,BASE_MS=120000,BACKOFF_MS=500,BACKOFF_CAP_MS=30000,UNKNOWN_LENGTH=256*1024**2,PART_BYTES=16*1024**2;
const timeoutFor=(bytes:number)=>BASE_MS+Math.ceil(bytes/100);
export function r2Store(env:NodeJS.ProcessEnv,options:R2Options={}):ObjectStore{
  for(const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'])if(!env[name])throw new Error(`Falta ${name}`);
  const client=new AwsClient({accessKeyId:env.R2_ACCESS_KEY_ID as string,secretAccessKey:env.R2_SECRET_ACCESS_KEY as string,service:'s3',region:'auto',retries:0});
  const base=`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  const objectUrl=(key:string)=>`${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const sleep=options.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const call=async<T>(url:string,init:RequestInit|undefined,sent:number|null,read:(response:Response)=>Promise<T>,allowMissing=false):Promise<T|null>=>{
    for(let attempt=1;;attempt++){
      const controller=new AbortController(),arm=(ms:number)=>setTimeout(()=>controller.abort(),ms);
      let timer=arm(sent===null?BASE_MS:timeoutFor(sent)),failure:unknown,fatal:Error|undefined;
      try{
        const response=await (options.fetch??fetch)(await client.sign(url,{...init,signal:controller.signal}));
        if(response.ok){
          if(sent===null){const length=response.headers.get('content-length');clearTimeout(timer);timer=arm(timeoutFor(length===null?UNKNOWN_LENGTH:Number(length)));}
          return await read(response);
        }
        await response.body?.cancel();
        if(allowMissing&&response.status===404)return null;
        failure=new Error(`R2 respondeu ${response.status}`);
        if(response.status<500&&response.status!==429){fatal=failure as Error;throw fatal;}
      }catch(error){if(error===fatal)throw error;failure=error;}
      finally{clearTimeout(timer);}
      if(attempt===ATTEMPTS)throw new Error(`R2 falhou após ${ATTEMPTS} tentativas: ${init?.method??'GET'} ${url.split('?')[0]}: ${failure instanceof Error?failure.message:String(failure)}`,{cause:failure});
      await sleep(Math.random()*Math.min(BACKOFF_CAP_MS,BACKOFF_MS*2**(attempt-1)));
    }
  };
  const md5=(body:Uint8Array)=>createHash('md5').update(body).digest('base64');
  const send=(url:string,body:Uint8Array)=>call(url,{method:'PUT',body:body as BodyInit,headers:{'content-md5':md5(body)}},body.length,async response=>response.headers.get('etag'));
  return {
    put:async(key,body)=>{
      const url=objectUrl(key);
      if(body.length<=PART_BYTES){await send(url,body);return;}
      // A single large PUT is fully sent and then dropped by R2 without a response; parts are retried one by one.
      const created=await call(`${url}?uploads`,{method:'POST'},0,response=>response.text()) as string,upload=/<UploadId>([^<]+)<\/UploadId>/.exec(created)?.[1];
      if(!upload)throw new Error(`R2 não abriu o envio em partes: ${key}`);
      const at=(query:string)=>`${url}?uploadId=${encodeURIComponent(upload)}${query}`;
      try{
        const parts:string[]=[];
        for(let start=0;start<body.length;start+=PART_BYTES){
          const etag=await send(at(`&partNumber=${parts.length+1}`),body.subarray(start,start+PART_BYTES));
          if(!etag)throw new Error(`R2 não devolveu o ETag da parte ${parts.length+1}: ${key}`);
          parts.push(etag);
        }
        const xml=`<CompleteMultipartUpload>${parts.map((etag,i)=>`<Part><PartNumber>${i+1}</PartNumber><ETag>${etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
        const done=await call(at(''),{method:'POST',body:xml},xml.length,response=>response.text()) as string;
        if(!/<CompleteMultipartUploadResult/.test(done))throw new Error(`R2 não concluiu o envio em partes: ${key}`);
      }catch(error){await call(at(''),{method:'DELETE'},0,async()=>undefined).catch(()=>undefined);throw error;}
    },
    get:async key=>call(objectUrl(key),undefined,null,async response=>new Uint8Array(await response.arrayBuffer()),true),
    delete:async key=>{await call(objectUrl(key),{method:'DELETE'},0,async()=>undefined);},
    list:async prefix=>{
      const keys:string[]=[];let token:string|undefined;
      do{
        const query=new URLSearchParams({'list-type':'2',prefix});if(token)query.set('continuation-token',token);
        const xml=await call(`${base}?${query}`,undefined,0,response=>response.text()) as string;
        keys.push(...[...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(m=>m[1]));
        token=/<IsTruncated>true<\/IsTruncated>/.test(xml)?/<NextContinuationToken>([^<]*)</.exec(xml)?.[1]:undefined;
      }while(token);
      return keys;
    }
  };
}
export const storeFromEnv=(env:NodeJS.ProcessEnv=process.env):ObjectStore|null=>env.R2_BUCKET?r2Store(env):null;
