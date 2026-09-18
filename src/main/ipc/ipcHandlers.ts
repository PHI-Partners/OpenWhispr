import { ipcMain } from 'electron';
import { InvokeChannel, type RendererErrorPayload } from '@shared/ipc';
import type { Logger } from '../logger';

export interface IpcHandlerDeps {
  logger: Logger;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    InvokeChannel.LogRendererError,
    (_event: unknown, payload: RendererErrorPayload) => {
      deps.logger.error(
        'renderer',
        `[${payload.source}] ${payload.message}${payload.stack ? '\n' + payload.stack : ''}`,
      );
    },
  );
}
