import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installErrorCapture } from './errorCapture';
import './index.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && !window.api) {
    const { installBrowserPreviewApi } = await import('./dev/browserPreviewApi');
    installBrowserPreviewApi();
  }

  installErrorCapture();

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Renderer root element #root is missing from index.html');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap().catch((error: unknown) => console.error('Renderer bootstrap failed', error));
