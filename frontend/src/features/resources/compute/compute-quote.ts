import type { ComputeQuote } from './compute-model';

const currency = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function quoteAmount(quote: ComputeQuote): string | null {
  if (quote.state !== 'available' || quote.amount === null) return null;
  return currency.format(quote.amount);
}

export function quoteRate(quote: ComputeQuote): string | null {
  const amount = quoteAmount(quote);
  if (!amount || !quote.unit) return null;
  const unitLabel =
    quote.unit === 'hour' ? '时' : quote.unit === 'day' ? '日' : '月';
  return `${amount} / ${unitLabel}`;
}

export function quoteObservedAt(quote: ComputeQuote): string | null {
  if (!quote.chargedAt) return null;
  return new Date(quote.chargedAt).toLocaleString('zh-CN', {
    hour12: false,
  });
}
