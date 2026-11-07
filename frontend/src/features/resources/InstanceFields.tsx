import {useEffect, useState} from 'react';
import {api} from '../../shared/http';
import {SelectMenu} from '../../shared/SelectMenu';
import {imageDirectoryQuery} from './api';

export type InstanceSpec = {
  region: string;
  zone: string;
  gpu_type: string;
  cpu: number;
  memory_mb: number;
  image_id: string;
  cpu_platform: string;
  charge_type: string;
  boot_disk_gb: number;
  boot_disk_type: string;
};

type Zone = {Region: string; Zone: string; Describe: string; IsPod: boolean};
type Spec = {
  Name: string;
  MachineSizes: {
    Gpu: number;
    Collection: {Cpu: number; Memory: number[]; MinimalCpuPlatform: string[]}[];
  }[];
  Disks: {BootDisk: {Name: string; MinimalSize?: number}[]}[];
};
type Image = {CompShareImageId: string; Name: string};
type Directory<T> = {items: T[]; total: number};

export const emptyInstance: InstanceSpec = {
  region: '',
  zone: '',
  gpu_type: '',
  cpu: 0,
  memory_mb: 0,
  image_id: '',
  cpu_platform: 'Auto',
  charge_type: 'Postpay',
  boot_disk_gb: 100,
  boot_disk_type: 'CLOUD_SSD',
};

export function InstanceFields({
  value,
  onChange,
  disabled = false,
  imageLock = null,
  managed = false,
}: {
  value: InstanceSpec;
  onChange: (value: InstanceSpec) => void;
  disabled?: boolean;
  imageLock?: {id: string; label: string} | null;
  managed?: boolean;
}) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState('');
  const [imageType, setImageType] = useState('System');
  const [imageName, setImageName] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setZonesLoading(true);
    api<Directory<Zone>>('/resources/ucloud/zones', {signal: controller.signal})
      .then((result) => {
        setZones(result.items);
        setError('');
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setZonesLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!value.region || !value.zone) {
      setSpecs([]);
      setSpecsLoading(false);
      return;
    }
    const controller = new AbortController();
    setSpecs([]);
    setSpecsLoading(true);
    api<Directory<Spec>>(
      '/resources/ucloud/specs?' + new URLSearchParams({region: value.region, zone: value.zone}),
      {signal: controller.signal},
    ).then((result) => {
      setSpecs(result.items);
      setError('');
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setSpecsLoading(false);
    });
    return () => controller.abort();
  }, [value.region, value.zone]);

  useEffect(() => {
    if (imageLock) {
      setImages([]);
      setTotal(0);
      setImagesLoading(false);
      return;
    }
    if (!value.region || !value.zone) {
      setImages([]);
      setTotal(0);
      setImagesLoading(false);
      return;
    }
    const controller = new AbortController();
    setImages([]);
    setTotal(0);
    setImagesLoading(true);
    api<Directory<Image>>(
      imageDirectoryQuery(value.region, value.zone, imageName, imageType, offset, 100).path,
      {signal: controller.signal},
    ).then((result) => {
      setImages(result.items);
      setTotal(result.total);
      setError('');
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setImagesLoading(false);
    });
    return () => controller.abort();
  }, [imageLock?.id, value.region, value.zone, imageType, imageName, offset]);

  const spec = specs.find((item) => item.Name === value.gpu_type);
  const sizes = (spec?.MachineSizes ?? [])
    .filter((item) => item.Gpu === 1)
    .flatMap((item) => item.Collection.flatMap((collection) => (
      collection.Memory.map((memory) => ({
        cpu: collection.Cpu,
        memory_mb: memory * 1024,
        platforms: collection.MinimalCpuPlatform,
      }))
    )));
  const scopeOptions = zones.map((zone) => ({
    value: `${zone.Region}|${zone.Zone}`,
    label: `${zone.Describe} · ${zone.IsPod ? '容器' : '云主机'} · ${zone.Zone}`,
  }));
  const selectedScope = value.region && value.zone
    ? `${value.region}|${value.zone}`
    : '';
  const sizeOptions = sizes.map((size) => ({
    value: `${size.cpu}:${size.memory_mb}`,
    label: `${size.cpu} 核 / ${size.memory_mb / 1024} GiB`,
  }));
  const imageOptions = images.map((image) => ({
    value: image.CompShareImageId,
    label: image.Name,
  }));
  const imageRange = images.length
    ? `${offset + 1}–${offset + images.length} / ${total}`
    : `0 / ${total}`;

  return <fieldset disabled={disabled}>
    <legend>单 GPU 实例要求</legend>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="form-grid">
      <label>部署位置
        <SelectMenu
          value={selectedScope}
          options={scopeOptions}
          onChange={(scope) => {
            const [region, zone] = scope.split('|');
            if (!region || !zone) return;
            setOffset(0);
            onChange({
              ...(imageLock ? value : emptyInstance),
              region,
              zone,
              gpu_type: '',
              cpu: 0,
              memory_mb: 0,
              image_id: imageLock?.id ?? '',
            });
          }}
          placeholder={zonesLoading ? '正在读取部署位置' : '选择地域与可用区'}
          emptyText="没有可用部署位置"
          searchPlaceholder="搜索地域、可用区或类型"
          disabled={disabled || zonesLoading || !zones.length}
          ariaLabel="部署位置"
          required
        />
      </label>
      <label>GPU
        <SelectMenu
          value={value.gpu_type}
          options={specs.map((item) => ({value: item.Name, label: item.Name}))}
          onChange={(gpuType) => onChange({
            ...value,
            gpu_type: gpuType,
            cpu: 0,
            memory_mb: 0,
            cpu_platform: 'Auto',
          })}
          placeholder={!value.zone ? '请先选择可用区' : specsLoading ? '正在读取 GPU 规格' : '选择单卡规格'}
          emptyText="当前可用区没有单卡 GPU 规格"
          searchPlaceholder="搜索 GPU 规格"
          disabled={disabled || !value.zone || specsLoading}
          ariaLabel="GPU"
          required
        />
      </label>
      <label>CPU / 内存
        <SelectMenu
          value={value.cpu ? `${value.cpu}:${value.memory_mb}` : ''}
          options={sizeOptions}
          onChange={(selection) => {
            const [cpu, memory] = selection.split(':').map(Number);
            onChange({...value, cpu, memory_mb: memory, cpu_platform: 'Auto'});
          }}
          placeholder={!value.gpu_type ? '请先选择 GPU' : '选择资源组合'}
          emptyText="当前 GPU 没有可用资源组合"
          searchPlaceholder="搜索 CPU / 内存"
          disabled={disabled || !value.gpu_type || !sizes.length}
          ariaLabel="CPU / 内存"
          required
        />
      </label>
      <label>CPU 平台
        <SelectMenu
          value={value.cpu_platform}
          options={['Auto', 'Intel/Auto', 'Amd/Auto'].map((platform) => ({
            value: platform,
            label: platform,
          }))}
          onChange={(cpuPlatform) => onChange({...value, cpu_platform: cpuPlatform})}
          placeholder="选择 CPU 平台"
          searchable={false}
          disabled={disabled}
          ariaLabel="CPU 平台"
        />
      </label>
      {imageLock ? <label className="span-two">训练镜像
        <div className="training-locked-image">
          <strong>{imageLock.label}</strong>
          <code>{imageLock.id}</code>
        </div>
        <small>由训练镜像 profile 固定；资源配置只改变实例规格，不改变训练运行时。</small>
      </label> : <>
        <label>镜像目录
          <SelectMenu
            value={imageType}
            options={[
              {value: 'System', label: '系统镜像'},
              {value: 'App', label: '应用镜像'},
              {value: 'Custom', label: '自定义镜像'},
            ]}
            onChange={(nextImageType) => {
              setImageType(nextImageType);
              setOffset(0);
              onChange({...value, image_id: ''});
            }}
            placeholder="选择镜像目录"
            searchable={false}
            disabled={disabled}
            ariaLabel="镜像目录"
          />
        </label>
        <label>筛选镜像
          <input
            value={imageName}
            onChange={(event) => {
              setImageName(event.target.value);
              setOffset(0);
              onChange({...value, image_id: ''});
            }}
            placeholder={value.zone ? '按镜像名称筛选' : '请先选择可用区'}
            disabled={disabled || !value.zone}
          />
        </label>
        <label>运行镜像
          <SelectMenu
            value={value.image_id}
            options={imageOptions}
            onChange={(imageId) => onChange({...value, image_id: imageId})}
            placeholder={!value.zone ? '请先选择可用区' : imagesLoading ? '正在读取运行镜像' : '选择运行镜像'}
            searchPlaceholder="搜索运行镜像"
            emptyText="当前筛选没有匹配镜像"
            disabled={disabled || !value.zone || imagesLoading}
            ariaLabel="运行镜像"
            required
          />
        </label>
      </>}
      <label>系统盘（GB）
        <input
          required
          type="number"
          min="1"
          max="1000000"
          value={value.boot_disk_gb}
          onChange={(event) => onChange({...value, boot_disk_gb: Number(event.target.value)})}
        />
      </label>
      <label>磁盘类型
        <SelectMenu
          value={value.boot_disk_type}
          options={[
            {value: 'CLOUD_SSD', label: 'CLOUD_SSD'},
            {value: 'CLOUD_RSSD', label: 'CLOUD_RSSD'},
          ]}
          onChange={(diskType) => onChange({...value, boot_disk_type: diskType})}
          placeholder="选择磁盘类型"
          searchable={false}
          disabled={disabled}
          ariaLabel="磁盘类型"
        />
      </label>
      <label>计费方式
        <SelectMenu
          value={value.charge_type}
          options={[
            {value: 'Postpay', label: '后付费'},
            {value: 'Day', label: '按天'},
            {value: 'Month', label: '按月'},
          ]}
          onChange={(chargeType) => onChange({...value, charge_type: chargeType})}
          placeholder="选择计费方式"
          searchable={false}
          disabled={disabled}
          ariaLabel="计费方式"
        />
      </label>
    </div>
    {!imageLock && <div className="workflow-actions">
      <button
        type="button"
        className="secondary"
        disabled={imagesLoading || offset === 0}
        onClick={() => setOffset(Math.max(0, offset - 100))}
      >上一页镜像</button>
      <span className="muted" aria-live="polite">
        镜像 {imageRange}{imagesLoading ? ' · 正在查询' : ''}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={imagesLoading || !images.length || offset + images.length >= total}
        onClick={() => setOffset(offset + 100)}
      >下一页镜像</button>
    </div>}
    <p className="muted">{managed
      ? '平台会按这组规格重新核对库存与报价，创建单台收费实例，并在训练结束、失败或取消后自动回收。'
      : '提交后保存这组要求；平台不会自动购买。镜像需预装兼容的训练或推理运行时，执行时记录实际版本与校验。'}</p>
  </fieldset>;
}
