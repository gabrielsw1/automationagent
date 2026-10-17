import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@copiloto/shared/styles/tokens.css';
import '@copiloto/shared/styles/base.css';
import './console.css';
import App from './App.tsx';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
