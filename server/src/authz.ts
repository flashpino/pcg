// Rotas /api/* públicas: sem cookie/JWT exigido. Tudo fora de /api (shell do painel,
// assets estáticos) é público por padrão — a SPA decide mostrar login via /api/auth/me.
export const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/client/login',
  '/api/supervisor/login',
  '/api/ingest',
  '/api/provision',
  '/api/device/test',
];

export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/')) return true;
  return PUBLIC_API_ROUTES.includes(path) || path.startsWith('/api/ota/') || path.startsWith('/api/twilio/');
}

// Autorização por role, além da autenticação (jwtVerify, feita no index.ts): token de cliente
// só abre /api/client/*, token de supervisor só abre /api/supervisor/* (visão restrita, somente
// leitura, aos sensores que o admin atribuiu — ver routes/supervisorPortal.ts), token de admin
// abre todo o resto. Token sem `role` (sessões de admin já abertas antes destes milestones) é
// tratado como admin — retrocompatível, sem forçar logout.
export function isAuthorized(path: string, role: string | undefined): boolean {
  if (path.startsWith('/api/client/')) return role === 'client';
  if (path.startsWith('/api/supervisor/')) return role === 'supervisor';
  return role === undefined || role === 'admin';
}
