import {unzipSync} from 'fflate';

const ZIP_SIGNATURE=[0x50,0x4b,0x03,0x04];

export function assertArchive(bytes:Uint8Array,minimumBytes:number):void{
  if(bytes.length<minimumBytes||!ZIP_SIGNATURE.every((b,i)=>bytes[i]===b))throw new Error('Arquivo inválido: a fonte não entregou um zip completo');
  try{unzipSync(bytes,{filter:()=>false});}catch{throw new Error('Arquivo inválido: zip truncado ou corrompido');}
}
