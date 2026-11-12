type Assets={fetch(request:Request):Promise<Response>};

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
async function notFound(request:Request,assets:Assets):Promise<Response>{
  const page=await assets.fetch(new Request(new URL('/404',request.url)));
  return noStore(new Response(request.method==='HEAD'?null:page.body,{status:404,headers:page.headers}));
}
export async function serve(request:Request,assets:Assets):Promise<Response>{
  const url=new URL(request.url);
  if(url.protocol==='http:')return new Response(null,{status:301,headers:{Location:`https://${url.host}${url.pathname}${url.search}`}});
  if(url.pathname.startsWith('/data/'))return serveData(request,assets);
  const response=await assets.fetch(request);
  return response.status===404?notFound(request,assets):response;
}
export default {fetch:(request:Request,env:{ASSETS:Assets})=>serve(request,env.ASSETS)};
