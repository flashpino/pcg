import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ClientPortalApp } from './ClientPortalApp.js';
import './index.css';

// Sem router instalado: admin no domínio padrão, portal do cliente no subdomínio 'cliente.*'
// (ver EasyPanel > Domínios). Fragmento de URL (#/portal) NUNCA chega no proxy/servidor —
// só dá pra diferenciar por hostname, que o navegador manda de verdade. Hash mantido como
// fallback pra testar localmente sem precisar de um segundo domínio.
const isClientPortal = location.hostname.startsWith('cliente.') || location.hash.startsWith('#/portal');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isClientPortal ? <ClientPortalApp /> : <App />}</StrictMode>,
);
