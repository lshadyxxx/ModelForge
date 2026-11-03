import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, json } from '../../shared/http';
import { Badge, date, Empty, Failure } from '../../shared/assets';
import { ComputeWorkbench } from './compute/ComputeWorkbench';
import { DEFAULT_IMAGE_TYPE, directoryPath, fetchDirectory, imageDirectoryQuery, matchesFilters, type Capacity, type Configuration, type Directory, type Image, type PublicModel, type Specification, type Zone } from './api';

const DevComputePrototype = import.meta.env.DEV
  ? lazy(() => import('./ComputeEnvironmentPrototype').then(module => ({default: module.ComputeEnvironmentPrototype})))
  : null;
const DevComputeFixture = import.meta.env.DEV
  ? lazy(() => import('./compute/ComputeFixturePreview').then(module => ({default: module.ComputeFixturePreview})))
  : null;

function useDirectory<T>() {
  const [data, setData] = useState<Directory<T> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; active.current?.abort();};}, []);
  const read = useCallback(async (path: string, body?: unknown) => {
    active.current?.abort();
    const request = new AbortController(); active.current = request;
    setBusy(true); setError(null);
    const timer = setTimeout(() => request.abort(), 25000);
    try {
      const result = body === undefined ? await fetchDirectory<T>(path, request.signal) : await api<Directory<T>>(path, {...json('POST', body), signal: request.signal});
      if (mounted.current && active.current === request) setData(result);
    } catch (e) {
      if (mounted.current && active.current === request) setError(e instanceof DOMException && e.name === 'AbortError' ? new Error('查询超时或已停止，请重试。') : e);
    } finally {
      clearTimeout(timer);
      if (active.current === request) {active.current = null; if (mounted.current) setBusy(false);}
    }
  }, []);
  return {data, error, busy, read};
}

type ResultState<T> = ReturnType<typeof useDirectory<T>>;
function DirectoryPanel<T>({title, result, fresh, children}: {title: string; result: ResultState<T>; fresh: boolean; children: ReactNode}) {
  return <section className="panel asset-list"><div className="section-heading"><div><h2>{title}</h2><p>{result.busy ? '正在从优云查询…' : result.error ? '本次查询失败；已有结果仅供参考' : result.data ? '查询时间：' + date(result.data.fetched_at) : '尚未查询'}{result.data && ' · ' + result.data.total + ' 项'}</p></div><Badge label={result.data ? fresh && !result.error && !result.busy ? '查询快照' : '上次结果，可能已过期' : '未读取'}/></div>
    <div className="detail-body"><Failure error={result.error}/>{!result.data ? <p className="muted">{result.error ? '请重试查询；未使用演示数据。' : '选择条件后查询。'}</p> : result.busy ? <p className="muted">正在查询，完成前保留上次快照。</p> : result.error ? <p className="muted">本次查询失败，上次快照仅供参考；请重试。</p> : !fresh ? <p className="muted">当前查询条件与结果快照不一致；请重新查询后再使用结果。</p> : result.data.items.length === 0 ? <Empty>{result.data.total === 0 ? '本次条件下目录为空。' : '当前页没有结果，请返回上一页。'}</Empty> : children}</div></section>;
}

export function Resources() {
  const query = new URLSearchParams(location.search);
  const legacy = query.get('compute') === 'legacy';
  const prototype = import.meta.env.DEV && query.get('prototype') === 'compute';
  const fixture = import.meta.env.DEV && query.get('computeFixture') === 'states';
  if (prototype && DevComputePrototype) return <Suspense fallback={<p className="muted">正在加载设计预览…</p>}><DevComputePrototype /></Suspense>;
  if (fixture && DevComputeFixture) return <Suspense fallback={<p className="muted">正在加载开发夹具…</p>}><DevComputeFixture /></Suspense>;
  return legacy ? <ResourcesDirectory /> : <ComputeWorkbench />;
}

function ResourcesDirectory() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [configError, setConfigError] = useState<unknown>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [region, setRegion] = useState('');
  const [zone, setZone] = useState('');
  const [gpuFilter, setGpuFilter] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageType, setImageType] = useState(DEFAULT_IMAGE_TYPE);
  const [modelName, setModelName] = useState('');
  const [modelTag, setModelTag] = useState('');
  const [gpu, setGpu] = useState('');
  const [image, setImage] = useState('');
  const [platform, setPlatform] = useState('');
  const [charge, setCharge] = useState('');
  const [diskType, setDiskType] = useState('');
  const [diskSize, setDiskSize] = useState('');
  const zones = useDirectory<Zone>();
  const specs = useDirectory<Specification>();
  const images = useDirectory<Image>();
  const models = useDirectory<PublicModel>();
  const capacity = useDirectory<Capacity>();
  const configRequest = useRef<AbortController | null>(null);
  const readConfig = useCallback(async () => {
    configRequest.current?.abort(); const request = new AbortController(); configRequest.current = request;
    setConfigBusy(true); setConfigError(null);
    try {const result = await api<Configuration>('/resources/ucloud/configuration', {signal: request.signal}); if (!request.signal.aborted) {setConfig(result); setRegion(value => value || result.default_region || '');}}
    catch(e) {if (!request.signal.aborted) setConfigError(e);}
    finally {if (configRequest.current === request) {configRequest.current = null; setConfigBusy(false);}}
  }, []);
  useEffect(() => {void readConfig(); return () => configRequest.current?.abort();}, [readConfig]);
  const allowed = config?.configured === true && !configError && !configBusy;
  const regionReady = allowed && !!region;
  const regions = [...new Set(zones.data?.items.map(item => item.Region) ?? [])];
  const zoneOptions = zones.data?.items.filter(item => item.Region === region) ?? [];
  const specFilters = {Region: region, ...(zone ? {Zone: zone} : {}), ...(gpuFilter.trim() ? {MachineTypes: [gpuFilter.trim()]} : {}), InstanceType: 'uhost'};
  const imageQuery = imageDirectoryQuery(region, zone, imageName.trim(), imageType);
  const imageFilters = imageQuery.filters;
  const modelFilters = {Region: region, ...(modelName.trim() ? {name: modelName.trim()} : {}), ...(modelTag.trim() ? {tags: modelTag.trim()} : {})};
  const specsCurrent = regionReady && !specs.error && !specs.busy && matchesFilters(specs.data, specFilters);
  const imagesCurrent = regionReady && !images.error && !images.busy && matchesFilters(images.data, imageFilters, ['Offset']);
  const modelsCurrent = regionReady && !models.error && !models.busy && matchesFilters(models.data, modelFilters);
  const specOptions = specsCurrent ? specs.data?.items.filter(item => (!zone || item.Zone === zone) && item.MachineSizes.some(size => size.Gpu === 1)) ?? [] : [];
  const imageOptions = imagesCurrent ? images.data?.items ?? [] : [];
  const selectedSpec = specOptions.find(item => item.Name === gpu);
  const platforms = selectedSpec ? ['Auto', ...Object.keys(selectedSpec.CpuPlatforms).filter(vendor => ['Intel', 'Amd'].includes(vendor)).map(vendor => vendor + '/Auto')] : [];
  const diskTypes = selectedSpec?.Disks.flatMap(group => group.BootDisk) ?? [];
  const selectedDisk = diskTypes.find(item => item.Name === diskType);
  const imageOffset = Number(images.data?.filters.Offset ?? 0);
  const refreshImages = (offset = 0) => images.read(imageDirectoryQuery(region, zone, imageName.trim(), imageType, offset).path);
  const capacityReady = regionReady && !!zone && !!selectedSpec && imageOptions.some(item => item.CompShareImageId === image) && platforms.includes(platform) && !!charge && !!selectedDisk && Number.isInteger(Number(diskSize)) && Number(diskSize) >= Math.max(1, selectedDisk.MinimalSize ?? 1) && Number(diskSize) <= (selectedDisk.MaximalSize ?? 1_000_000);
  const capacityFilters = {Region: region, Zone: zone, GpuType: gpu, MachineType: 'G', MinimalCpuPlatform: platform, CompShareImageId: image, ChargeType: charge, Disks: [{IsBoot: true, Type: diskType, Size: Number(diskSize)}]};
  const capacityCurrent = capacityReady && !capacity.error && !capacity.busy && matchesFilters(capacity.data, capacityFilters);
  return <>
    <div className="page-heading"><div><h1>计算环境</h1><p>查询优云真实目录与库存快照；当前仅开放查询。</p></div><button className="secondary" disabled={configBusy} onClick={() => void readConfig()}>刷新配置状态</button></div>
    <Failure error={configError}/>
    <section className="panel asset-form"><h2>优云连接与查询范围</h2><p className="muted">{configBusy ? '正在读取后端配置…' : configError ? '配置状态未知，请刷新。' : config?.configured ? '后端已配置凭据。每次查询仍需由优云核验权限和有效性。' : '尚未配置优云凭据。请在后端环境中设置 MF_UCLOUD_PUBLIC_KEY 与 MF_UCLOUD_PRIVATE_KEY，再重建 API；此页面不收集密钥。'}</p>
      <div className="actions"><button disabled={!allowed || zones.busy} onClick={() => void zones.read('/resources/ucloud/zones')}>{zones.busy ? '查询中…' : '刷新地域与可用区'}</button></div>
      <div className="form-grid"><label>地域<select value={region} disabled={!allowed || !zones.data} onChange={event => {setRegion(event.target.value);setZone('');setGpu('');setImage('');setPlatform('');}}><option value="">请选择地域</option>{regions.map(item => <option key={item}>{item}</option>)}</select></label><label>可用区<select value={zone} disabled={!regionReady} onChange={event => {setZone(event.target.value);setGpu('');setImage('');setPlatform('');}}><option value="">全部可用区（库存查询需选定）</option>{zoneOptions.map(item => <option key={item.Zone} value={item.Zone}>{item.Describe} · {item.Zone}{item.IsPod ? ' · 容器' : ' · 云主机'}</option>)}</select></label></div>
      <p className="muted">目录可见、库存可用和训练兼容分别核对。当前兼容性均未验证，库存快照不保留资源；不会创建实例或产生租卡操作。</p></section>
    <DirectoryPanel title="地域与可用区" result={zones} fresh={!zones.error && !zones.busy && matchesFilters(zones.data, {})}><div className="table-scroll"><table><thead><tr><th>地域</th><th>可用区</th><th>类型</th></tr></thead><tbody>{zones.data?.items.map(item => <tr key={item.Zone}><td>{item.Region}</td><td>{item.Describe}<small>{item.Zone}</small></td><td>{item.IsPod ? '容器' : '云主机'}</td></tr>)}</tbody></table></div></DirectoryPanel>
    <section className="panel asset-form"><h2>查询 GPU 规格</h2><div className="form-grid"><label>GPU 型号筛选<input value={gpuFilter} maxLength={120} onChange={e => setGpuFilter(e.target.value)} placeholder="可留空，不预设型号"/></label></div><button disabled={!regionReady || specs.busy} onClick={() => void specs.read(directoryPath('specs', {region, zone, gpu_type: gpuFilter.trim()}))}>刷新 GPU 规格</button></section>
    <DirectoryPanel title="GPU 与 CPU / 内存组合" result={specs} fresh={specsCurrent}><p className="muted">结果地域：{String(specs.data?.filters.Region)} · 可用区：{String(specs.data?.filters.Zone ?? '全部')}。显示首版单卡组合；内存单位为 GB。</p><div className="table-scroll"><table><thead><tr><th>GPU / 可用区</th><th>显存</th><th>目录售卖状态</th><th>单卡 CPU / 内存</th></tr></thead><tbody>{specs.data?.items.map(item => <tr key={item.Name + item.Zone}><td>{item.Name}<small>{item.Zone}</small></td><td>{item.GraphicsMemory.Value} GB</td><td>{item.Status === 'SoldOut' ? '售罄' : item.Status === 'Normal' ? '可售，仍须查库存' : item.Status}</td><td>{item.MachineSizes.filter(size => size.Gpu === 1).flatMap(size => size.Collection.map((combo, index) => <p key={index}>{combo.Cpu} CPU · {combo.Memory.join(' / ')} GB</p>))}</td></tr>)}</tbody></table></div></DirectoryPanel>
    <section className="panel asset-form"><h2>查询平台镜像</h2><div className="form-grid"><label>名称筛选<input value={imageName} maxLength={120} onChange={e => setImageName(e.target.value)}/></label><label>镜像类型<select value={imageType} onChange={e => setImageType(e.target.value)}><option value="System">系统镜像</option><option value="App">应用镜像</option></select></label></div><button disabled={!regionReady || images.busy} onClick={() => void refreshImages()}>刷新镜像</button></section>
    <DirectoryPanel title="平台镜像" result={images} fresh={imagesCurrent}><p className="muted">结果地域：{String(images.data?.filters.Region)} · 查询名称：{String(images.data?.filters.Name ?? '全部')} · 类型：{String(images.data?.filters.ImageType ?? '全部')}。</p><div className="table-scroll"><table><thead><tr><th>名称 / ID</th><th>类型 / 作者</th><th>状态 / 标签</th></tr></thead><tbody>{images.data?.items.map(item => <tr key={item.CompShareImageId}><td>{item.Name}<small>{item.CompShareImageId}</small></td><td>{item.ImageType}<small>{item.Author}</small></td><td>{item.Status}<small>{item.Tags.join(' · ')}</small></td></tr>)}</tbody></table></div></DirectoryPanel>
    {images.data && <div className="actions"><button className="secondary" disabled={!imagesCurrent || imageOffset === 0} onClick={() => void refreshImages(Math.max(0, imageOffset - 20))}>上一页</button><span className="muted">偏移 {imageOffset} · 总计 {images.data.total}</span><button className="secondary" disabled={!imagesCurrent || imageOffset + 20 >= images.data.total} onClick={() => void refreshImages(imageOffset + 20)}>下一页</button></div>}
    <section className="panel asset-form"><h2>查询公共模型目录</h2><div className="form-grid"><label>模型名称<input value={modelName} maxLength={120} onChange={e => setModelName(e.target.value)}/></label><label>标签<input value={modelTag} maxLength={120} onChange={e => setModelTag(e.target.value)}/></label></div><button disabled={!regionReady || models.busy} onClick={() => void models.read(directoryPath('models', {region, name: modelName.trim(), tags: modelTag.trim()}))}>刷新公共模型</button></section>
    <DirectoryPanel title="公共模型目录" result={models} fresh={modelsCurrent}><p className="muted">结果地域：{String(models.data?.filters.Region)} · 名称：{String(models.data?.filters.name ?? '全部')} · 标签：{String(models.data?.filters.tags ?? '全部')}。此处仅浏览，不代表已登记内容指纹或已验证挂载。</p><div className="table-scroll"><table><thead><tr><th>模型</th><th>只读来源路径</th><th>大小 / 标签</th></tr></thead><tbody>{models.data?.items.map(item => <tr key={item.Path}><td>{item.Name}</td><td>{item.Path}</td><td>{item.Size}<small>{item.Tag}</small></td></tr>)}</tbody></table></div></DirectoryPanel>
    <section className="panel asset-form"><h2>检查所选组合库存</h2><p className="muted">先查询当前地域/可用区的规格与镜像，再选择真实条目。磁盘类型从规格目录选择，系统盘容量还须满足镜像约束；容量查询只模拟调度。</p><div className="form-grid">
      <label>单卡 GPU<select value={gpu} onChange={e => {setGpu(e.target.value);setPlatform('');setDiskType('');}}><option value="">请选择已查询型号</option>{specOptions.map(item => <option key={item.Name + item.Zone} value={item.Name}>{item.Name} · {item.Zone}</option>)}</select></label>
      <label>镜像（当前查询页）<select value={image} onChange={e => setImage(e.target.value)}><option value="">请选择镜像</option>{imageOptions.map(item => <option key={item.CompShareImageId} value={item.CompShareImageId}>{item.Name} · {item.CompShareImageId}</option>)}</select></label>
      <label>CPU 平台<select value={platform} onChange={e => setPlatform(e.target.value)}><option value="">请选择</option>{platforms.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>计费模式<select value={charge} onChange={e => setCharge(e.target.value)}><option value="">请选择</option>{['Month','Day','Dynamic','Postpay','Spot'].map(item => <option key={item}>{item}</option>)}</select></label>
      <label>系统盘类型<select value={diskType} onChange={e => setDiskType(e.target.value)}><option value="">请选择目录支持的类型</option>{diskTypes.map((item, index) => <option key={item.Name + index} value={item.Name}>{item.Name} · {item.MinimalSize ?? 1}–{item.MaximalSize ?? '未知上限'} GB</option>)}</select></label><label>系统盘容量（GB）<input type="number" min="1" max="1000000" step="1" value={diskSize} onChange={e => setDiskSize(e.target.value)}/></label></div>
      <button disabled={!capacityReady || capacity.busy} onClick={() => void capacity.read('/resources/ucloud/capacity', {region, zone, gpu_type: gpu, cpu_platform: platform, image_id: image, charge_type: charge, disks: [{IsBoot: true, Type: diskType.trim(), Size: Number(diskSize)}]})}>查询库存</button></section>
    <DirectoryPanel title="单卡库存快照" result={capacity} fresh={capacityCurrent}><p className="muted">地域：{String(capacity.data?.filters.Region)} · 可用区：{String(capacity.data?.filters.Zone)} · GPU：{String(capacity.data?.filters.GpuType)} · 镜像：{String(capacity.data?.filters.CompShareImageId)}。兼容性未验证。</p><div className="table-scroll"><table><thead><tr><th>GPU 数量</th><th>CPU / 内存</th><th>库存</th></tr></thead><tbody>{capacity.data?.items.filter(item => item.Gpu === 1).map((item, index) => <tr key={index}><td>{item.Gpu}</td><td>{item.Cpu} CPU · {item.Mem} GB</td><td><Badge label={item.ResourceEnough ? '查询时有库存' : '库存不足'} tone={item.ResourceEnough ? 'ok' : 'bad'}/></td></tr>)}</tbody></table></div>{capacity.data && !capacity.data.items.some(item => item.Gpu === 1) && <p className="muted">本次没有返回单卡组合。</p>}</DirectoryPanel>
    <p className="inline-note">公共模型内容身份、云实例关联与回收、真实训练和独立 vLLM 推理尚未接入。凭据仅在后端配置。</p>
  </>;
}
