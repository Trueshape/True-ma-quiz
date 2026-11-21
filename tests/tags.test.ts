import { describe, expect, it } from 'vitest';
import { countTags, normalizeTag, suggestTags } from '@/lib/tags';

describe('normalizeTag', () => {
  it.each([
    ['  #Storia Romana ', 'storia-romana'],
    ['GEOGRAFIA', 'geografia'],
    ['città d’arte!', 'città-darte'],
    ['  --a--b--  ', 'a-b'],
    ['', ''],
    ['###', ''],
    ['😀', ''],
  ])('%j becomes %j', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected);
  });

  it('cuts at 30 characters and never ends with a hyphen', () => {
    expect(normalizeTag('a'.repeat(40))).toBe('a'.repeat(30));
    expect(normalizeTag('a'.repeat(29) + ' b')).toBe('a'.repeat(29));
  });
});

describe('countTags and suggestTags', () => {
  const known = countTags([['storia', 'roma'], ['storia', 'geografia'], ['romanzi'], null, undefined, ['storia']]);

  it('counts and sorts by use, then name', () => {
    expect(known).toEqual([
      { tag: 'storia', count: 3 },
      { tag: 'geografia', count: 1 },
      { tag: 'roma', count: 1 },
      { tag: 'romanzi', count: 1 },
    ]);
  });

  it('puts tags that start with the text before tags that contain it', () => {
    expect(suggestTags(known, 'rom', []).map((t) => t.tag)).toEqual(['roma', 'romanzi']);
    expect(suggestTags(known, 'oma', []).map((t) => t.tag)).toEqual(['roma', 'romanzi']);
    expect(suggestTags(known, 'ro', []).map((t) => t.tag)).toEqual(['roma', 'romanzi']);
  });

  it('ignores case and a leading #, and skips tags already chosen', () => {
    expect(suggestTags(known, '#STO', []).map((t) => t.tag)).toEqual(['storia']);
    expect(suggestTags(known, 'sto', ['storia'])).toEqual([]);
  });

  it('an empty text returns the most used tags, limited', () => {
    expect(suggestTags(known, '', [], 2).map((t) => t.tag)).toEqual(['storia', 'geografia']);
  });
});
