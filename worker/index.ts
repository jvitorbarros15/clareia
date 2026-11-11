type Assets={fetch(request:Request):Promise<Response>};

const APP_ROUTE=/^\/(deputado\/[^/.]+|estado\/[A-Za-z]{2})\/?$/;

// Content-addressed files are immutable, but a missing one must never be cached under that rule.
export async function serveData(request:Request,assets:Assets):Promise<Response>{
  const response=await assets.fetch(request);
  if(response.status<400)return response;
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
// Only the app's own routes get the page; every other miss, data files included, stays a real 404.
export async function serve(request:Request,assets:Assets):Promise<Response>{
  const url=new URL(request.url);
  if((request.method==='GET'||request.method==='HEAD')&&APP_ROUTE.test(url.pathname))return assets.fetch(new Request(new URL('/',url),{method:request.method,headers:request.headers}));
  return serveData(request,assets);
}
export default {fetch:(request:Request,env:{ASSETS:Assets})=>serve(request,env.ASSETS)};
