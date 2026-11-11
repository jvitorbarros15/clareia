type Assets={fetch(request:Request):Promise<Response>};

// Content-addressed files are immutable, but a missing one must never be cached under that rule.
export async function serveData(request:Request,assets:Assets):Promise<Response>{
  const response=await assets.fetch(request);
  if(response.status<400)return response;
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {fetch:(request:Request,env:{ASSETS:Assets})=>serveData(request,env.ASSETS)};
