export type Message = {role:'user'|'assistant';content:string;partial?:boolean};

// Partial output remains visible in the page but never becomes completed context.
export function requestMessages(messages:Message[]) {
  return messages.filter(m=>!m.partial&&m.content.length>0).map(({role,content})=>({role,content}));
}
