import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ClientPortalApp } from './ClientPortalApp.js';
import './index.css';

// Sem router instalado: admin em '/', portal do cliente em '/#/portal' — hash não bate no
// servidor, então não precisa de fallback de SPA no fastify-static pra essa rota nova.
const isClientPortal = location.hash.startsWith('#/portal');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isClientPortal ? <ClientPortalApp /> : <App />}</StrictMode>,
);
