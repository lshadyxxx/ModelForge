import {
  formatBytes,
  formatLearningRate,
  formatMetric,
  metricPointSummary,
  normalizeMetrics,
} from '../training-model';
import type {TrainingAttempt} from '../types';
import {MetricChart, type MetricSeries} from './MetricChart';
import {TrainingIcon} from './TrainingIcon';

function AnalysisStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return <div className="training-analysis-stat">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>;
}

function MemorySnapshot({attempt}: {attempt: TrainingAttempt}) {
  const memory = attempt.runtime_report?.training_memory;
  const fields = [
    {
      label: '设备已用峰值',
      value: formatBytes(memory?.device_peak_used_bytes),
      available: Number.isFinite(memory?.device_peak_used_bytes),
    },
    {
      label: 'Torch 已分配峰值',
      value: formatBytes(memory?.torch_peak_memory_allocated_bytes),
      available: Number.isFinite(memory?.torch_peak_memory_allocated_bytes),
    },
    {
      label: 'Torch 保留峰值',
      value: formatBytes(memory?.torch_peak_memory_reserved_bytes),
      available: Number.isFinite(memory?.torch_peak_memory_reserved_bytes),
    },
  ];
  const measured = fields.some((field) => field.available);
  return <section className="training-analysis-panel training-memory-panel">
    <header>
      <div><span className="training-kicker">MEMORY SNAPSHOT</span><h2>GPU 显存峰值快照</h2></div>
      <span className={'training-evidence-state ' + (measured ? 'ok' : 'neutral')}>{measured ? '已观测' : '未上报'}</span>
    </header>
    <div className="training-memory-grid">
      {fields.map((field) => <div key={field.label} className={field.available ? '' : 'unavailable'}>
        <span>{field.label}</span>
        <strong>{field.value}</strong>
      </div>)}
    </div>
    <p><TrainingIcon name="info" size={15}/>这是训练结束后从运行报告读取的峰值快照，不是实时显存曲线。采样 {memory?.sample_count ?? '—'} 次，间隔 {memory?.sample_interval_ms ?? '—'} ms。</p>
    {memory?.sampler_error && <p className="training-memory-error">采样器返回：{memory.sampler_error}</p>}
  </section>;
}

export function RunAnalysis({attempt}: {attempt: TrainingAttempt}) {
  const metrics = normalizeMetrics(attempt.metrics);
  const lossSeries: MetricSeries[] = [
    {key: 'train', label: 'Train Loss', color: '#78a8ff', points: metrics.train},
    {key: 'eval', label: 'Eval Loss', color: '#72d3a4', points: metrics.evaluation, showDots: true},
  ];
  const lrSeries: MetricSeries[] = [
    {key: 'lr', label: 'Learning Rate', color: '#f0b45a', points: metrics.learningRate},
  ];
  const firstTrain = metrics.train[0];
  const lastTrain = metrics.train[metrics.train.length - 1];
  const lossDelta = firstTrain && lastTrain && firstTrain.value !== 0
    ? ((lastTrain.value - firstTrain.value) / Math.abs(firstTrain.value)) * 100
    : null;

  return <div className="training-analysis-page">
    <section className="training-analysis-summary">
      <AnalysisStat label="训练采样" value={metrics.train.length} note={metricPointSummary(metrics.train)}/>
      <AnalysisStat label="最新 Train Loss" value={formatMetric(metrics.latestTrainLoss)} note={lossDelta === null ? '无法计算相对变化' : `${lossDelta >= 0 ? '+' : ''}${lossDelta.toFixed(1)}% · 首个到最新采样`}/>
      <AnalysisStat label="最优 Eval Loss" value={formatMetric(metrics.bestEval?.value)} note={metrics.bestEval ? `step ${metrics.bestEval.step}` : '尚无验证采样'}/>
      <AnalysisStat label="最新 Learning Rate" value={formatLearningRate(metrics.latestLearningRate)} note={`${metrics.learningRate.length} 个真实采样`}/>
    </section>

    <div className="training-analysis-grid">
      <div className="training-analysis-main">
        <MetricChart
          title="训练 / 验证 Loss"
          subtitle={metrics.train.length || metrics.evaluation.length ? '仅为 trainer_state 已写入的真实采样；不绘制总步数或目标位置。' : '当前 Attempt 尚未形成可绘制的 Loss 序列。'}
          series={lossSeries}
          formatValue={(value) => value.toFixed(Math.abs(value) < 0.1 ? 4 : 3)}
          emptyText="训练开始并写入 trainer_state 后，这里会出现真实 Loss。"
          height={286}
        />
        <MetricChart
          title="Learning Rate"
          subtitle={metrics.learningRate.length ? '展示 trainer 上报的学习率调度轨迹。' : '当前接口没有返回 learning_rate 采样。'}
          series={lrSeries}
          formatValue={formatLearningRate}
          emptyText="当前 Attempt 没有 learning_rate 字段。"
          height={210}
        />
      </div>
      <aside className="training-analysis-side">
        <MemorySnapshot attempt={attempt}/>
        <section className="training-analysis-panel training-capability-panel">
          <header><div><span className="training-kicker">CAPABILITY BOUNDARY</span><h2>当前指标能力</h2></div></header>
          <ul>
            <li className="available"><TrainingIcon name="check" size={14}/><div><strong>Train / Eval Loss</strong><span>可从 Attempt metrics 读取</span></div></li>
            <li className="available"><TrainingIcon name="check" size={14}/><div><strong>Learning Rate</strong><span>可从 Attempt metrics 读取</span></div></li>
            <li><TrainingIcon name="clock" size={14}/><div><strong>Gradient Norm</strong><span>当前接口未上报</span></div></li>
            <li><TrainingIcon name="clock" size={14}/><div><strong>吞吐 / samples per second</strong><span>当前接口未上报</span></div></li>
            <li><TrainingIcon name="clock" size={14}/><div><strong>实时 GPU 显存曲线</strong><span>仅提供结束后峰值快照</span></div></li>
            <li><TrainingIcon name="clock" size={14}/><div><strong>Accuracy / F1</strong><span>当前训练不生成分类质量指标</span></div></li>
          </ul>
        </section>
        <section className="training-analysis-note">
          <TrainingIcon name="info" size={17}/>
          <div><strong>为什么没有训练进度百分比</strong><p>当前接口没有可信的总步数。仅显示已到达的 step 和 epoch，避免用猜测值制造完成度。</p></div>
        </section>
      </aside>
    </div>
  </div>;
}
