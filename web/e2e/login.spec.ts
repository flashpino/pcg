import { expect, test } from '@playwright/test';

// ponytail: sem Page Object — uma tela, dois campos. Vira classe quando um
// terceiro spec precisar do mesmo login.
const EMAIL = process.env.ADMIN_EMAIL!;
const PASSWORD = process.env.ADMIN_PASSWORD!;

test.describe('Login do painel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('entra com credencial válida e chega no dashboard', async ({ page }) => {
    await page.getByPlaceholder('admin@exemplo.com').fill(EMAIL);
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();

    // a topbar só renderiza depois que /api/auth/me confirma a sessão
    await expect(page.getByText(EMAIL)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  });

  test('credencial inválida mostra erro e não entra', async ({ page }) => {
    await page.getByPlaceholder('admin@exemplo.com').fill(EMAIL);
    await page.getByPlaceholder('••••••••').fill('senha-errada');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.locator('.error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('sair volta pra tela de login', async ({ page }) => {
    await page.getByPlaceholder('admin@exemplo.com').fill(EMAIL);
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText(EMAIL)).toBeVisible();

    await page.getByTitle('Sair').click();

    await expect(page.getByRole('heading', { name: 'Acesso Administrativo' })).toBeVisible();
  });
});
