import { ComputeIcon, type ComputeIconName } from './ComputeIcon';
import type { StatusTone } from './compute-ui-types';

const toneIcon: Record<StatusTone, ComputeIconName> = {
  ok: 'check',
  info: 'clock',
  neutral: 'pause',
  warning: 'shield',
  danger: 'alert',
};

export function ComputeStatusBadge({
  label,
  tone,
  compact = false,
}: {
  label: string;
  tone: StatusTone;
  compact?: boolean;
}) {
  return (
    <span className={`mf-status ${tone}${compact ? ' compact' : ''}`}>
      <ComputeIcon name={toneIcon[tone]} size={13} />
      <span>{label}</span>
    </span>
  );
}
