import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ClientPortalApp } from './ClientPortalApp.js';
import { SupervisorPortalApp } from './SupervisorPortalApp.js';
import './index.css';

// Sem router instalado: admin no domínio padrão, portal do cliente no subdomínio 'cliente.*',
// portal do supervisor no subdomínio 'supervisor.*' (ver EasyPanel > Domínios). Fragmento de URL
// (#/portal, #/supervisor) NUNCA chega no proxy/servidor — só dá pra diferenciar por hostname,
// que o navegador manda de verdade. Hash mantido como fallback pra testar localmente sem
// precisar de um segundo domínio.
const isClientPortal = location.hostname.startsWith('cliente.') || location.hash.startsWith('#/portal');
const isSupervisorPortal = location.hostname.startsWith('supervisor.') || location.hash.startsWith('#/supervisor');

function Root() {
  if (isSupervisorPortal) return <SupervisorPortalApp />;
  if (isClientPortal) return <ClientPortalApp />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
