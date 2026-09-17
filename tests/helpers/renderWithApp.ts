import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMockApi, type MockApiResult } from '../mocks/api';

export interface RenderWithAppResult {
  mockApi: MockApiResult;
  renderResult: RenderResult;
  user: UserEvent;
}

export const storeResetFns = new Set<() => void>();

export function teardown(): void {
  cleanup();
  if (Object.getOwnPropertyDescriptor(window, 'api')?.configurable) {
    delete (window as unknown as Record<string, unknown>).api;
  }
  for (const resetFn of storeResetFns) resetFn();
}

export function renderWithApp(ui: ReactElement): RenderWithAppResult {
  teardown();

  const mockApi = createMockApi();

  Object.defineProperty(window, 'api', {
    value: mockApi.api,
    writable: true,
    configurable: true,
  });

  for (const resetFn of storeResetFns) resetFn();

  const renderResult = render(ui);
  const user = userEvent.setup();

  return { mockApi, renderResult, user };
}
