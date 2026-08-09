/**
 * Explicit Frankfurter-backed currency conversion for project rate banks.
 * Never auto-converts; never uses a stale rate without a fresh quote.
 */
import { randomUUID } from 'crypto';
import type { RateLib } from '../engines/rateAnalysis';
import { round } from '../engines/math';

/** Frankfurter v2 single-pair endpoint (not the old v1 `/latest` shape). */
const FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate';

export type CurrencyQuote = {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate: string;
  fetchedAt: string;
};

export type CurrencyConversionLogEntry = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rateUsed: number;
  rateDate: string;
  timestamp: Date;
  triggeredBy: string;
};

type QuoteCacheEntry = CurrencyQuote & { expiresAt: number };

/** Untyped Map — avoids a Babel 8 / preset-typescript quirk with Map generics under Jest. */
const quoteCache = new Map();
const QUOTE_TTL_MS = 10 * 60 * 1000;

export function clearCurrencyQuotesForTests() {
  quoteCache.clear();
}

export async function fetchFrankfurterRate(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: number; rateDate: string }> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) {
    throw new Error('Target currency is the same as the project currency');
  }

  let res: Response;
  try {
    // v2: GET /v2/rate/{base}/{quote} → { date, base, quote, rate }
    const url = `${FRANKFURTER_RATE_URL}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
    res = await fetchImpl(url);
  } catch {
    throw new Error(
      'Could not reach the Frankfurter exchange-rate service. Conversion aborted — no rate applied.',
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) detail = ` (${errBody.message})`;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(
      `Frankfurter returned ${res.status}${detail}. Conversion aborted — no rate applied.`,
    );
  }

  const data = (await res.json()) as {
    base?: string;
    quote?: string;
    date?: string;
    rate?: number;
  };
  const rate = data.rate;
  if (!(typeof rate === 'number' && rate > 0) || !data.date) {
    throw new Error(
      'Frankfurter response was missing a usable rate. Conversion aborted.',
    );
  }
  return { rate, rateDate: data.date };
}

export async function createCurrencyQuote(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CurrencyQuote> {
  const { rate, rateDate } = await fetchFrankfurterRate(
    fromCurrency,
    toCurrency,
    fetchImpl,
  );
  const quote: QuoteCacheEntry = {
    quoteId: randomUUID(),
    fromCurrency: fromCurrency.toUpperCase(),
    toCurrency: toCurrency.toUpperCase(),
    rate,
    rateDate,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + QUOTE_TTL_MS,
  };
  quoteCache.set(quote.quoteId, quote);
  return {
    quoteId: quote.quoteId,
    fromCurrency: quote.fromCurrency,
    toCurrency: quote.toCurrency,
    rate: quote.rate,
    rateDate: quote.rateDate,
    fetchedAt: quote.fetchedAt,
  };
}

export function takeCurrencyQuote(quoteId: string): CurrencyQuote {
  const q = quoteCache.get(quoteId);
  if (!q) {
    throw new Error(
      'Conversion quote expired or was not found. Fetch a new rate and confirm again.',
    );
  }
  if (Date.now() > q.expiresAt) {
    quoteCache.delete(quoteId);
    throw new Error(
      'Conversion quote expired. Fetch a new rate and confirm again.',
    );
  }
  // Consume — single use within the conversion action.
  quoteCache.delete(quoteId);
  return q;
}

/** Multiply every stored resource rate by `rate` (one quote, one pass). */
export function convertRateLib(rateLib: RateLib, rate: number): RateLib {
  const next: RateLib = JSON.parse(JSON.stringify(rateLib));
  const scale = (n: number) => round(n * rate, 4);
  for (const group of ['materials', 'labour', 'equipment'] as const) {
    next[group] = next[group].map((r) => ({ ...r, rate: scale(r.rate) }));
  }
  return next;
}

export function buildConversionLogEntry(
  quote: CurrencyQuote,
  triggeredBy: string,
): CurrencyConversionLogEntry {
  return {
    id: randomUUID(),
    fromCurrency: quote.fromCurrency,
    toCurrency: quote.toCurrency,
    rateUsed: quote.rate,
    rateDate: quote.rateDate,
    timestamp: new Date(),
    triggeredBy,
  };
}
