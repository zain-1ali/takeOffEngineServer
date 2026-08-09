import {
  buildConversionLogEntry,
  clearCurrencyQuotesForTests,
  convertRateLib,
  createCurrencyQuote,
  takeCurrencyQuote,
} from '../../services/currencyConvert';
import type { RateLib } from '../rateAnalysis';

const sampleLib: RateLib = {
  materials: [{ code: 'CEM', desc: 'Cement', unit: 'bag', rate: 10, wastage: 0 }],
  labour: [{ code: 'LAB', desc: 'Labourer', unit: 'day', rate: 20 }],
  equipment: [{ code: 'MIX', desc: 'Mixer', unit: 'day', rate: 40 }],
  methods: [],
  analyses: {},
};

describe('currencyConvert', () => {
  beforeEach(() => clearCurrencyQuotesForTests());

  it('applies a mocked Frankfurter rate to all rate-bank costs', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      expect(url).toBe('https://api.frankfurter.dev/v2/rate/USD/EUR');
      return {
        ok: true,
        json: async () => ({
          date: '2026-08-01',
          base: 'USD',
          quote: 'EUR',
          rate: 0.92,
        }),
      } as Response;
    });

    const quote = await createCurrencyQuote('USD', 'EUR', fetchImpl as any);
    expect(quote.rate).toBe(0.92);
    expect(quote.rateDate).toBe('2026-08-01');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const converted = convertRateLib(sampleLib, quote.rate);
    expect(converted.materials[0].rate).toBe(9.2);
    expect(converted.labour[0].rate).toBe(18.4);
    expect(converted.equipment[0].rate).toBe(36.8);

    const taken = takeCurrencyQuote(quote.quoteId);
    expect(taken.rate).toBe(0.92);
    expect(() => takeCurrencyQuote(quote.quoteId)).toThrow(/expired|not found/i);

    const log = buildConversionLogEntry(quote, 'user-123');
    expect(log.fromCurrency).toBe('USD');
    expect(log.toCurrency).toBe('EUR');
    expect(log.rateUsed).toBe(0.92);
    expect(log.triggeredBy).toBe('user-123');
    expect(log.rateDate).toBe('2026-08-01');
  });

  it('fails clearly when Frankfurter is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      createCurrencyQuote('USD', 'EUR', fetchImpl as any),
    ).rejects.toThrow(/Could not reach the Frankfurter/i);
  });
});
