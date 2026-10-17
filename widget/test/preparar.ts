import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
