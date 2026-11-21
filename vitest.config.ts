import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
    },
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
