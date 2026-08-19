import { expandableKeysFor, resolveMetric } from './fact-source';

describe('resolveMetric — resolves the fact table from PROVENANCE, not the rule', () => {
  it('maps each sync type to the table that sync writes', () => {
    expect(resolveMetric('ads_metrics', 'clicks').factTable).toBe(
      'campaign_metrics_daily',
    );
    expect(resolveMetric('ads_search_term', 'clicks').factTable).toBe(
      'search_term_metrics_daily',
    );
    expect(resolveMetric('ads_targeting', 'clicks').factTable).toBe(
      'target_metrics_daily',
    );
  });

  it('resolves an evidence key to the physical column, which may differ', () => {
    // Search-term evidence says "orders"; the column is orders_7d.
    const r = resolveMetric('ads_search_term', 'orders');
    expect(r.expandable).toBe(true);
    expect(r.column).toBe('orders_7d');
  });

  it("maps a rule's windowed alias onto the same daily column", () => {
    // D4 evidence carries trailing7dSpend; the rows behind it are spend.
    expect(resolveMetric('ads_metrics', 'trailing7dSpend').column).toBe(
      'spend',
    );
  });

  it('marks derived arithmetic as non-expandable with a clear reason', () => {
    // The brief's own example — expected_clicks_per_order has no stored row.
    const r = resolveMetric('ads_search_term', 'expectedClicksPerOrder');
    expect(r.expandable).toBe(false);
    expect(r.reason).toBe('derived');
    expect(r.column).toBeNull();
  });

  it('marks other computed W1 numbers as derived too', () => {
    for (const k of ['clicksThreshold', 'monthlyWaste', 'recentClickShare']) {
      expect(resolveMetric('ads_search_term', k).reason).toBe('derived');
    }
  });

  it('reports unknown_fact_table when provenance identified no sync', () => {
    const r = resolveMetric(null, 'clicks');
    expect(r.expandable).toBe(false);
    expect(r.reason).toBe('unknown_fact_table');
    expect(r.factTable).toBeNull();
  });

  it('reports unknown_metric for a key that is neither a column nor a known derivation', () => {
    expect(resolveMetric('ads_metrics', 'somethingNobodyDefined').reason).toBe(
      'unknown_metric',
    );
  });

  it('does not leak columns across tables — campaign evidence has no cost column', () => {
    // "cost" is the search-term/target column name; campaign metrics use "spend".
    expect(resolveMetric('ads_metrics', 'cost').expandable).toBe(false);
    expect(resolveMetric('ads_search_term', 'cost').expandable).toBe(true);
  });

  it('adding a rule that reads an existing sync type needs no change here', () => {
    // The contract that makes this true: resolution depends only on sync
    // type + metric key, and no rule id appears anywhere in the lookup.
    const asIfNewRule = resolveMetric('ads_targeting', 'clicks');
    expect(asIfNewRule.expandable).toBe(true);
    expect(asIfNewRule.factTable).toBe('target_metrics_daily');
  });
});

describe('expandableKeysFor', () => {
  it('lists the keys a table can expand', () => {
    expect(expandableKeysFor('search_term_metrics_daily')).toEqual(
      expect.arrayContaining(['clicks', 'cost', 'orders']),
    );
  });

  it('returns nothing when no table could be resolved', () => {
    expect(expandableKeysFor(null)).toEqual([]);
  });
});
