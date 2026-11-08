import type {
  DiagnosisComparisonCandidates,
  DiagnosisComparisonChoice,
} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';
import {
  baselineSelectionKey,
  candidateLabel,
  shortId,
} from './diagnosis-model';

function valueForChoice(choice: DiagnosisComparisonChoice) {
  return choice.mode === 'explicit'
    ? `explicit:${choice.attemptId}`
    : choice.mode;
}

function choiceForValue(value: string): DiagnosisComparisonChoice {
  if (value === 'none') return {mode: 'none'};
  if (value.startsWith('explicit:')) {
    return {mode: 'explicit', attemptId: value.slice('explicit:'.length)};
  }
  return {mode: 'auto'};
}

export function BaselineSelector({
  choice,
  candidates,
  loading,
  error,
  disabled,
  onChange,
  onRetry,
}: {
  choice: DiagnosisComparisonChoice;
  candidates: DiagnosisComparisonCandidates | null;
  loading: boolean;
  error: string;
  disabled?: boolean;
  onChange: (choice: DiagnosisComparisonChoice) => void;
  onRetry: () => void;
}) {
  const selectedId = choice.mode === 'explicit' ? choice.attemptId : null;
  const selected = candidates?.candidates.find(
    (item) => item.attempt_id === selectedId,
  );
  const suggestion = candidates?.suggested_baseline_attempt_id;
  const suggestionCandidate = candidates?.candidates.find(
    (item) => item.attempt_id === suggestion,
  );

  return <section className="diagnosis-baseline-selector" aria-labelledby="diagnosis-baseline-label">
    <div className="diagnosis-baseline-heading">
      <div>
        <span className="training-kicker">HISTORICAL BASELINE</span>
        <label id="diagnosis-baseline-label" htmlFor="diagnosis-baseline">
          对比基线
        </label>
      </div>
      <span className="diagnosis-baseline-rule">
        {candidates
          ? `${candidates.candidates.length} 个同组成功运行`
          : loading
            ? '正在查询历史…'
            : '候选尚未读取'}
      </span>
    </div>
    <div className="diagnosis-baseline-control">
      <select
        id="diagnosis-baseline"
        value={valueForChoice(choice)}
        disabled={disabled || loading}
        aria-describedby="diagnosis-baseline-help"
        onChange={(event) => onChange(choiceForValue(event.target.value))}
      >
        <option value="auto">
          自动：最近一次成功运行
          {suggestionCandidate
            ? ` · #${suggestionCandidate.attempt_number}`
            : ''}
        </option>
        {candidates?.candidates.map((candidate) => <option
          key={candidate.attempt_id}
          value={`explicit:${candidate.attempt_id}`}
        >
          {candidateLabel(candidate)}
        </option>)}
        <option value="none">不对比历史</option>
      </select>
      <button
        type="button"
        className="quiet"
        onClick={onRetry}
        disabled={disabled || loading}
        aria-label="重新查找历史基线"
      >
        <TrainingIcon name="refresh" size={14}/>{loading ? '查找中' : '重查'}
      </button>
    </div>
    <p id="diagnosis-baseline-help">
      选择只改变下一次生成参数，不会自动调用模型；旧报告保留其冻结基线。
    </p>

    {loading && <div className="diagnosis-baseline-state" role="status">
      <span className="training-spinner"/>
      <span>正在查找同一基座、数据集和 split 的历史运行…</span>
    </div>}
    {!loading && error && <div className="diagnosis-baseline-state danger" role="alert">
      <TrainingIcon name="alert" size={15}/>
      <span>{error}。仍可选择“不对比历史”生成单次诊断。</span>
      <button type="button" className="quiet" onClick={onRetry}>重试</button>
    </div>}
    {!loading && !error && candidates && candidates.candidates.length === 0 &&
      <div className="diagnosis-baseline-state">
        <TrainingIcon name="info" size={15}/>
        <span>未找到可比历史。当前基座、数据集和 split 还没有另一次成功运行；仍可生成单次诊断。</span>
      </div>}

    {choice.mode === 'auto' && suggestionCandidate && <div className="diagnosis-baseline-selected">
      <span>自动基线</span>
      <strong>#{suggestionCandidate.attempt_number} · {suggestionCandidate.task_name}</strong>
      <code>{shortId(suggestionCandidate.attempt_id)}</code>
      <small>{candidateLabel(suggestionCandidate)}</small>
    </div>}
    {choice.mode === 'explicit' && selected && <div className="diagnosis-baseline-selected">
      <span>指定基线</span>
      <strong>#{selected.attempt_number} · {selected.task_name}</strong>
      <code>{shortId(selected.attempt_id)}</code>
      <small>{candidateLabel(selected)}</small>
    </div>}
    {choice.mode === 'explicit' && !loading && !selected &&
      <div className="diagnosis-baseline-state danger" role="alert">
        <TrainingIcon name="alert" size={15}/>
        <span>指定的基线不在当前候选中，请重新选择。</span>
      </div>}
    {choice.mode === 'none' && <div className="diagnosis-baseline-state">
      <TrainingIcon name="info" size={15}/>
      <span>本次只做单运行诊断，不产生历史训练信号比较。</span>
    </div>}
    <span className="diagnosis-baseline-key" data-choice={baselineSelectionKey(choice)}/>
  </section>;
}
