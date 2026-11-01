import {api} from '../../shared/http.ts';

export type AdapterVersion={id:string;role:string;state:string;source_attempt_id:string;fingerprint:string;
  snapshot:{base:{id:string;fingerprint:string};dataset:{id:string;sha256:string}};
  metrics:Record<string,number>;manifest:unknown};

export async function listAdapters(signal?:AbortSignal,attemptId?:string):Promise<AdapterVersion[]>{
  const rows=new Map<string,AdapterVersion>();
  for(let offset=0;;offset+=200){
    const query=new URLSearchParams({offset:String(offset),limit:'200'});
    if(attemptId)query.set('attempt_id',attemptId);
    const page=await api<AdapterVersion[]>('/serving/adapters?'+query,{signal});
    for(const row of page)rows.set(row.id,row);
    if(page.length<200)return [...rows.values()];
  }
}
