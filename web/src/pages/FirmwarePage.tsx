import { useEffect, useState } from 'react';

interface Firmware {
  id: number;
  version: string;
  filename: string;
  sha256: string;
  created_at: string;
}

export function FirmwarePage() {
  const [firmwares, setFirmwares] = useState<Firmware[] | null>(null);
  const [version, setVersion] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    fetch('/api/firmware', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setFirmwares)
      .catch(() => setFirmwares([]));
  }

  useEffect(load, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!file) return;
    const body = new FormData();
    body.append('version', version);
    body.append('file', file);
    try {
      const res = await fetch('/api/firmware', { method: 'POST', credentials: 'include', body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('Firmware enviado.');
      setVersion('');
      setFile(null);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? `Falha ao enviar: ${err.message}` : 'falha ao enviar');
    }
  }

  return (
    <main>
      <h2>Firmware</h2>
      {message && <p className="error">{message}</p>}
      <form className="card inline" onSubmit={upload}>
        <input placeholder="versão (ex 1.0.0)" value={version} onChange={(e) => setVersion(e.target.value)} required />
        <input type="file" accept=".bin" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        <button type="submit">Enviar .bin</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Versão</th>
            <th>Arquivo</th>
            <th>SHA-256</th>
            <th>Enviado em</th>
          </tr>
        </thead>
        <tbody>
          {(firmwares ?? []).map((f) => (
            <tr key={f.id}>
              <td>{f.version}</td>
              <td>{f.filename}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{f.sha256.slice(0, 12)}…</td>
              <td>{new Date(f.created_at).toLocaleString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {firmwares !== null && firmwares.length === 0 && <p>Nenhum firmware cadastrado ainda.</p>}
    </main>
  );
}
