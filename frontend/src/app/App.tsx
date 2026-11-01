import {useCallback,useEffect,useRef,useState} from 'react';
import {fetchStatus,type ComponentName,type PlatformStatus} from '../shared/http';
import {Datasets} from '../features/datasets/Datasets';
import {Models} from '../features/models/Models';
import {Resources} from '../features/resources/Resources';
import {Training} from '../features/training';
import {Serving} from '../features/serving/Serving';
import {Overview} from '../features/overview/Overview';

const components:{id:ComponentName;label:string;description:string}[]=[
 {id:'api',label:'API',description:'控制面进程响应'},
 {id:'postgres',label:'PostgreSQL',description:'真实数据库查询'},
 {id:'minio',label:'MinIO',description:'已认证的存储桶检查'},
 {id:'worker',label:'Worker',description:'独立进程 HTTP 探针'},
];

function Icon({name}:{name:string}){
 const paths:Record<string,string>={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',data:'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',model:'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',compute:'M4 4h16v12H4z M8 20h8 M12 16v4',training:'M4 18l6-6 4 3 6-10 M14 5h6v6',chat:'M4 4h16v13H9l-5 4z M8 9h8 M8 13h5'};
 return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
function RefreshIcon(){return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 6M20 4v7h-7"/></svg>;}
function ChevronIcon(){return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>;}
function time(value?:string){return value?new Date(value).toLocaleTimeString('zh-CN',{hour12:false}):'尚未检查';}

function HealthBar({status,error}:{status:PlatformStatus|null;error:string}){
 const [open,setOpen]=useState(false);
 const states=components.map(component=>error?'stale':status?.components[component.id].state??'unknown');
 const upCount=states.filter(state=>state==='up').length;
 const healthy=!!status&&!error&&upCount===components.length&&status.ready;
 const title=error?'服务状态已过期':!status?'正在检查服务':healthy?'系统运行正常':'部分服务需要关注';
 const summary=error?'状态待确认':status?`${upCount} / ${components.length} 个服务响应正常`:'正在连接本地控制面';
 const checked=status?.checked_at;
 return <section className="system-health" aria-labelledby="system-health-title">
  <button type="button" className="system-health-toggle" aria-expanded={open} aria-controls="system-health-details" onClick={()=>setOpen(value=>!value)}>
   <span className="system-health-state"><i className={'health-dot '+(healthy?'ok':error?'stale':status?'warn':'loading')}/><span><strong id="system-health-title">{title}</strong><small>{summary}</small></span></span>
   <span className="system-service-list" aria-label="服务状态">{components.map((component,index)=><span className="system-service-chip" key={component.id}><i className={states[index]}/>{component.label}</span>)}</span>
   <span className="system-mobile-summary">{error?'状态待确认':status?`${upCount} / ${components.length} · ${status.ready?'已就绪':'未就绪'}`:'正在检查'}</span>
   <span className={'system-ready '+(healthy?'ok':'warn')}>{error?'等待重连':status?.ready?'依赖已就绪':'依赖未就绪'}</span>
   <span className="system-health-time">{time(checked)}</span>
   <span className={'system-health-chevron'+(open?' open':'')}><ChevronIcon/></span>
  </button>
  <div className="system-health-details" id="system-health-details" hidden={!open}>
   {components.map((component,index)=>{
    const item=status?.components[component.id];
    const state=states[index];
    return <div className="system-health-detail" key={component.id}><div><strong>{component.label}</strong><small>{state==='stale'?'已过期':item?item.duration_ms+' ms':'—'}</small></div><p>{state==='stale'?'等待重新连接，当前状态未知':item?.message??component.description}</p><time dateTime={item?.checked_at}>{time(item?.checked_at)}</time></div>;
   })}
  </div>
 </section>;
}

export function App(){
 const readPage=()=>['datasets','models','compute','training','serving'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
 const [page,setPage]=useState(readPage);
 useEffect(()=>{const update=()=>setPage(readPage());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 const [status,setStatus]=useState<PlatformStatus|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [refreshRevision,setRefreshRevision]=useState(0);
 const controller=useRef<AbortController|null>(null);
 const mounted=useRef(false);
 const refresh=useCallback(async()=>{
  if(controller.current)return;
  const request=new AbortController();
  controller.current=request;
  setBusy(true);
  const timer=window.setTimeout(()=>request.abort(),7000);
  try{
   const data=await fetchStatus(request.signal);
   if(mounted.current){setStatus(data);setError('');}
  }catch{
   if(mounted.current)setError('无法获取实时状态。请检查 API 服务与本地连接，然后重试。');
  }finally{
   clearTimeout(timer);
   if(controller.current===request)controller.current=null;
   if(mounted.current)setBusy(false);
  }
 },[ ]);
 useEffect(()=>{
  mounted.current=true;
  void refresh();
  const timer=window.setInterval(()=>void refresh(),5000);
  const focus=()=>void refresh();
  window.addEventListener('focus',focus);
  return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',focus);controller.current?.abort();controller.current=null;};
 },[refresh]);
 const allUp=status&&!error&&Object.values(status.components).every(item=>item.state==='up');
 const writable=!!status?.ready&&!error;
 const workerUp=status?.components.worker.state==='up'&&!error;
 const pageLabel=({overview:'工作台',datasets:'数据集',models:'模型',compute:'计算环境',training:'训练',serving:'推理试用'} as Record<string,string>)[page];
 const refreshAll=()=>{setRefreshRevision(value=>value+1);void refresh();};
 return <div className="app-shell">
  <a className="skip" href="#main" onClick={event=>{event.preventDefault();document.getElementById('main')?.focus();}}>跳到主要内容</a>
  <aside className="sidebar">
   <div className="brand"><span className="brand-mark">M</span><span>ModelForge<small>模型微调工作台</small></span></div>
   <nav className="primary-nav" aria-label="主导航">{[['overview','工作台','overview'],['datasets','数据集','data'],['models','模型','model'],['compute','计算环境','compute'],['training','训练','training'],['serving','推理试用','chat']].map(([id,label,icon])=><a key={id} href={'#'+id} className={'nav-item'+(page===id?' active':'')} aria-current={page===id?'page':undefined}><Icon name={icon}/>{label}</a>)}</nav>
   <div className="sidebar-foot"><i/><div>本地控制面<small>{error?'状态等待重新连接':status?.ready?'PostgreSQL · MinIO 已就绪':'正在检查依赖'}</small></div></div>
  </aside>
  <div className="workspace">
   <header className="topbar"><span>个人工作空间 <b>/</b> {pageLabel}</span><span className="environment">本机访问</span></header>
   <main id="main" tabIndex={-1}>
    {page==='datasets'?<Datasets writable={writable}/>:page==='models'?<Models writable={writable} workerUp={workerUp}/>:page==='compute'?<Resources/>:page==='training'?<Training/>:page==='serving'?<Serving/>:page!=='overview'?<><div className="page-heading"><div><h1>{pageLabel}</h1><p>此业务流程尚未接入，当前不能提交训练或申请 GPU。</p></div></div><section className="panel asset-form"><h2>等待真实执行能力接入</h2><p>后续按优云目录、资源租约、远程传输、训练产物与独立推理顺序实现。当前可以先准备数据集与模型资产。</p><div className="actions"><a className="button-link" href="#datasets">准备数据集</a><a className="button-link secondary" href="#models">管理模型</a></div></section></>:<>
     <div className="page-heading workspace-page-heading"><div><h1>工作台</h1><p>查看真实资产、最近训练结果与下一步可执行动作。</p></div><div className="workspace-heading-actions"><span className="workspace-last-update">最后更新 <strong>{time(status?.checked_at)}</strong></span><button className="workspace-refresh" type="button" onClick={refreshAll} disabled={busy}><RefreshIcon/>{busy?'刷新中':'刷新'}</button></div></div>
     {error&&<div className="notice error" role="alert"><strong>实时检查暂时中断</strong><p>{error}</p>{status&&<small>页面保留上次结果，已过期；不表示服务当前可用。</small>}</div>}
     <HealthBar status={status} error={error}/>
     <Overview refreshSignal={refreshRevision}/>
    </>}
    <footer><span>ModelForge · 个人本机工作台</span><span>正式数据持久化至 PostgreSQL / MinIO</span></footer>
   </main>
  </div>
 </div>;
}
