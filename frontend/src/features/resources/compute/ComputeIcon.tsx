import type { ReactNode } from 'react';

export type ComputeIconName =
  | 'activity'
  | 'alert'
  | 'arrow-right'
  | 'bolt'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'close'
  | 'copy'
  | 'cpu'
  | 'filter'
  | 'grid'
  | 'image'
  | 'location'
  | 'lock'
  | 'memory'
  | 'pause'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'server'
  | 'shield'
  | 'sliders'
  | 'trash'
  | 'wallet';

const paths: Record<ComputeIconName, ReactNode> = {
  activity: <path d="M3 12h4l2-6 4 13 2-7h6" />,
  alert: <><path d="M12 3l9 17H3z" /><path d="M12 9v5M12 17h.01" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="M14 7l5 5-5 5" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  check: <path d="M5 12l4 4L19 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V4H4v12h4" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /><rect x="10" y="10" width="4" height="4" rx="1" /></>,
  filter: <path d="M4 5h16M7 12h10M10 19h4" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="M21 15l-5-5L5 20" /></>,
  location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1116 0z" /><circle cx="12" cy="10" r="2.5" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 118 0v3" /></>,
  memory: <><rect x="5" y="7" width="14" height="10" rx="1" /><path d="M8 3v4M12 3v4M16 3v4M8 17v4M12 17v4M16 17v4" /></>,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="M8 5l11 7-11 7z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 10-2.3 6" /><path d="M20 4v7h-7" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-5" /></>,
  sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
  wallet: <><path d="M3 6h16a2 2 0 012 2v11H5a2 2 0 01-2-2z" /><path d="M3 7V5a2 2 0 012-2h12v3M16 12h5" /></>,
};

export function ComputeIcon({
  name,
  size = 16,
  className,
}: {
  name: ComputeIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
