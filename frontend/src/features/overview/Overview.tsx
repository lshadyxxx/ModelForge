import {useEffect,useState} from 'react';
import {api} from '../../shared/http';
import {requestTrainingReuse} from '../training';

type Gpu={owner_kind?:string;owner_id?:string;provider_instance_id?:string;create_state?:string;instance_state?:string;process_state?:string;cleanup_state?:string;heartbeat_at?:string};
type Adapter={id:string;source_attempt_id:string;role:'best'|'final';state:string;metrics:Record<string,unknown>;created_at?:string};
type Training={
 id:string;name:string;number:number;state:string;stage:string;error_code?:string|null;created_at?:string;updated_at?:string;
 average_train_loss:number|null;eval_loss:number|null;step:number|null;loss_series:{step:number;loss:number}[];
 runtime:{gpu?:string;memory_bytes?:number;versions?:Record<string,string>;template?:string};
 config:{epochs?:number;learning_rate?:number;cutoff_len?:number;batch_size?:number;gradient_accumulation?:number;lora_rank?:number;lora_alpha?:number;lora_dropout?:number;scheduler?:string;warmup_ratio?:number;template?:string;seed?:number};
 instance:{region?:string;zone?:string;gpu_type?:string;cpu?:number;memory_mb?:number;image_id?:string;charge_type?:string;boot_disk_gb?:number;boot_disk_type?:string;cpu_platform?:string};
 dataset:{id?:string|null;name?:string|null;version_number?:number|null;sample_count?:number|null};
 base:{id?:string|null;name?:string|null;version_number?:number|null;source_kind?:string|null;compatibility_state?:string|null;model_type?:string|null};
};
type AttentionTraining={id:string;name:string;number:number;state:string;stage:string;error_code?:string|null;updated_at?:string};
type Trial={id:string;adapter_id:string;state:string;instance_id?:string|null;error_code?:string|null;request_state?:string;stop_requested?:boolean;created_at?:string;updated_at?:string};
type Activity={kind:'training'|'inference';id:string;label:string;name:string;state:string;detail:string;updated_at?:string};
type Summary={
 schema:1;datasets_published:number;models_available:number;adapters_available:number;gpu:Gpu|null;
 latest_training:Training|null;attention_training:AttentionTraining|null;latest_trial:Trial|null;
 attention_count:number;live_work_count:number;adapters:Adapter[];recent_activity:Activity[];
};

const labels:Record<string,string>={queued:'排队',waiting_instance:'等待实例',preparing:'准备中',running:'训练中',syncing:'同步产物',cleanup:'回收实例',succeeded:'已成功',failed:'已失败',cancelled:'已取消',blocked:'需要处理',ready:'推理可用',stopping:'停止中',stopped:'已结束'};
const errors:Record<string,string>={cloud_invalid_response:'云端响应校验未通过',runtime_exited:'推理进程已退出',request_state_unknown:'请求状态无法确认',instance_delete_failed:'实例删除未确认'};
const roleLabels:Record<string,string>={best:'Best',final:'Final'};

function stateBadge(state:string){
 const tone=['succeeded','ready'].includes(state)?'ok':['failed','blocked'].includes(state)?'bad':['running','preparing','syncing','cleanup','stopping','waiting_instance'].includes(state)?'warn':'neutral';
 return <span className={'badge '+tone}>{labels[state]??state}</span>;
}
function shortId(value?:string|null){return value?value.slice(0,8):'—';}
function loss(value:number|null|undefined){return value==null?'—':value.toFixed(4);}
function memory(value?:number){return value==null?'—':(value/1024**3).toFixed(1)+' GiB';}
function dateTime(value?:string){return value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace('/','-'):'—';}
function duration(start?:string,end?:string){
 if(!start||!end)return '—';
 const seconds=Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/1000));
 if(seconds<60)return seconds+' 秒';
 const minutes=Math.floor(seconds/60),rest=seconds%60;
 if(minutes<60)return minutes+' 分 '+rest+' 秒';
 return Math.floor(minutes/60)+' 小时 '+(minutes%60)+' 分';
}
function Arrow({size=14}:{size?:number}){
 return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
}
function Chevron(){
 return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>;
}
function WarningIcon(){
 return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 17H3L12 3zM12 9v5M12 17h.01"/></svg>;
}
function ActivityMark({kind}:{kind:'training'|'inference'}){
 return <span className={'activity-kind '+kind} aria-hidden="true">{kind==='training'?<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18l6-6 4 3 6-10M14 5h6v6"/></svg>:<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v13H9l-5 4 5-4M8 9h8M8 13h5"/></svg>}</span>;
}

function LossChart({series,evalLoss}:{series:{step:number;loss:number}[];evalLoss:number|null}){
 if(!series.length)return <div className="loss-chart empty-chart"><div className="chart-head"><strong>训练 Loss 走势</strong><span>尚无指标</span></div><p>训练产生第一批 Loss 后在此显示走势。</p></div>;
 const width=300,height=76,left=6,right=294,top=7,bottom=65;
 const values=series.map(point=>point.loss),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 const divisor=Math.max(1,series.length-1);
 const points=series.map((point,index)=>{
  const x=left+(right-left)*index/divisor;
  const y=top+(bottom-top)*(max-point.loss)/span;
  return {x,y};
 });
 const final=points[points.length-1];
 return <div className="loss-chart">
  <div className="chart-head"><strong>训练 Loss 走势</strong><span>{series.length} 个采样点{evalLoss!=null?' · eval '+evalLoss.toFixed(4):''}</span></div>
  <svg className="chart-svg" viewBox={'0 0 '+width+' '+height} role="img" aria-label={'训练 Loss 从第 '+series[0].step+' 步到第 '+series[series.length-1].step+' 步的走势'+(evalLoss!=null?('，验证 Loss '+evalLoss.toFixed(4)):'')}>
   <path className="chart-axis" d={'M6 18H294M6 40H294M6 62H294'} />
   <polyline className="chart-line" points={points.map(point=>point.x.toFixed(1)+','+point.y.toFixed(1)).join(' ')} />
   <circle className="chart-dot" cx={final.x} cy={final.y} r="3.2" />
  </svg>
 </div>;
}

function OverviewError({message}:{message:string}){
 return <section className="panel workspace-error" role="alert"><WarningIcon/><div><h2>业务汇总暂不可用</h2><p>{message}</p><button className="secondary" onClick={()=>location.reload()}>重新读取</button></div></section>;
}

export function Overview({refreshSignal=0}:{refreshSignal?:number}){
 const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();let pending=false;
  const refresh=async()=>{
   if(pending)return;
   pending=true;setRefreshing(true);
   try{setData(await api<Summary>('/overview',{signal:controller.signal}));setError('');}
   catch(reason){if(!controller.signal.aborted)setError((reason as Error).message);}
   finally{pending=false;if(!controller.signal.aborted)setRefreshing(false);}
  };
  void refresh();
  const timer=window.setInterval(()=>void refresh(),5000);
  return()=>{controller.abort();clearInterval(timer);};
 },[refreshSignal]);

 if(!data)return error?<OverviewError message={error}/>:<div className="workspace-loading" role="status"><span className="loading-dot"/><div><strong>正在读取工作台</strong><p>加载真实资产、训练结果和运行状态。</p></div></div>;

 const latest=data.latest_training;
 const latestAdapters=latest?data.adapters.filter(adapter=>adapter.source_attempt_id===latest.id&&adapter.state==='available'):[];
 const best=latestAdapters.find(adapter=>adapter.role==='best');
 const final=latestAdapters.find(adapter=>adapter.role==='final');
 const adapterSummary=best&&final?'Best / Final 已同步':latestAdapters.length?latestAdapters.map(adapter=>roleLabels[adapter.role]??adapter.role).join(' / ')+' 已同步':'尚未同步 Adapter';
 const gpuFree=!data.gpu;
 const attention=data.attention_training;
 const latestDataset=latest?.dataset.name??(latest?.dataset.id?'数据版本 '+shortId(latest.dataset.id):'未记录');
 const latestBase=latest?.base.name??(latest?.base.id?'模型版本 '+shortId(latest.base.id):'未记录');
 const primaryTarget=data.adapters_available>0?'serving':'training';

 return <div className="workspace-overview" aria-busy={refreshing}>
  {error&&<div className="notice error workspace-stale" role="alert"><strong>工作台刷新暂时中断</strong><p>{error}</p><small>下方保留上次读取结果，可能已过期。</small></div>}

  <section className="workspace-metrics" aria-label="工作台关键指标">
   <div className="workspace-metric"><span>已发布数据</span><strong>{data.datasets_published}</strong><small>可用于训练</small></div>
   <div className="workspace-metric"><span>基础模型</span><strong>{data.models_available}</strong><small>可用版本</small></div>
   <div className="workspace-metric"><span>可用 Adapter</span><strong>{data.adapters_available}</strong><small>已同步至正式存储</small></div>
   <div className="workspace-metric"><span>GPU 占用</span><strong className="text-value">{data.gpu?'租约持有中':'当前空闲'}</strong><small>{data.gpu?data.gpu.owner_kind==='attempt'?'训练正在占用':'推理正在占用':'没有运行中的资源租约'}</small></div>
   <div className={'workspace-metric'+(data.attention_count?' attention':'')}><span>待处理</span><strong>{data.attention_count}</strong><small>{attention?`Attempt #${attention.number} 需要检查`:data.attention_count?'存在阻塞任务':'没有失败或阻塞任务'}</small></div>
  </section>

  <div className="workspace-content-grid">
   <section className="panel workspace-training-panel" aria-labelledby="latest-training-title">
    <header className="workspace-panel-heading">
     <div><h2 id="latest-training-title">最近训练结果</h2><p>{latest?`Attempt #${latest.number} · ${latest.name}`:'完成一次文本 SFT + LoRA 训练后会显示真实结果。'}</p></div>
     {latest&&stateBadge(latest.state)}
    </header>
    {latest?<>
     <div className="workspace-training-body">
      <div className="workspace-training-summary">
       <div className="workspace-facts" aria-label="训练指标">
        <div><span>验证 Loss</span><strong>{loss(latest.eval_loss)}</strong></div>
        <div><span>平均训练 Loss</span><strong>{loss(latest.average_train_loss)}</strong></div>
        <div><span>最高 Step</span><strong>{latest.step??'—'}<small>{latest.step!=null?' step':''}</small></strong></div>
        <div><span>任务耗时</span><strong className="duration">{duration(latest.created_at,latest.updated_at)}</strong></div>
       </div>
       <LossChart series={latest.loss_series} evalLoss={latest.eval_loss}/>
      </div>
      <div className="workspace-runtime-row" aria-label="训练运行环境">
       <span>{latest.runtime.gpu??latest.instance.gpu_type??'GPU 未记录'}</span>
       <span>{memory(latest.runtime.memory_bytes)}</span>
       {latest.runtime.versions?.llamafactory&&<span>LLaMA-Factory {latest.runtime.versions.llamafactory}</span>}
       {latest.runtime.versions?.torch&&<span>Torch {latest.runtime.versions.torch}</span>}
       {latest.config.lora_rank!=null&&<span>LoRA rank {latest.config.lora_rank}</span>}
      </div>
     </div>
     {attention&&<div className="workspace-attention-row"><WarningIcon/><div><strong>Attempt #{attention.number} {labels[attention.state]??attention.state}</strong><span>{errors[attention.error_code??'']??attention.error_code??'该任务需要检查'}</span></div><a href="#training">查看原因<Chevron/></a></div>}
     <div className="workspace-training-context" aria-label="训练输入与产物">
      <div><span>训练数据</span><strong title={latestDataset}>{latestDataset}</strong><small>{latest.dataset.version_number!=null?'v'+latest.dataset.version_number+' · ':''}{latest.dataset.sample_count!=null?latest.dataset.sample_count+' samples':'版本信息待补充'}</small></div>
      <div><span>基座模型</span><strong title={latestBase}>{latestBase}</strong><small>{latest.base.model_type??latest.base.source_kind??'来源未记录'}{latest.base.version_number!=null?' · v'+latest.base.version_number:''}</small></div>
      <div><span>产物</span><strong>{adapterSummary}</strong><small>{latestAdapters.length?'可以继续推理试用':data.adapters_available?'其他 Attempt 的 Adapter 可试用':'训练成功后发布'}</small></div>
     </div>
    </>:<div className="workspace-empty-training"><div><strong>还没有训练结果</strong><p>先发布数据集并选择已验证的基础模型，再提交受控的文本 SFT + LoRA 训练。</p></div><a className="button-link" href="#training">创建训练</a></div>}
   </section>

   <aside className="panel workspace-next-panel" aria-labelledby="next-action-title">
    <header className="workspace-panel-heading"><div><h2 id="next-action-title">接下来</h2><p>根据真实资产与运行状态推荐</p></div><span className={'badge '+((data.adapters_available>0&&gpuFree)?'ok':'neutral')}>{data.adapters_available>0&&gpuFree?'可执行':'查看状态'}</span></header>
    <div className="workspace-next-body">
     <article className="workspace-primary-action">
      <span className="workspace-action-state"><i className={gpuFree?'available':'busy'}/>{gpuFree?'GPU 空闲':'GPU 租约中'}</span>
      <h3>{data.adapters_available>0?(gpuFree?'用 Adapter 开始推理':'等待当前资源释放'):'先完成一次可试用训练'}</h3>
      <p>{data.adapters_available>0?(gpuFree?`${data.adapters_available} 个 Adapter 已同步，可直接创建独立推理试用。`:'当前训练或推理仍持有租约。结束并确认资源释放后，再用 Adapter 开始试用。'):'完成训练并同步 Best/Final Adapter 后，就可以启动独立推理。'}</p>
      <a className="workspace-primary-link" href={'#'+primaryTarget}>{data.adapters_available>0?'开始推理试用':'准备训练'}<Arrow/></a>
     </article>
     {attention&&<a className="workspace-secondary-action attention" href="#training"><span className="workspace-action-icon"><WarningIcon/></span><span><strong>处理失败任务</strong><small>Attempt #{attention.number} · {errors[attention.error_code??'']??attention.error_code??'需要检查'}</small></span><Chevron/></a>}
     {latest&&<a className="workspace-secondary-action" href="#training" onClick={()=>requestTrainingReuse(latest.id)}><span className="workspace-action-icon training"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 18l6-6 4 3 6-10M14 5h6v6"/></svg></span><span><strong>复用 #{latest.number} 的配置</strong><small>数据集、基座、参数与实例规格保持不变</small></span><Chevron/></a>}
     <div className="workspace-capacity-note"><i className={gpuFree?'available':'busy'}/><span><strong>{gpuFree?'GPU 空闲':'GPU 已被占用'}</strong> · {gpuFree?'当前没有训练或推理占用':`由${data.gpu?.owner_kind==='attempt'?'训练':'推理'}租约持有`}</span></div>
    </div>
   </aside>
  </div>

  <section className="panel workspace-activity-panel" aria-labelledby="activity-title">
   <header className="workspace-panel-heading"><div><h2 id="activity-title">最近活动</h2><p>训练和推理任务按最后更新时间排列</p></div><a className="workspace-text-link" href="#training">查看全部<Chevron/></a></header>
   {data.recent_activity.length?<div className="workspace-activity-table"><table><thead><tr><th>任务</th><th>状态</th><th>关键信息</th><th>更新时间</th><th aria-label="打开"/></tr></thead><tbody>{data.recent_activity.map(item=><tr key={item.kind+item.id}>
    <td data-label="任务"><div className="workspace-activity-name"><ActivityMark kind={item.kind}/><span><strong>{item.label}</strong><small>{item.name}</small></span></div></td>
    <td data-label="状态">{stateBadge(item.state)}</td>
    <td data-label="关键信息"><span className="workspace-activity-detail">{item.detail}</span></td>
    <td data-label="更新时间"><time dateTime={item.updated_at}>{dateTime(item.updated_at)}</time></td>
    <td><a className="workspace-row-link" href={item.kind==='training'?'#training':'#serving'} aria-label={'打开 '+item.label}><Chevron/></a></td>
   </tr>)}</tbody></table></div>:<div className="workspace-activity-empty">还没有训练或推理活动。</div>}
  </section>
 </div>;
}
