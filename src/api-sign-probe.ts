import {z} from 'zod';
import {BASE} from './model.ts';

export const PROBE_IDS=[204554,204379,160976,178957,220593] as const;
export const PROBE_MONTHS=[1,6] as const;
export const PROBE_YEARS=[2024,2025,2026] as const;
const responseSchema=z.object({dados:z.array(z.object({tipoDespesa:z.string(),valorDocumento:z.number().finite(),valorGlosa:z.number().finite(),valorLiquido:z.number().finite()})),links:z.array(z.object({rel:z.string()}))});
type Dependencies={fetch:typeof fetch;wait:(ms:number)=>Promise<void>;now:()=>string};

// Only numeric aggregates leave this function. Never log or persist API payloads.
export async function probeApiSign(dependencies:Partial<Dependencies>={}){
  const request=dependencies.fetch??fetch,wait=dependencies.wait??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),now=dependencies.now??(()=>new Date().toISOString());
  let requests=0;
  const years=[];
  for(const year of PROBE_YEARS){
    const counts={year,combinations:0,successful:0,unavailable:0,paginated:0,nonAirRows:0,zeroGlosaRows:0,invertedRows:0,zeroDocumentMatches:0};
    for(const id of PROBE_IDS)for(const month of PROBE_MONTHS){
      counts.combinations++;
      const url=new URL(`${BASE}/deputados/${id}/despesas`);
      url.search=new URLSearchParams({ano:String(year),mes:String(month),itens:'100',pagina:'1'}).toString();
      let data:z.infer<typeof responseSchema>|undefined;
      for(let attempt=0;attempt<2;attempt++){
        if(requests)await wait(700);
        requests++;
        try{
          const response=await request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});
          if(!response.ok)throw Error('API unavailable');
          data=responseSchema.parse(await response.json());break;
        }catch{/* One retry; the report never includes raw payloads or error text. */}
      }
      if(!data){counts.unavailable++;continue;}
      counts.successful++;
      if(data.links.some(link=>link.rel==='next'))counts.paginated++;
      for(const row of data.dados){
        const category=row.tipoDespesa.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
        if(/AERE|AERONAV|SIGEPA/.test(category))continue;
        counts.nonAirRows++;
        if(row.valorGlosa!==0)continue;
        counts.zeroGlosaRows++;
        if(row.valorLiquido===-row.valorDocumento){
          counts.invertedRows++;
          if(row.valorDocumento===0)counts.zeroDocumentMatches++;
        }
      }
    }
    years.push(counts);
  }
  return {schema:'clareia.api-sign-probe.v1',checkedAt:now(),sample:{ids:PROBE_IDS,months:PROBE_MONTHS,years:PROBE_YEARS,page:1,items:100},requests,years,note:'Amostra da primeira página, sem paginação. invertedRows conta valorLiquido === -valorDocumento com valorGlosa = 0 em categorias não aéreas; zeroDocumentMatches identifica os casos de valor zero. Falhas não contam como ausência de despesas.'};
}
