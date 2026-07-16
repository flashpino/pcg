import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Template {
  key: string;
  whatsapp: string;
  voice: string | null;
}

const LABELS: Record<string, string> = {
  temperature_fire: 'Temperatura — disparo (e re-alerta)',
  temperature_resolve: 'Temperatura — resolvido',
  humidity_fire: 'Umidade — disparo (e re-alerta)',
  humidity_resolve: 'Umidade — resolvido',
  connectivity_fire: 'Conectividade — disparo',
  connectivity_resolve: 'Conectividade — resolvido',
  connectivity_renotify: 'Conectividade — continua offline',
};

const LEGEND: Record<string, string[]> = {
  temperature_fire: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max'],
  temperature_resolve: ['sensor', 'local', 'cliente'],
  humidity_fire: ['sensor', 'local', 'cliente', 'umidade', 'min', 'max'],
  humidity_resolve: ['sensor', 'local', 'cliente'],
  connectivity_fire: ['sensor', 'local', 'cliente', 'segundos'],
  connectivity_resolve: ['sensor', 'local', 'cliente'],
  connectivity_renotify: ['sensor', 'local', 'cliente'],
};

function TemplateForm({ tpl, onSaved }: { tpl: Template; onSaved: () => void }) {
  const [whatsapp, setWhatsapp] = useState(tpl.whatsapp);
  const [voice, setVoice] = useState(tpl.voice ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const hasVoice = tpl.key === 'temperature_fire'; // ligação é exclusiva de alerta de temperatura

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.patch(`/api/message-templates/${tpl.key}`, { whatsapp, voice: hasVoice ? voice : null });
      setStatus('Salvo.');
      onSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'falha ao salvar');
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h3>{LABELS[tpl.key] ?? tpl.key}</h3>
      <label>
        WhatsApp
        <br />
        <textarea
          rows={2}
          style={{ width: '100%' }}
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          required
        />
      </label>
      {hasVoice && (
        <label>
          Ligação de voz (só disparo de temperatura)
          <br />
          <textarea rows={2} style={{ width: '100%' }} value={voice} onChange={(e) => setVoice(e.target.value)} />
        </label>
      )}
      <p>
        <small>Variáveis disponíveis: {LEGEND[tpl.key]?.map((v) => `{{$${v}}}`).join(', ')}</small>
      </p>
      <div className="inline">
        <button type="submit">Salvar</button>
        {status && <small>{status}</small>}
      </div>
    </form>
  );
}

export function MessagesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Template[]>('/api/message-templates').then(setTemplates).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  return (
    <main>
      <h2>Mensagens</h2>
      {error && <p className="error">{error}</p>}
      {templates.map((t) => (
        <TemplateForm key={t.key} tpl={t} onSaved={load} />
      ))}
    </main>
  );
}
