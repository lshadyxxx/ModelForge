import { type ReactNode } from 'react';

import { ApiError } from './http';

export function bytes(value: number) {if (!Number.isFinite(value)) return '未知'; const unit = value >= 1024 ** 3 ? 'GiB' : value >= 1024 ** 2 ? 'MiB' : value >= 1024 ? 'KiB' : 'B'; const divisor = {GiB: 1024 ** 3, MiB: 1024 ** 2, KiB: 1024, B: 1}[unit]; return (value / divisor).toLocaleString('zh-CN', {maximumFractionDigits: 2}) + ' ' + unit;}
export function date(value: string) {return new Date(value).toLocaleString('zh-CN', {hour12: false});}
export function Badge({label, tone = 'neutral'}: {label: string; tone?: 'ok' | 'bad' | 'neutral'}) {return <span className={'badge ' + tone}>{label}</span>;}
export function Failure({error}: {error: unknown}) {if (!error) return null; return <div className="notice" role="alert"><strong>{error instanceof Error ? error.message : String(error)}</strong>{error instanceof ApiError && <><p>错误码：{error.code}{error.requestId && ' · 请求：' + error.requestId}</p>{error.details != null && <pre>{JSON.stringify(error.details, null, 2)}</pre>}</>}</div>;}
export function Empty({children}: {children: ReactNode}) {return <div className="empty-state">{children}</div>;}
export function Detail({children}: {children: ReactNode}) {return <section className="panel asset-detail">{children}</section>;}
