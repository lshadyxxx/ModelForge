import {useEffect,useState} from 'react';
import {listAdapters,type AdapterVersion} from './adapters';

export function AdapterAssets({attemptId}:{attemptId?:string}){
  const [rows,setRows]=useState<AdapterVersion[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();let pending=false;
    const refresh=async()=>{if(pending)return;pending=true;try{
      setRows(await listAdapters(controller.signal,attemptId));setError('');
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{pending=false;if(!controller.signal.aborted)setLoading(false);}};
    setRows([]);setLoading(true);void refresh();const timer=setInterval(()=>void refresh(),3000);
    return()=>{controller.abort();clearInterval(timer);};},[attemptId]);
  return <section className="detail-body"><h3>Best / Final 训练产物</h3>
    {error&&<p role="alert">{error}</p>}
    {loading?<p className="muted">正在读取产物…</p>:rows.length?rows.map(row=><article key={row.id}>
      <h4>{row.role==='best'?'Best':'Final'} · {row.state==='available'?'已同步可用':'同步中，暂不可试用'}</h4>
      <dl className="metadata"><dt>Adapter 版本</dt><dd>{row.id}</dd><dt>来源 Attempt</dt><dd>{row.source_attempt_id}</dd>
        <dt>基础模型版本</dt><dd>{row.snapshot.base.id}</dd><dt>基座指纹</dt><dd><code>{row.snapshot.base.fingerprint}</code></dd>
        <dt>数据集版本</dt><dd>{row.snapshot.dataset.id}</dd><dt>产物指纹</dt><dd><code>{row.fingerprint}</code></dd>
        <dt>验证 Loss</dt><dd>{row.metrics.eval_loss??'—'}</dd></dl>
      <details><summary>完整指标与文件清单</summary><pre>{JSON.stringify({metrics:row.metrics,files:row.manifest},null,2)}</pre></details>
      {row.state==='available'&&<a href="#serving">前往推理试用选择此版本</a>}
    </article>):<p className="muted">尚未生成 Best / Final。训练成功并完成校验回传后可试用。</p>}
  </section>;
}
