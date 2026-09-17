/** Services the handlers delegate to; each feature task adds the service its channels need. */
export type IpcHandlerDeps = Record<string, never>;

/** Single registration point for the `ipcMain.handle` of every invoke channel in `@shared/ipc`. */
export function registerIpcHandlers(_deps: IpcHandlerDeps): void {}
