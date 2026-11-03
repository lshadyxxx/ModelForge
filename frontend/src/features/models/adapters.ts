import {api} from '../../shared/http.ts';

export type AdapterVersion={id:string;role:string;state:string;source_attempt_id:string;fingerprint:string;created_at?:string;
  snapshot:{base:{id:string;fingerprint:string};dataset:{id:string;sha256:string};
    config?:{template?:string;cutoff_len?:number;lora_rank?:number};
    compatibility?:{baseline_id?:string;baseline_sha256?:string;model_fingerprint?:string}};
  metrics:Record<string,number>;manifest:unknown};

export function adapterDownloadUrl(identifier:string):string{
  return '/api/v1/serving/adapters/'+encodeURIComponent(identifier)+'/download';
}

export function latestAdapterPair(rows:AdapterVersion[],baseVersionId:string):AdapterVersion[]{
  const matching=rows.filter(row=>row.snapshot.base.id===baseVersionId);
  if(!matching.length)return [];
  const latest=[...matching].sort((left,right)=>
    new Date(right.created_at??0).getTime()-new Date(left.created_at??0).getTime(),
  )[0];
  const roles=new Map<string,AdapterVersion>();
  for(const row of matching.filter(item=>item.source_attempt_id===latest.source_attempt_id)){
    if(!roles.has(row.role))roles.set(row.role,row);
  }
  return ['best','final'].flatMap(role=>roles.get(role)?[roles.get(role)!]:[]);
}

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
