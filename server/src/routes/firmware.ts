import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFirmware, getFirmwareByVersion, getSensorByToken, listFirmwares } from '../db/queries.js';

// Relativo ao cwd do processo (server/, tanto em dev quanto no container — ver Dockerfile/compose).
const FIRMWARE_DIR = path.join(process.cwd(), 'firmware-bin');

export async function firmwareRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(FIRMWARE_DIR, { recursive: true });

  // Admin (JWT) — gestão de versões.
  app.get('/api/firmware', async () => listFirmwares());

  app.post('/api/firmware', async (req) => {
    let version: string | undefined;
    let saved: { filename: string; sha256: string } | undefined;

    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'version') {
        version = String(part.value);
      } else if (part.type === 'file' && part.fieldname === 'file') {
        const buf = await part.toBuffer();
        // Magic byte do binário ESP32 — um .bin errado brickaria um device remoto.
        if (buf.length === 0 || buf[0] !== 0xe9) {
          throw Object.assign(new Error('arquivo não é um firmware ESP32 válido (magic byte)'), { statusCode: 400 });
        }
        await writeFile(path.join(FIRMWARE_DIR, part.filename), buf);
        saved = { filename: part.filename, sha256: createHash('sha256').update(buf).digest('hex') };
      }
    }

    if (!version) throw Object.assign(new Error('version obrigatório'), { statusCode: 400 });
    if (!saved) throw Object.assign(new Error('arquivo obrigatório'), { statusCode: 400 });
    if (await getFirmwareByVersion(version)) {
      throw Object.assign(new Error('versão já cadastrada'), { statusCode: 409 });
    }

    return createFirmware(version, saved.filename, saved.sha256);
  });

  // Device — auth por token (header OU querystring, ver GOTCHA da Task 12/net.cpp). Pública (index.ts: /api/ota/*).
  app.get<{ Params: { version: string }; Querystring: { token?: string } }>(
    '/api/ota/firmware/:version.bin',
    async (req, reply) => {
      const token = (req.headers['x-device-token'] as string | undefined) ?? req.query.token;
      if (!token || !(await getSensorByToken(token))) {
        throw Object.assign(new Error('token inválido'), { statusCode: 401 });
      }
      const fw = await getFirmwareByVersion(req.params.version);
      if (!fw) throw Object.assign(new Error('firmware não encontrado'), { statusCode: 404 });
      reply.header('content-type', 'application/octet-stream');
      return reply.send(createReadStream(path.join(FIRMWARE_DIR, fw.filename)));
    },
  );
}
