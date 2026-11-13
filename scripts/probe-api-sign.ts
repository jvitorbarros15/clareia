import fs from 'node:fs/promises';
import {probeApiSign} from '../src/api-sign-probe.ts';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
  console.log('npx tsx scripts/probe-api-sign.ts --live\nSonda somente leitura: 30 combinações fixas, intervalo de 700 ms e uma nova tentativa por falha. Requer autorização do João antes de consultar a API real. Salva apenas output/api-sign-probe.json.');
}else{
  if(args.length!==1||args[0]!=='--live')throw Error('Use --help; a consulta real exige --live e autorização prévia');
  const report=await probeApiSign();
  await fs.mkdir('output',{recursive:true});
  await fs.writeFile('output/api-sign-probe.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({requests:report.requests,years:report.years},null,2));
  if(report.years.some(year=>year.unavailable))process.exitCode=1;
}
