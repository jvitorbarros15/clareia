export type Version={id:string,previewUrl:string};

export function parseUpload(output:string):Version{
  const text=output.replace(/\x1b\[[0-9;]*m/g,'');
  const id=text.match(/Worker Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if(!id)throw new Error('A saída do wrangler versions upload não tem "Worker Version ID"');
  const previewUrl=text.match(/Version Preview URL:\s*(https:\/\/\S+)/i)?.[1];
  if(!previewUrl)throw new Error(`A versão ${id} foi enviada sem "Version Preview URL" e não foi promovida; nada mudou no ar`);
  return {id,previewUrl};
}

export async function publishVersion(steps:{upload:()=>Promise<string>,check:(previewUrl:string)=>Promise<string[]>,promote:(id:string)=>Promise<void>}):Promise<Version>{
  const version=parseUpload(await steps.upload());
  const failures=await steps.check(version.previewUrl);
  if(failures.length)throw new Error(`A versão ${version.id} NÃO passou na conferência em ${version.previewUrl} e não foi promovida; nada mudou no ar:\n${failures.map(f=>'  - '+f).join('\n')}`);
  await steps.promote(version.id);
  return version;
}
