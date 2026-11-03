import type {LifecycleNode} from '../training-model';
import {TrainingIcon} from './TrainingIcon';

const statusLabel: Record<LifecycleNode['status'], string> = {
  pending: '待开始',
  active: '进行中',
  done: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

function Marker({status, index}: {status: LifecycleNode['status']; index: number}) {
  if (status === 'done') return <TrainingIcon name="check" size={12} strokeWidth={2.2}/>;
  if (status === 'failed') return <TrainingIcon name="x" size={12} strokeWidth={2.2}/>;
  if (status === 'cancelled') return <TrainingIcon name="x" size={12} strokeWidth={2}/>;
  return <span>{index + 1}</span>;
}

export function LifecycleRail({
  nodes,
  conclusion,
  compact = false,
}: {
  nodes: LifecycleNode[];
  conclusion: string;
  compact?: boolean;
}) {
  return <div className={'training-lifecycle' + (compact ? ' compact' : '')} aria-label="训练生命周期">
    <ol>
      {nodes.map((node, index) => <li
        key={node.key}
        className={node.status}
        aria-label={`${node.label}：${statusLabel[node.status]}`}
        aria-current={node.status === 'active' ? 'step' : undefined}
        title={`${node.label}：${statusLabel[node.status]}`}
      >
        <span className="training-lifecycle-marker"><Marker status={node.status} index={index}/></span>
        <span className="training-lifecycle-label">{node.label}</span>
      </li>)}
    </ol>
    <p>{conclusion}</p>
  </div>;
}
