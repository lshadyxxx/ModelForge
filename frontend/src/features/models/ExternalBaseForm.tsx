import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Failure } from '../../shared/assets';
import { api } from '../../shared/http';
import { directoryPath, matchesFilters, type Configuration, type Directory, type PublicModel, type Zone } from '../resources/api';

type Props = {busy: boolean; writable: boolean; onRegister: (name: string, region: string, path: string, directory: Directory<PublicModel> | null) => Promise<void>};

export function ExternalBaseForm({busy, writable, onRegister}: Props) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [directory, setDirectory] = useState<Directory<PublicModel> | null>(null);
  const [path, setPath] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function readRegions() {
    if (reading) return;
    setReading(true); setError(null); setDirectory(null); setPath('');
    const request = new AbortController(); active.current = request;
    try {
      const config = await api<Configuration>('/resources/ucloud/configuration', {signal:request.signal});
      if (!config.configured) throw new Error('优云凭据尚未配置，请先完成后端配置。');
      const zones = await api<Directory<Zone>>('/resources/ucloud/zones', {signal:request.signal});
      const values = [...new Set(zones.items.map(item => item.Region))];
      setRegions(values);
      setRegion(config.default_region && values.includes(config.default_region) ? config.default_region : values[0] ?? '');
      if (!values.length) throw new Error('当前没有可用地域，请稍后刷新。');
    } catch (error) {if (!request.signal.aborted) setError(error);}
    finally {if (!request.signal.aborted) setReading(false);}
  }
  async function readModels() {
    if (reading || !region) return;
    setReading(true); setError(null); setDirectory(null); setPath('');
    const request = new AbortController(); active.current = request;
    try {setDirectory(await api<Directory<PublicModel>>(directoryPath('models', {region}), {signal:request.signal}));}
    catch (error) {if (!request.signal.aborted) setError(error);}
    finally {if (!request.signal.aborted) setReading(false);}
  }
  const current = matchesFilters(directory, {Region:region});
  async function submit(event: FormEvent) {event.preventDefault(); await onRegister(name, region, path, directory);}
  return <section className="panel asset-form"><h2>登记优云公共基座</h2>
    <p className="muted">从实时公共目录选择外部只读引用，不复制权重。登记后保持待核对；未来执行通道须在实际实例上完整读取配置、tokenizer 和权重并固化指纹。</p>
    <Failure error={error}/>
    <form onSubmit={submit}><fieldset disabled={busy || reading}>
      <div className="actions"><button type="button" className="secondary" onClick={()=>void readRegions()}>读取 / 刷新优云地域</button></div>
      <div className="form-grid"><label>基座登记名称<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>公共模型地域<select required value={region} onChange={event=>{setRegion(event.target.value);setDirectory(null);setPath('');}}><option value="">请读取地域</option>{regions.map(value=><option key={value} value={value}>{value}</option>)}</select></label></div>
      <button type="button" className="secondary" disabled={!region} onClick={()=>void readModels()}>读取 / 刷新公共模型</button>
      <label>公共模型目录条目<select required disabled={!current} value={path} onChange={event=>setPath(event.target.value)}><option value="">请选择当前查询返回的条目</option>{current && directory?.items.map((item,index)=><option key={item.Path+index} value={item.Path}>{item.Name} · {item.Path}</option>)}</select></label>
      {reading && <p role="status">正在查询优云…</p>}
      {current && directory && <p className="muted">本次返回 {directory.items.length} 项 · {directory.fetched_at}。目录返回不代表完整目录、可挂载或训练兼容。</p>}
      <button type="submit" disabled={!writable || !current || !path || !name.trim()}>登记外部只读引用</button>
    </fieldset></form>
  </section>;
}
