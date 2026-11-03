import {useState} from 'react';
import {TrainingIcon} from './TrainingIcon';

export function CopyValue({
  value,
  label,
  display,
}: {
  value?: string | null;
  label: string;
  display?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1800);
  };
  return <span className="training-copy-value">
    <code>{display ?? value ?? '—'}</code>
    {value && <button
      type="button"
      className="training-copy-button"
      onClick={() => void copy()}
      aria-label={`复制${label}`}
      title={state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择' : `复制${label}`}
    ><TrainingIcon name="copy" size={13}/></button>}
  </span>;
}
