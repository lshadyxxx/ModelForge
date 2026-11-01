const reuseAttemptKey='modelforge.training.reuse-attempt';

export function requestTrainingReuse(attemptId:string){
 try{sessionStorage.setItem(reuseAttemptKey,attemptId);}
 catch{/* The training page remains usable when browser storage is unavailable. */}
}

export function readTrainingReuseAttempt(){
 try{
  const attemptId=sessionStorage.getItem(reuseAttemptKey)??'';
  return attemptId;
 }catch{return '';}
}

export function clearTrainingReuseAttempt(attemptId:string){
 try{
  if(sessionStorage.getItem(reuseAttemptKey)===attemptId)sessionStorage.removeItem(reuseAttemptKey);
 }catch{/* Nothing else is required when browser storage is unavailable. */}
}
