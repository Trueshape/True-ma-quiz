'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MAX_TAGS, normalizeTag, suggestTags, type TagCount } from '@/lib/tags';
import { cn } from '@/lib/utils';

type TagBoxProps = {
  chips: string[];
  onChipsChange: (chips: string[]) => void;
  text: string;
  onTextChange: (text: string) => void;
  /** Every tag that exists, most used first, used for the suggestions. */
  known: TagCount[];
  /** Editor: Enter or comma turns the typed text into a tag. Search: only listed tags can be picked. */
  allowNew?: boolean;
  /** Editor: show the most used tags as soon as the box is focused. */
  suggestWhenEmpty?: boolean;
  maxChips?: number;
  placeholder?: string;
  icon?: React.ReactNode;
  id?: string;
};

export function TagBox({
  chips,
  onChipsChange,
  text,
  onTextChange,
  known,
  allowNew = false,
  suggestWhenEmpty = false,
  maxChips = MAX_TAGS,
  placeholder,
  icon,
  id,
}: TagBoxProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const suggestions = useMemo(
    () => (text.trim() || suggestWhenEmpty ? suggestTags(known, text, chips) : []),
    [known, text, chips, suggestWhenEmpty]
  );
  const showList = open && suggestions.length > 0 && chips.length < maxChips;

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    onTextChange('');
    setActive(-1);
    if (!tag || chips.includes(tag) || chips.length >= maxChips) return;
    onChipsChange([...chips, tag]);
  };

  // A comma ends a tag. Handled on the inserted text, not on the key, so typing fast,
  // pasting "one, two, three" and on-screen keyboards all work.
  const onTextInput = (value: string) => {
    if (allowNew && value.includes(',')) {
      const parts = value.split(',');
      const rest = parts.pop() ?? '';
      const next = [...chips];
      for (const part of parts) {
        const tag = normalizeTag(part);
        if (tag && !next.includes(tag) && next.length < maxChips) next.push(tag);
      }
      if (next.length !== chips.length) onChipsChange(next);
      onTextChange(rest);
    } else {
      onTextChange(value);
    }
    setOpen(true);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (showList && active >= 0) {
        e.preventDefault();
        add(suggestions[active].tag);
      } else if (allowNew && normalizeTag(text)) {
        e.preventDefault();
        add(text);
      }
    } else if (e.key === 'Backspace' && text === '' && chips.length > 0) {
      onChipsChange(chips.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (allowNew && normalizeTag(text) && !wrapRef.current?.contains(e.relatedTarget as Node | null)) add(text);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 min-h-[44px] text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        onClick={() => wrapRef.current?.querySelector('input')?.focus()}
      >
        {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
        {chips.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary pl-2.5 pr-1 py-0.5 text-xs font-medium">
            #{tag}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-primary/20"
              aria-label={`Remove tag ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                onChipsChange(chips.filter((t) => t !== tag));
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={text}
          onChange={(e) => onTextInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={chips.length >= maxChips ? '' : placeholder}
          disabled={chips.length >= maxChips && !text}
          className="flex-1 min-w-[8rem] bg-transparent outline-none placeholder:text-muted-foreground h-7"
          autoComplete="off"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-border bg-card/95 backdrop-blur-md shadow-xl p-1 max-h-64 overflow-auto"
        >
          {suggestions.map((s, i) => (
            <li key={s.tag} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(s.tag)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-left',
                  i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                )}
              >
                <span>#{s.tag}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
