import {
  normalizeSearchTerm,
  parseSearchTermEntityId,
  searchTermEntityId,
} from './term-normalization';

describe('normalizeSearchTerm', () => {
  it("folds case — the brief's own example", () => {
    expect(normalizeSearchTerm('Coat Defense')).toBe('coat defense');
    expect(normalizeSearchTerm('COAT DEFENSE')).toBe(
      normalizeSearchTerm('coat defense'),
    );
  });

  it('collapses and trims whitespace', () => {
    expect(normalizeSearchTerm('  coat   defense  ')).toBe('coat defense');
    expect(normalizeSearchTerm('coat\tdefense\n')).toBe('coat defense');
  });

  it('treats separators as spaces', () => {
    expect(normalizeSearchTerm('coat-defense')).toBe('coat defense');
    expect(normalizeSearchTerm('coat_defense')).toBe('coat defense');
    expect(normalizeSearchTerm('coat/defense')).toBe('coat defense');
  });

  it('drops apostrophes without splitting the word', () => {
    // The failure this prevents: "dog's" → "dog s" would never match "dogs".
    expect(normalizeSearchTerm("dog's shampoo")).toBe('dogs shampoo');
    expect(normalizeSearchTerm('dog’s shampoo')).toBe('dogs shampoo');
    expect(normalizeSearchTerm("dog's shampoo")).toBe(
      normalizeSearchTerm('dogs shampoo'),
    );
  });

  it('drops sentence punctuation', () => {
    expect(normalizeSearchTerm('coat defense, 16 oz.')).toBe(
      'coat defense 16 oz',
    );
    expect(normalizeSearchTerm('coat defense!')).toBe('coat defense');
  });

  it('folds unicode compatibility forms', () => {
    expect(normalizeSearchTerm('ｃｏａｔ ｄｅｆｅｎｓｅ')).toBe('coat defense');
  });

  it('does NOT stem or fold plurals — different terms stay different', () => {
    // Deliberate: "coat" and "coats" perform differently, and collapsing
    // them would make the winner cross-check claim a match that isn't one.
    expect(normalizeSearchTerm('coat')).not.toBe(normalizeSearchTerm('coats'));
  });

  it('is idempotent', () => {
    const once = normalizeSearchTerm("  Dog's   Coat-Defense!  ");
    expect(normalizeSearchTerm(once)).toBe(once);
  });
});

describe('searchTermEntityId / parseSearchTermEntityId', () => {
  it('round-trips a campaign and a verbatim term', () => {
    const id = searchTermEntityId('12345', 'coat defense');
    expect(parseSearchTermEntityId(id)).toEqual({
      campaignId: '12345',
      term: 'coat defense',
    });
  });

  it('keeps the term verbatim, not normalized — the executor must find this exact string', () => {
    const id = searchTermEntityId('12345', "Dog's Coat-Defense");
    expect(parseSearchTermEntityId(id)!.term).toBe("Dog's Coat-Defense");
  });

  it('splits on the FIRST separator so a term containing "::" survives', () => {
    const id = searchTermEntityId('12345', 'weird::term');
    expect(parseSearchTermEntityId(id)).toEqual({
      campaignId: '12345',
      term: 'weird::term',
    });
  });

  it('gives distinct ids for the same term in different campaigns (Guard 1 as identity)', () => {
    expect(searchTermEntityId('111', 'coat defense')).not.toBe(
      searchTermEntityId('222', 'coat defense'),
    );
  });

  it('returns null for an id that carries no separator', () => {
    expect(parseSearchTermEntityId('just-a-term')).toBeNull();
  });

  it('stays inside tasks.entity_id varchar(255) at the longest real term length', () => {
    // Longest search_term observed in this dataset is 200 chars.
    const id = searchTermEntityId('123456789012345', 'x'.repeat(200));
    expect(id.length).toBeLessThanOrEqual(255);
  });
});
