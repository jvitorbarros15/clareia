type Assets={fetch(request:Request):Promise<Response>};

const APP_ROUTE=/^\/(deputado\/[^/.]+|estado\/[A-Za-z]{2})\/?$/;

// Content-addressed files are immutable, but a missing one must never be cached under that rule.
export async function serveData(request:Request,assets:Assets):Promise<Response>{
  const response=await assets.fetch(request);
  if(response.status<400)return response;
  return noStore(response);
}
function noStore(response:Response):Response{
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function withAsset(request:Request,assets:Assets,path:string):Promise<Response>{
  const page=await assets.fetch(new Request(new URL(path,request.url)));
  return noStore(new Response(request.method==='HEAD'?null:page.body,{status:404,headers:page.headers}));
}
// The app corrects old slugs and lowercase UFs, or shows its own "não encontrado" message; the 404 keeps search engines from indexing it.
export async function serve(request:Request,assets:Assets):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname.startsWith('/data/'))return serveData(request,assets);
  const response=await assets.fetch(request);
  if(response.status!==404)return response;
  if((request.method==='GET'||request.method==='HEAD')&&APP_ROUTE.test(url.pathname))return withAsset(request,assets,'/');
  return withAsset(request,assets,'/404');
}
export default {fetch:(request:Request,env:{ASSETS:Assets})=>serve(request,env.ASSETS)};
