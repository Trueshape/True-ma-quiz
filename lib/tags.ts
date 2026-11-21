export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export type TagCount = { tag: string; count: number };

// Same rules the database applies when saving a quiz: lower case, no leading #,
// spaces become hyphens, at most 30 characters. Other punctuation is dropped here.
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-$/, '');
}

export function countTags(lists: (string[] | null | undefined)[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const tag of list ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Tags that start with the typed text come first, then the ones that contain it.
// An empty query returns the most used tags. `known` is expected sorted by count.
export function suggestTags(known: TagCount[], query: string, exclude: string[], limit = 8): TagCount[] {
  const q = query.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
  const skip = new Set(exclude);
  const starts: TagCount[] = [];
  const contains: TagCount[] = [];
  for (const item of known) {
    if (skip.has(item.tag)) continue;
    if (!q || item.tag.startsWith(q)) starts.push(item);
    else if (item.tag.includes(q)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}
