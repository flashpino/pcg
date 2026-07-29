import { defineConfig, devices } from '@playwright/test';

// As credenciais do E2E são as mesmas que o server usa pra semear o admin
// (server/src/index.ts:120), então não há seed próprio de teste.
try {
  process.loadEnvFile('../.env');
} catch {
  // CI injeta ADMIN_EMAIL/ADMIN_PASSWORD direto no ambiente.
}

export default defineConfig({
  testDir: './e2e',
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // ponytail: só chromium. Adicionar firefox/webkit quando aparecer bug de browser.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Sobe server + vite se ainda não estiverem de pé. O Postgres NÃO sobe aqui —
  // `docker compose up -d db` antes.
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../server',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
