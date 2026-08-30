'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeId = 'default' | 'frutiger' | 'liquid-metal' | 'vhs';

export const THEMES: { id: ThemeId; label: string; description: string; swatch: string[] }[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Deep space dark',
    swatch: ['#7c3aed', '#db2777', '#1e293b'],
  },
  {
    id: 'frutiger',
    label: 'Frutiger Metro',
    description: 'Crisp tiles & neon cyan',
    swatch: ['#00d4e8', '#00e896', '#0a1a20'],
  },
  {
    id: 'liquid-metal',
    label: 'Liquid Metal',
    description: 'Brushed silver monochrome',
    swatch: ['#a0aec0', '#718096', '#111318'],
  },
  {
    id: 'vhs',
    label: 'VHS 80s',
    description: 'Neon tape aesthetic',
    swatch: ['#ff2d78', '#ffe033', '#0d0217'],
  },
];

const CLASS_MAP: Record<ThemeId, string> = {
  default: 'theme-default',
  frutiger: 'theme-frutiger',
  'liquid-metal': 'theme-liquid-metal',
  vhs: 'theme-vhs',
};

const STORAGE_KEY = 'truemaquiz_theme';

type ThemeCtx = {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
};

const ThemeContext = createContext<ThemeCtx>({ theme: 'default', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>('default');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && CLASS_MAP[saved]) apply(saved);
  }, []);

  function apply(t: ThemeId) {
    const html = document.documentElement;
    // Remove all theme classes first
    Object.values(CLASS_MAP).forEach((cls) => html.classList.remove(cls));
    html.classList.add(CLASS_MAP[t]);
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: apply }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
