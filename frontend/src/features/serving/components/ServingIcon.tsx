const paths: Record<string, string> = {
  queue: 'M4 6h16M4 12h16M4 18h10',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 10-2.3 6M20 4v7h-7',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  back: 'M19 12H5M10 17l-5-5 5-5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  close: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3l9 17H3zM12 9v5M12 17.4v.2',
  check: 'M4 12.5l5 5L20 6',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  gpu: 'M5 5h14v12H5zM8 9h8v4H8zM8 21v-4M16 21v-4M3 9H1M3 14H1M23 9h-2M23 14h-2',
  activity: 'M3 12h4l2-6 4 12 2-6h6',
  panel: 'M4 4h16v16H4zM15 4v16M8 8h4M8 12h4',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.2 15.2L21 21',
  send: 'M4 4l16 8-16 8 3-8zM7 12h13',
  stop: 'M7 7h10v10H7z',
  trash: 'M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14',
  external: 'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  spark: 'M12 3l1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  bot: 'M6 7h12v11H6zM9 11h.01M15 11h.01M9 15h6M12 3v4M4 11H2M22 11h-2',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.2',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v5h5M12 7v5l3 2',
};

export function ServingIcon({
  name,
  size = 18,
  className = '',
}: {
  name: keyof typeof paths | string;
  size?: number;
  className?: string;
}) {
  return <svg
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
  ><path d={paths[name] ?? paths.info}/></svg>;
}
