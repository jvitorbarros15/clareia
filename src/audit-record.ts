import {latestCheckedAt} from './site-headers.ts';

export function auditRecord<T extends object>(found:T,inputAudits:{checkedAt?:unknown}[],builtAt:string):Omit<T,'checkedAt'>&{checkedAt:string;builtAt:string}{
  return {...found,checkedAt:latestCheckedAt(inputAudits),builtAt};
}
