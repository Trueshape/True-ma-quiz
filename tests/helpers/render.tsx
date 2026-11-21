import * as React from 'react';
import { configure } from '@testing-library/dom';
// The react-dom entry point shipped with the installed React 19 does not load, so the
// client build is imported from its file. Tests only.
// @ts-expect-error no types for a direct file import
import { createRoot } from '../../node_modules/react-dom/cjs/react-dom-client.development.js';

type ActEnv = { IS_REACT_ACT_ENVIRONMENT?: boolean };
const env = globalThis as unknown as ActEnv;
const act = (React as unknown as { act: (cb: () => void) => void }).act;

env.IS_REACT_ACT_ENVIRONMENT = true;

configure({
  eventWrapper: (cb) => {
    let result: unknown;
    act(() => {
      result = cb();
    });
    return result as ReturnType<typeof cb>;
  },
  asyncWrapper: async (cb) => {
    const previous = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const result = await cb();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return result;
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  },
});

const mounted: { root: { unmount: () => void }; container: HTMLElement }[] = [];

export function render(ui: React.ReactElement) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ root, container });
}

export function cleanup() {
  while (mounted.length) {
    const { root, container } = mounted.pop()!;
    act(() => root.unmount());
    container.remove();
  }
}

export { screen } from '@testing-library/dom';
