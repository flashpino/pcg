import type { FastifyInstance } from 'fastify';
import { getSetting, setSetting } from '../db/queries.js';
import { scheduleWeeklyTest } from '../services/notifier.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/test-schedule', async () => ({
    dow: (await getSetting('test_schedule_dow')) ?? '1',
    time: (await getSetting('test_schedule_time')) ?? '09:00',
  }));

  app.put<{ Body: { dow: string; time: string } }>('/api/settings/test-schedule', async (req) => {
    const { dow, time } = req.body ?? ({} as { dow: string; time: string });
    if (!/^[0-6]$/.test(String(dow)) || !/^\d{2}:\d{2}$/.test(String(time))) {
      throw Object.assign(new Error('dow deve ser 0-6 e time no formato HH:MM'), { statusCode: 400 });
    }
    await setSetting('test_schedule_dow', String(dow));
    await setSetting('test_schedule_time', String(time));
    await scheduleWeeklyTest(String(dow), String(time)); // reprograma o cron em runtime
    return { ok: true };
  });
}
