/**
 * Explicit currency conversion for project rate banks and BOQ packs.
 * Never auto-converts; never uses a stale rate without a fresh quote.
 * Frankfurter (ECB) first; open.er-api.com for RWF and other non-ECB codes.
 */
import { randomUUID } from 'crypto';
import type { RateLib } from '../engines/rateAnalysis';
import { round } from '../engines/math';

/** Frankfurter v2 single-pair endpoint (not the old v1 `/latest` shape). */
const FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate';

/** ECB/Frankfurter set — no RWF, KES, UGX, TZS, NGN. */
const FRANKFURTER_CODES = new Set([
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
]);

const OPEN_ER_URL = 'https://open.er-api.com/v6/latest';

export type FxSource = 'frankfurter' | 'open-er-api';

export type CurrencyQuote = {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate: string;
  fetchedAt: string;
  source: FxSource;
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

function sameCurrencyError(from: string, to: string) {
  if (from === to) {
    throw new Error('Target currency is the same as the project currency');
  }
}

export async function fetchFrankfurterRate(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: number; rateDate: string; source: FxSource }> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  sameCurrencyError(from, to);

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
  return { rate, rateDate: data.date, source: 'frankfurter' };
}

/** Open Access ExchangeRate-API (includes RWF, KES, UGX, TZS). */
export async function fetchOpenErRate(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: number; rateDate: string; source: FxSource }> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  sameCurrencyError(from, to);

  let res: Response;
  try {
    res = await fetchImpl(`${OPEN_ER_URL}/${encodeURIComponent(from)}`);
  } catch {
    throw new Error(
      'Could not reach the exchange-rate service. Conversion aborted — no rate applied.',
    );
  }

  if (!res.ok) {
    throw new Error(
      `Exchange-rate service returned ${res.status}. Conversion aborted — no rate applied.`,
    );
  }

  const data = (await res.json()) as {
    result?: string;
    base_code?: string;
    time_last_update_utc?: string;
    rates?: Record<string, number>;
  };
  const rate = data.rates?.[to];
  if (data.result && data.result !== 'success') {
    throw new Error(
      'Exchange-rate service did not return a usable rate. Conversion aborted.',
    );
  }
  if (!(typeof rate === 'number' && rate > 0)) {
    throw new Error(
      `No published rate for ${from}→${to} (RWF and other African currencies use this source). Conversion aborted.`,
    );
  }
  const utc = data.time_last_update_utc || '';
  const rateDate = utc ? new Date(utc).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return { rate, rateDate, source: 'open-er-api' };
}

export async function fetchFxRate(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: number; rateDate: string; source: FxSource }> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  sameCurrencyError(from, to);
  const frankfurterPair =
    FRANKFURTER_CODES.has(from) && FRANKFURTER_CODES.has(to);
  if (frankfurterPair) {
    try {
      return await fetchFrankfurterRate(from, to, fetchImpl);
    } catch {
      /* African and missing pairs fall through */
    }
  }
  return fetchOpenErRate(from, to, fetchImpl);
}

export async function createCurrencyQuote(
  fromCurrency: string,
  toCurrency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CurrencyQuote> {
  const { rate, rateDate, source } = await fetchFxRate(
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
    source,
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
    source: quote.source,
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

const MATERIAL_MONEY_KEYS = [
  'verticalBracingRate',
  'soffitPropRate',
  'appliedVerticalBracingRate',
  'appliedSoffitPropRate',
];

/** Scale project material money fields (bracing / props) with the same FX quote. */
export function convertProjectMaterials(materials: unknown, rate: number) {
  if (!materials || typeof materials !== 'object') return materials;
  const next: Record<string, unknown> = {
    ...(materials as Record<string, unknown>),
  };
  for (let i = 0; i < MATERIAL_MONEY_KEYS.length; i++) {
    const key = MATERIAL_MONEY_KEYS[i];
    const n = Number(next[key]);
    if (Number.isFinite(n)) next[key] = round(n * rate, 4);
  }
  return next;
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
