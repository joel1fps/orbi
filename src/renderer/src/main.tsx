import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot, useApp } from './store';

// Test harness hook (dev builds only).
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp;

void boot().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
