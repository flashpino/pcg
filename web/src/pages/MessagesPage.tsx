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
  hardware_fire: 'Hardware — disparo (só admins com telefone cadastrado)',
  hardware_resolve: 'Hardware — resolvido (só admins com telefone cadastrado)',
  reboot_fire: 'Reinício inesperado do device (só admins com telefone cadastrado)',
  welcome: 'Boas-vindas — enviada ao cadastrar contato',
  test: 'Teste de dispositivo (manual/automático)',
};

const LEGEND: Record<string, string[]> = {
  temperature_fire: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max', 'limite'],
  temperature_resolve: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max', 'limite'],
  humidity_fire: ['sensor', 'local', 'cliente', 'umidade', 'min', 'max', 'limite'],
  humidity_resolve: ['sensor', 'local', 'cliente', 'umidade', 'min', 'max', 'limite'],
  connectivity_fire: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max', 'limite', 'segundos'],
  connectivity_resolve: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max', 'limite', 'segundos'],
  connectivity_renotify: ['sensor', 'local', 'cliente', 'temperatura', 'min', 'max', 'limite', 'segundos'],
  hardware_fire: ['sensor', 'local', 'cliente', 'segundos'],
  hardware_resolve: ['sensor', 'local', 'cliente', 'segundos'],
  reboot_fire: ['sensor', 'local', 'cliente', 'motivo', 'quando'],
  welcome: ['nome', 'telefone', 'cliente', 'sensor', 'local', 'temperatura'],
  test: ['sensor', 'local', 'cliente', 'temperatura', 'quando'],
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
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ color: 'var(--on-surface)', fontSize: '1.05rem', textTransform: 'none', letterSpacing: 'normal' }}>
          {LABELS[tpl.key] ?? tpl.key}
        </h3>
        <span className="tpl-badge">whatsapp</span>
      </div>
      <label>
        <small>Template da mensagem</small>
        <textarea
          className="tpl-code"
          rows={2}
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          required
        />
      </label>
      {hasVoice && (
        <label>
          <small>Ligação de voz (só disparo de temperatura)</small>
          <textarea className="tpl-code" rows={2} value={voice} onChange={(e) => setVoice(e.target.value)} />
        </label>
      )}
      <p className="tpl-vars">
        Variáveis: {LEGEND[tpl.key]?.map((v) => <code key={v}>{`{{$${v}}}`}</code>)}
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
