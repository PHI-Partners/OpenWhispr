export function installErrorCapture(): void {
  window.onerror = (message, _source, _lineno, _colno, error) => {
    void window.api.logRendererError({
      message: error?.message ?? (typeof message === 'string' ? message : 'Unknown error'),
      stack: error?.stack ?? null,
      source: 'error',
    });
  };

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    void window.api.logRendererError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
      source: 'unhandledrejection',
    });
  };
}
