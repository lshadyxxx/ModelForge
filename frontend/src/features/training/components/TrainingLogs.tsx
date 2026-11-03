import {useEffect, useMemo, useRef, useState} from 'react';
import {SelectMenu} from '../../../shared/SelectMenu';
import {
  filterLogLines,
  parseLogLines,
  type LogLevel,
} from '../training-model';
import type {LogChunk} from '../types';
import {TrainingIcon} from './TrainingIcon';

const levelLabels: Record<string, string> = {
  all: '全部级别',
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
  other: '其他',
};
const levelOptions = Object.entries(levelLabels).map(([value, label]) => ({value, label}));

const levelTones: Record<LogLevel, string> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  other: 'other',
};

export function TrainingLogs({
  attemptId,
  chunks,
  loading,
  error,
  diagnosticGap,
  onReload,
}: {
  attemptId: string;
  chunks: LogChunk[];
  loading: boolean;
  error: string;
  diagnosticGap: boolean;
  onReload: () => void;
}) {
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const viewer = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => parseLogLines(chunks), [chunks]);
  const filtered = useMemo(() => filterLogLines(lines, level, query), [lines, level, query]);
  const displayed = filtered.length > 2000 ? filtered.slice(-2000) : filtered;
  const gap = diagnosticGap || chunks.some((chunk) => chunk.gap);

  useEffect(() => {
    setLevel('all');
    setQuery('');
    setFollow(true);
  }, [attemptId]);

  useEffect(() => {
    if (!follow || !viewer.current) return;
    viewer.current.scrollTop = viewer.current.scrollHeight;
  }, [displayed.length, follow]);

  return <section className="training-log-panel">
    <header className="training-log-heading">
      <div><span className="training-kicker">REMOTE OUTPUT</span><h2>训练日志</h2><p>只读取当前 Attempt 的日志分页；筛选仅作用于已加载内容。</p></div>
      <div className="training-log-status">
        <span>{lines.length} 行已加载</span>
        <button type="button" className="secondary" onClick={onReload} disabled={loading}><TrainingIcon name="refresh" size={14}/>{loading ? '读取中' : '重新读取'}</button>
      </div>
    </header>

    {gap && <div className="training-log-gap" role="alert">
      <TrainingIcon name="alert" size={17}/>
      <div><strong>日志存在缺口</strong><p>远程日志分页或执行证据报告了缺口；当前内容不能视为完整输出。</p></div>
    </div>}
    {error && <div className="training-log-error" role="alert">
      <TrainingIcon name="alert" size={17}/>
      <div><strong>日志读取失败</strong><p>{error}</p></div>
    </div>}

    <div className="training-log-toolbar">
      <label className="training-log-search">
        <TrainingIcon name="search" size={15}/>
        <span className="training-sr-only">搜索日志</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索错误、阶段或关键字"/>
      </label>
      <label className="training-select-wrap">
        <span className="training-sr-only">筛选日志级别</span>
        <SelectMenu
          value={level}
          options={levelOptions}
          onChange={setLevel}
          placeholder="全部级别"
          searchable={false}
          size="compact"
          theme="dark"
          ariaLabel="筛选日志级别"
        />
      </label>
      <label className="training-follow-toggle">
        <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)}/>
        <span>跟随最新输出</span>
      </label>
      <span className="training-log-count">显示 {displayed.length} / {filtered.length} 行</span>
    </div>

    {!lines.length && loading ? <div className="training-log-empty" role="status">
      <span className="training-spinner"/>
      <div><strong>正在读取日志</strong><p>轮询会持续补充新输出。</p></div>
    </div> : !lines.length ? <div className="training-log-empty">
      <TrainingIcon name="terminal" size={23}/>
      <div><strong>{error ? '暂时无法确认日志内容' : '等待远程进程输出'}</strong><p>{error ? '修复连接后可重新读取；当前不把读取失败当作日志为空。' : '训练进程开始写入 stdout/stderr 后，这里会出现真实内容。'}</p></div>
    </div> : !filtered.length ? <div className="training-log-empty">
      <TrainingIcon name="search" size={23}/>
      <div><strong>没有符合条件的日志</strong><p>已加载 {lines.length} 行；清除级别或搜索词后再试。</p><button type="button" className="secondary" onClick={() => {setLevel('all'); setQuery('');}}>清除筛选</button></div>
    </div> : <div className="training-log-viewer" ref={viewer} tabIndex={0} aria-label={`训练日志，显示 ${displayed.length} 行`}>
      {filtered.length > displayed.length && <p className="training-log-truncated">为保持滚动流畅，仅渲染最后 {displayed.length} 行；筛选统计仍基于全部 {filtered.length} 条匹配。</p>}
      {displayed.map((line) => <div className="training-log-line" key={line.index}>
        <span className="training-log-number" aria-hidden="true">{line.index}</span>
        <span className={`training-log-level ${levelTones[line.level]}`}>{line.level === 'other' ? 'LOG' : line.level.toUpperCase()}</span>
        <code>{line.text || ' '}</code>
      </div>)}
    </div>}
  </section>;
}
