import { describe, expect, it } from 'vitest';
import { isAuthorized, isPublicRoute } from './authz.js';

describe('isPublicRoute', () => {
  it('libera tudo fora de /api/* (shell do painel, assets estáticos)', () => {
    expect(isPublicRoute('/')).toBe(true);
    expect(isPublicRoute('/logo.png')).toBe(true);
  });

  it('libera login de admin, cliente e supervisor sem token', () => {
    expect(isPublicRoute('/api/auth/login')).toBe(true);
    expect(isPublicRoute('/api/client/login')).toBe(true);
    expect(isPublicRoute('/api/supervisor/login')).toBe(true);
  });

  it('exige token pras demais rotas /api/*', () => {
    expect(isPublicRoute('/api/clients')).toBe(false);
    expect(isPublicRoute('/api/supervisor/sensors')).toBe(false);
  });
});

describe('isAuthorized', () => {
  // Regra nova: supervisor é um terceiro role, restrito à própria fatia (só sensores que o
  // admin atribuiu) — não pode vazar pra rotas de admin nem de cliente, e o inverso também vale.
  it('token de supervisor só abre /api/supervisor/*', () => {
    expect(isAuthorized('/api/supervisor/sensors', 'supervisor')).toBe(true);
    expect(isAuthorized('/api/clients', 'supervisor')).toBe(false);
    expect(isAuthorized('/api/sensors', 'supervisor')).toBe(false);
    expect(isAuthorized('/api/client/sensors', 'supervisor')).toBe(false);
  });

  it('token de cliente não abre rotas de supervisor nem de admin', () => {
    expect(isAuthorized('/api/supervisor/sensors', 'client')).toBe(false);
    expect(isAuthorized('/api/clients', 'client')).toBe(false);
  });

  it('token de admin (ou sessão antiga sem role) não abre rotas de supervisor nem de cliente', () => {
    expect(isAuthorized('/api/supervisor/sensors', 'admin')).toBe(false);
    expect(isAuthorized('/api/supervisor/sensors', undefined)).toBe(false);
    expect(isAuthorized('/api/client/sensors', 'admin')).toBe(false);
  });

  it('token de admin (ou sessão antiga sem role) continua abrindo o resto do painel', () => {
    expect(isAuthorized('/api/clients', 'admin')).toBe(true);
    expect(isAuthorized('/api/clients', undefined)).toBe(true);
  });
});
