import {useEffect,useRef} from 'react';
import type {InstanceSpec} from './InstanceFields';

const chargeLabels:Record<string,string>={Postpay:'后付费',Day:'按天',Month:'按月'};

export function ManualInstanceDialog({purpose,instance,busy,onCancel,onConfirm}:{
  purpose:'训练'|'独立推理';
  instance:InstanceSpec;
  busy:boolean;
  onCancel:()=>void;
  onConfirm:()=>void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    if(!element.open)element.showModal();
    return()=>{if(element.open)element.close();};
  },[]);
  return <dialog ref={dialog} className="manual-instance-dialog" aria-labelledby="manual-instance-title"
    onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
    <div className="manual-instance-heading"><span>收费资源确认</span><h2 id="manual-instance-title">请手动创建{purpose}实例</h2></div>
    <p>提交后平台只保存下列单 GPU 要求，不会调用优云创建接口，也不会自动购买或预留资源。请在优云控制台按此配置手动创建实例。</p>
    <dl>
      <dt>地域 / 可用区</dt><dd>{instance.region||'未选择'} / {instance.zone||'未选择'}</dd>
      <dt>GPU</dt><dd>{instance.gpu_type||'未选择'}</dd>
      <dt>CPU / 内存</dt><dd>{instance.cpu||'未选择'} 核 / {instance.memory_mb?instance.memory_mb/1024+' GiB':'未选择'}</dd>
      <dt>镜像</dt><dd><code>{instance.image_id||'未选择'}</code></dd>
      <dt>系统盘</dt><dd>{instance.boot_disk_gb} GB {instance.boot_disk_type}</dd>
      <dt>计费方式</dt><dd>{chargeLabels[instance.charge_type]??instance.charge_type}</dd>
    </dl>
    <p className="manual-instance-result">{purpose==='训练'
      ? '任务将进入“等待手动创建实例”。实例 Running 后回到训练详情填写实例 ID，并确认授权平台完成或取消后停止、删除该实例。'
      : '试用记录将进入“等待手动创建实例”。请创建一台独立于训练的新实例，Running 后回到试用详情填写实例 ID，并确认授权平台停止、删除该实例。'}</p>
    <div className="workflow-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>返回修改</button>
      <button type="button" disabled={busy} onClick={onConfirm}>我已理解，生成手动创建要求</button>
    </div>
  </dialog>;
}
