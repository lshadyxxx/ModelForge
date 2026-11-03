import {useId} from 'react';
import type {MetricPoint} from '../training-model';
import {TrainingIcon} from './TrainingIcon';

export type MetricSeries = {
  key: string;
  label: string;
  color: string;
  points: MetricPoint[];
  showDots?: boolean;
};

type Props = {
  title: string;
  subtitle: string;
  series: MetricSeries[];
  formatValue: (value: number) => string;
  emptyText?: string;
  height?: number;
  className?: string;
};

const width = 760;
const padding = {top: 20, right: 22, bottom: 34, left: 58};

function pathFor(points: MetricPoint[], x: (value: number) => number, y: (value: number) => number) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${x(point.step).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
}

function tickValues(min: number, max: number, count: number) {
  if (count <= 1) return [min];
  return Array.from({length: count}, (_, index) => min + (max - min) * index / (count - 1));
}

export function MetricChart({
  title,
  subtitle,
  series,
  formatValue,
  emptyText = '当前没有真实采样。',
  height = 230,
  className = '',
}: Props) {
  const titleId = useId();
  const allPoints = series.flatMap((item) => item.points);
  if (!allPoints.length) {
    return <section className={'training-chart-card training-chart-empty ' + className}>
      <header><div><h3>{title}</h3><p>{subtitle}</p></div></header>
      <div><TrainingIcon name="sliders" size={22}/><strong>尚无采样</strong><p>{emptyText}</p></div>
    </section>;
  }

  const minStep = Math.min(...allPoints.map((point) => point.step));
  const maxStep = Math.max(...allPoints.map((point) => point.step));
  const rawMin = Math.min(...allPoints.map((point) => point.value));
  const rawMax = Math.max(...allPoints.map((point) => point.value));
  const rawRange = rawMax - rawMin;
  const valuePad = rawRange > 0 ? rawRange * 0.12 : Math.max(Math.abs(rawMax) * 0.12, 1);
  const paddedMin = rawMin - valuePad;
  const minValue = allPoints.every((point) => point.value >= 0) ? Math.max(0, paddedMin) : paddedMin;
  const maxValue = rawMax + valuePad;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const stepRange = maxStep - minStep;
  const x = (value: number) => padding.left + (
    stepRange > 0 ? (value - minStep) / stepRange : 0.5
  ) * plotWidth;
  const y = (value: number) => padding.top + (1 - (
    maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0.5
  )) * plotHeight;
  const yTicks = tickValues(minValue, maxValue, 4);
  const xTicks = tickValues(minStep, maxStep, Math.min(5, maxStep - minStep + 1));

  return <section className={'training-chart-card ' + className}>
    <header>
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      <div className="training-chart-legend">
        {series.filter((item) => item.points.length).map((item) => <span key={item.key}><i style={{background: item.color}}/>{item.label}</span>)}
      </div>
    </header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>{title}，{subtitle}。{series.map((item) => `${item.label} ${item.points.length} 个采样`).join('，')}</title>
      {yTicks.map((value) => <g key={'y' + value}>
        <line className="training-chart-grid" x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)}/>
        <text className="training-chart-axis-label" x={padding.left - 10} y={y(value) + 4} textAnchor="end">{formatValue(value)}</text>
      </g>)}
      {xTicks.map((value) => <g key={'x' + value}>
        <line className="training-chart-x-grid" x1={x(value)} x2={x(value)} y1={padding.top} y2={height - padding.bottom}/>
        <text className="training-chart-axis-label" x={x(value)} y={height - 12} textAnchor="middle">{Math.round(value)}</text>
      </g>)}
      <text className="training-chart-axis-caption" x={12} y={padding.top + plotHeight / 2} transform={`rotate(-90 12 ${padding.top + plotHeight / 2})`} textAnchor="middle">指标值</text>
      <text className="training-chart-axis-caption" x={padding.left + plotWidth / 2} y={height - 1} textAnchor="middle">Step</text>
      {series.filter((item) => item.points.length).map((item) => <g key={item.key}>
        <path d={pathFor(item.points, x, y)} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        {item.points.map((point, index) => (item.showDots || index === item.points.length - 1) && <circle
          key={point.step + '-' + index}
          cx={x(point.step)}
          cy={y(point.value)}
          r={index === item.points.length - 1 ? 3.4 : 2.4}
          fill="#111a2a"
          stroke={item.color}
          strokeWidth="1.8"
        >
          <title>{item.label} · step {point.step} · {formatValue(point.value)}</title>
        </circle>)}
      </g>)}
    </svg>
    <footer>
      {series.filter((item) => item.points.length).map((item) => {
        const first = item.points[0];
        const last = item.points[item.points.length - 1];
        return <span key={item.key}><b>{item.label}</b> {formatValue(first.value)} → {formatValue(last.value)} · {item.points.length} 点</span>;
      })}
    </footer>
  </section>;
}
