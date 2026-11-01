import {useEffect,useState} from 'react';
import {api} from '../../shared/http';
import {imageDirectoryQuery} from './api';

export type InstanceSpec={region:string;zone:string;gpu_type:string;cpu:number;memory_mb:number;image_id:string;cpu_platform:string;charge_type:string;boot_disk_gb:number;boot_disk_type:string};
type Zone={Region:string;Zone:string;Describe:string};
type Spec={Name:string;MachineSizes:{Gpu:number;Collection:{Cpu:number;Memory:number[];MinimalCpuPlatform:string[]}[]}[];Disks:{BootDisk:{Name:string;MinimalSize?:number}[]}[]};
type Image={CompShareImageId:string;Name:string};
type Directory<T>={items:T[];total:number};
export const emptyInstance:InstanceSpec={region:'',zone:'',gpu_type:'',cpu:0,memory_mb:0,image_id:'',cpu_platform:'Auto',charge_type:'Postpay',boot_disk_gb:100,boot_disk_type:'CLOUD_SSD'};
export function InstanceFields({value,onChange,disabled=false}:{value:InstanceSpec;onChange:(value:InstanceSpec)=>void;disabled?:boolean}){
 const [zones,setZones]=useState<Zone[]>([]),[specs,setSpecs]=useState<Spec[]>([]),[images,setImages]=useState<Image[]>([]),[error,setError]=useState('');
 const [imageType,setImageType]=useState('System'),[imageName,setImageName]=useState(''),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{const c=new AbortController();api<Directory<Zone>>('/resources/ucloud/zones',{signal:c.signal}).then(r=>{setZones(r.items);setError('');}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[]);
 useEffect(()=>{if(!value.region||!value.zone){setSpecs([]);return;}const c=new AbortController();setLoading(true);
 api<Directory<Spec>>('/resources/ucloud/specs?'+new URLSearchParams({region:value.region,zone:value.zone}),{signal:c.signal}).then(r=>{setSpecs(r.items);setError('');}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[value.region,value.zone]);
 useEffect(()=>{if(!value.region||!value.zone){setImages([]);return;}const c=new AbortController();setLoading(true);
 api<Directory<Image>>(imageDirectoryQuery(value.region,value.zone,imageName,imageType,offset,100).path,{signal:c.signal}).then(r=>{setImages(r.items);setTotal(r.total);setError('');}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[value.region,value.zone,imageType,imageName,offset]);
 const spec=specs.find(s=>s.Name===value.gpu_type);
 const sizes=(spec?.MachineSizes??[]).filter(s=>s.Gpu===1).flatMap(s=>s.Collection.flatMap(c=>c.Memory.map(memory=>({cpu:c.Cpu,memory_mb:memory*1024,platforms:c.MinimalCpuPlatform}))));
 return <fieldset disabled={disabled}><legend>单 GPU 实例要求</legend>{error&&<p role="alert" className="error-message">{error}</p>}
 <div className="form-grid">
 <label>地域<select required value={value.region} onChange={e=>{setOffset(0);onChange({...emptyInstance,region:e.target.value});}}><option value="">选择地域</option>{[...new Set(zones.map(z=>z.Region))].map(r=><option key={r}>{r}</option>)}</select></label>
 <label>可用区<select required value={value.zone} onChange={e=>{setOffset(0);onChange({...emptyInstance,region:value.region,zone:e.target.value});}}><option value="">选择可用区</option>{zones.filter(z=>z.Region===value.region).map(z=><option key={z.Zone} value={z.Zone}>{z.Describe} · {z.Zone}</option>)}</select></label>
 <label>GPU<select required value={value.gpu_type} onChange={e=>onChange({...value,gpu_type:e.target.value,cpu:0,memory_mb:0,cpu_platform:'Auto'})}><option value="">选择单卡规格</option>{specs.map(s=><option key={s.Name}>{s.Name}</option>)}</select></label>
 <label>CPU / 内存<select required value={value.cpu?value.cpu+':'+value.memory_mb:''} onChange={e=>{const [cpu,memory]=e.target.value.split(':').map(Number);onChange({...value,cpu,memory_mb:memory,cpu_platform:'Auto'});}}><option value="">选择资源组合</option>{sizes.map((s,i)=><option key={i} value={s.cpu+':'+s.memory_mb}>{s.cpu} 核 / {s.memory_mb/1024} GiB</option>)}</select></label>
 <label>CPU 平台<select value={value.cpu_platform} onChange={e=>onChange({...value,cpu_platform:e.target.value})}>{['Auto','Intel/Auto','Amd/Auto'].map(p=><option key={p}>{p}</option>)}</select></label>
 <label>镜像目录<select value={imageType} onChange={e=>{setImageType(e.target.value);setOffset(0);onChange({...value,image_id:''});}}><option value="System">系统镜像</option><option value="App">应用镜像</option></select></label>
 <label>筛选镜像<input value={imageName} onChange={e=>{setImageName(e.target.value);setOffset(0);onChange({...value,image_id:''});}} placeholder="按镜像名称筛选"/></label>
 <label>运行镜像<select required value={value.image_id} onChange={e=>onChange({...value,image_id:e.target.value})}><option value="">选择运行镜像</option>{images.map(i=><option key={i.CompShareImageId} value={i.CompShareImageId}>{i.Name}</option>)}</select></label>
 <label>系统盘（GB）<input required type="number" min="1" max="1000000" value={value.boot_disk_gb} onChange={e=>onChange({...value,boot_disk_gb:Number(e.target.value)})}/></label>
 <label>磁盘类型<select value={value.boot_disk_type} onChange={e=>onChange({...value,boot_disk_type:e.target.value})}><option>CLOUD_SSD</option><option>CLOUD_RSSD</option></select></label>
 <label>计费方式<select value={value.charge_type} onChange={e=>onChange({...value,charge_type:e.target.value})}><option value="Postpay">后付费</option><option value="Day">按天</option><option value="Month">按月</option></select></label>
 </div><div className="workflow-actions"><button type="button" className="secondary" disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>上一页镜像</button><span className="muted">镜像 {offset+1}–{offset+images.length} / {total}{loading?' · 正在查询':''}</span><button type="button" className="secondary" disabled={loading||offset+images.length>=total} onClick={()=>setOffset(offset+100)}>下一页镜像</button></div>
 <p className="muted">提交后保存这组要求；平台不会自动购买。镜像需预装兼容的训练或推理运行时，执行时记录实际版本并校验。</p></fieldset>;
}
