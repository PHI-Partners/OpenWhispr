import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { InvokeChannel, type InvokeContract, type RendererErrorPayload } from '@shared/ipc';
import type { Logger } from '../logger';

export interface IpcHandlerDeps {
  logger: Logger;
}

// ── Origin allowlist ──

function getAllowedOriginPrefixes(): string[] {
  const prefixes = ['file://'];
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) prefixes.push(devUrl);
  return prefixes;
}

// ── Validated handle wrapper ──

type Validator<TArgs extends unknown[]> = (args: unknown[]) => TArgs;

let handlerLogger: Logger;
let allowedPrefixes: string[];

function handle<TArgs extends unknown[], TReturn>(
  channel: string,
  validator: Validator<TArgs>,
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...rawArgs: unknown[]) => {
    const frame = event.senderFrame;
    if (!frame) {
      handlerLogger.warn('ipc', `Rejected ${channel}: missing sender frame`);
      throw new Error(`IPC rejected on "${channel}": missing sender frame`);
    }

    const isAllowed = allowedPrefixes.some((prefix) => frame.url.startsWith(prefix));
    if (!isAllowed) {
      handlerLogger.warn('ipc', `Rejected ${channel}: origin not allowed (${frame.url})`);
      throw new Error(`IPC rejected on "${channel}": origin not allowed`);
    }

    let validatedArgs: TArgs;
    try {
      validatedArgs = validator(rawArgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      handlerLogger.warn('ipc', `Validation failed on ${channel}: ${msg}`);
      throw new Error(`IPC validation failed on "${channel}": ${msg}`, { cause: err });
    }

    try {
      return await fn(...validatedArgs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handlerLogger.error('ipc', `Handler error on ${channel}: ${message}`);
      throw new Error(message, { cause: err });
    }
  });
}

// ── Validators ──

const noArgs: Validator<[]> = (args) => {
  if (args.length > 0) throw new Error('expected no arguments');
  return [] as unknown as [];
};

const validateMeetingId: Validator<[number]> = (args) => {
  if (args.length !== 1) throw new Error('expected exactly one argument');
  const id = args[0];
  if (typeof id !== 'number') throw new Error('id must be a number');
  if (!Number.isInteger(id)) throw new Error('id must be an integer');
  if (id < 1) throw new Error('id must be a positive integer');
  return [id];
};

const validateRendererErrorPayload: Validator<[RendererErrorPayload]> = (args) => {
  if (args.length !== 1) throw new Error('expected exactly one argument');
  const payload = args[0];
  if (typeof payload !== 'object' || payload === null) throw new Error('payload must be an object');
  const p = payload as Record<string, unknown>;
  if (typeof p.message !== 'string') throw new Error('payload.message must be a string');
  if (p.stack !== null && typeof p.stack !== 'string')
    throw new Error('payload.stack must be a string or null');
  if (p.source !== 'error' && p.source !== 'unhandledrejection')
    throw new Error('payload.source must be "error" or "unhandledrejection"');
  return [payload as RendererErrorPayload];
};

// ── Registration ──

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  handlerLogger = deps.logger;
  allowedPrefixes = getAllowedOriginPrefixes();

  handle<[RendererErrorPayload], void>(
    InvokeChannel.LogRendererError,
    validateRendererErrorPayload,
    (payload) => {
      deps.logger.error(
        'renderer',
        `[${payload.source}] ${payload.message}${payload.stack ? '\n' + payload.stack : ''}`,
      );
    },
  );

  handle<[], ReturnType<InvokeContract['meeting-recording-start']>>(
    InvokeChannel.MeetingRecordingStart,
    noArgs,
    () => {
      throw new Error('Not implemented');
    },
  );

  handle<[], void>(InvokeChannel.MeetingRecordingStop, noArgs, () => {
    throw new Error('Not implemented');
  });

  handle<[], ReturnType<InvokeContract['db-list-meetings']>>(InvokeChannel.DbListMeetings, noArgs, () => {
    throw new Error('Not implemented');
  });

  handle<[number], ReturnType<InvokeContract['db-get-meeting']>>(
    InvokeChannel.DbGetMeeting,
    validateMeetingId,
    () => {
      throw new Error('Not implemented');
    },
  );
}
