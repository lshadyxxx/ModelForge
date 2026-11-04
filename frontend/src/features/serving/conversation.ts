export type Message = {role:'user'|'assistant';content:string;partial?:boolean};

// Partial output remains visible in the page but never becomes completed context.
export function requestMessages(messages:Message[]) {
  return messages.filter(m=>!m.partial&&m.content.length>0).map(({role,content})=>({role,content}));
}

export type SseFrame = {event:string;data:string};

// SSE does not guarantee chunk boundaries. The caller keeps `rest` between
// reader.read() calls and handles every complete frame returned here.
export function parseSseFrames(buffer:string):{frames:SseFrame[];rest:string}{
  const normalized=buffer.replace(/\r\n/g,'\n');
  const parts=normalized.split('\n\n');
  const rest=parts.pop()??'';
  const frames:SseFrame[]=[];
  for(const part of parts){
    if(!part.trim())continue;
    const lines=part.split('\n');
    const event=lines.find(line=>line.startsWith('event:'))?.slice(6).trim()||'message';
    const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    frames.push({event,data});
  }
  return {frames,rest};
}
