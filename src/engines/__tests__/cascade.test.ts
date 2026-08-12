import { computeCostPlanCascade } from '../../services/costPlan/cascade';

describe('computeCostPlanCascade (client reference)', () => {
  it('matches the verified cascade numbers exactly', () => {
    const cascade = computeCostPlanCascade(462_765.34, {
      designAllowancePercent: 6,
      overheadPercent: 9,
      profitPercent: 5,
      inflationPercent: 3.5,
    });

    expect(cascade.elementalCost).toBe(462_765.34);
    expect(cascade.designAllowanceAmount).toBe(27_765.92);
    expect(cascade.elementalWithDesignAllowance).toBe(490_531.26);
    expect(cascade.overheadAmount).toBe(44_147.81);
    expect(cascade.profitAmount).toBe(24_526.56);
    expect(cascade.constructionCostWithoutInflation).toBe(559_205.63);
    expect(cascade.inflationAmount).toBe(19_572.2);
    expect(cascade.constructionCostSCC).toBe(578_777.83);

    expect(cascade.percentOfElemental.elemental).toBe(100);
    expect(cascade.percentOfElemental.withDesignAllowance).toBe(106);
    expect(cascade.percentOfElemental.withoutInflation).toBe(120.84);
    expect(cascade.percentOfElemental.scc).toBe(125.07);

    // OH and Profit share the same base (do not compound on each other)
    expect(cascade.overheadAmount).toBe(
      Math.round(490_531.26 * 0.09 * 100) / 100,
    );
    expect(cascade.profitAmount).toBe(
      Math.round(490_531.26 * 0.05 * 100) / 100,
    );
  });

  it('adds ratePerM2 on summary lines when gfaM2 is set', () => {
    const cascade = computeCostPlanCascade(
      1000,
      {
        designAllowancePercent: 0,
        overheadPercent: 0,
        profitPercent: 0,
        inflationPercent: 0,
      },
      { gfaM2: 100 },
    );
    expect(cascade.summaryLines[0].ratePerM2).toBe(10);
    expect(cascade.constructionCostSCC).toBe(1000);
  });
});
