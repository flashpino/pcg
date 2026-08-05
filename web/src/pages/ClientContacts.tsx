import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  timezone: string;
  active: boolean;
}

type AlertType = 'connectivity' | 'temperature' | 'humidity' | 'test' | 'daily';

interface AlertPref {
  alert_type: AlertType;
  enabled: boolean;
  days_of_week: number[];
  window_start: string | null;
  window_end: string | null;
  renotify_minutes: number;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const TYPE_ORDER: AlertType[] = ['connectivity', 'temperature', 'humidity', 'test', 'daily'];
const TYPE_LABELS: Record<AlertType, string> = {
  connectivity: 'Conectividade (Online/Offline)',
  temperature: 'Temperatura',
  humidity: 'Umidade',
  test: 'Teste manual',
  daily: 'Mensagem diária (está tudo bem)',
};

function emptyPref(type: AlertType): AlertPref {
  // A diária não é alerta: os dias/horário são o AGENDAMENTO do envio, então nasce seg-sex 08:00
  // e desligada — ligar sozinha significaria um WhatsApp por dia pra todo contato novo.
  if (type === 'daily') {
    return { alert_type: type, enabled: false, days_of_week: [1, 2, 3, 4, 5], window_start: '08:00', window_end: null, renotify_minutes: 0 };
  }
  return { alert_type: type, enabled: type !== 'humidity', days_of_week: [0, 1, 2, 3, 4, 5, 6], window_start: null, window_end: null, renotify_minutes: 60 };
}

function emptyPrefs(): Record<AlertType, AlertPref> {
  return { connectivity: emptyPref('connectivity'), temperature: emptyPref('temperature'), humidity: emptyPref('humidity'), test: emptyPref('test'), daily: emptyPref('daily') };
}

function emptyForm(clientId: number) {
  return { client_id: clientId, name: '', phone: '', channel_voice: true, channel_whatsapp: true, timezone: 'America/Sao_Paulo', active: true, welcome: false };
}

// O Postgres devolve TIME como 'HH:MM:SS' e <input type="time"> sem step= descarta o valor com
// segundos, deixando o campo em branco depois de recarregar o contato.
const hhmm = (t: string | null) => t?.slice(0, 5) ?? '';

function AlertPrefSection({ pref, onChange }: { pref: AlertPref; onChange: (pref: AlertPref) => void }) {
  function toggleDay(day: number) {
    onChange({
      ...pref,
      days_of_week: pref.days_of_week.includes(day) ? pref.days_of_week.filter((d) => d !== day) : [...pref.days_of_week, day].sort(),
    });
  }

  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <label>
        <input type="checkbox" checked={pref.enabled} onChange={(e) => onChange({ ...pref, enabled: e.target.checked })} />{' '}
        <strong>{TYPE_LABELS[pref.alert_type]}</strong>
      </label>
      {pref.enabled && (
        <>
          <div className="inline" style={{ marginTop: '0.5rem' }}>
            {DIAS.map((label, i) => (
              <label key={i}>
                <input type="checkbox" checked={pref.days_of_week.includes(i)} onChange={() => toggleDay(i)} /> {label}
              </label>
            ))}
          </div>
          {pref.alert_type === 'daily' ? (
            <>
              <div className="inline">
                <label>
                  1º envio{' '}
                  <input
                    type="time"
                    required
                    value={hhmm(pref.window_start)}
                    onChange={(e) => onChange({ ...pref, window_start: e.target.value || null })}
                  />
                </label>
                <label>
                  repetir a cada (min){' '}
                  <input
                    type="number"
                    min={0}
                    style={{ width: '4rem' }}
                    value={pref.renotify_minutes}
                    onChange={(e) => onChange({ ...pref, renotify_minutes: Number(e.target.value) })}
                  />
                </label>
                <label>
                  repetir até{' '}
                  <input
                    type="time"
                    value={hhmm(pref.window_end)}
                    onChange={(e) => onChange({ ...pref, window_end: e.target.value || null })}
                  />
                </label>
              </div>
              <small>
                Repetir a cada <strong>0</strong> = uma vez por dia. Sem "repetir até", repete até o fim do dia.
                Enviada nos dias marcados, e só nos sensores sem alerta disparado.
              </small>
            </>
          ) : (
            <div className="inline">
              <label>
                janela (vazio = sem restrição de horário){' '}
                <input
                  type="time"
                  value={hhmm(pref.window_start)}
                  onChange={(e) => onChange({ ...pref, window_start: e.target.value || null })}
                />
                {' – '}
                <input
                  type="time"
                  value={hhmm(pref.window_end)}
                  onChange={(e) => onChange({ ...pref, window_end: e.target.value || null })}
                />
              </label>
              <label>
                re-alerta (min){' '}
                <input
                  type="number"
                  style={{ width: '4rem' }}
                  value={pref.renotify_minutes}
                  onChange={(e) => onChange({ ...pref, renotify_minutes: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ClientContacts({ clientId }: { clientId: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm(clientId));
  const [prefs, setPrefs] = useState<Record<AlertType, AlertPref>>(emptyPrefs());

  function load() {
    api.get<Contact[]>(`/api/contacts?clientId=${clientId}`).then(setContacts).catch((err) => setError(err.message));
  }

  useEffect(load, [clientId]);

  async function edit(c: Contact) {
    setEditingId(c.id);
    setForm({ ...c, welcome: false });
    const rows = await api.get<AlertPref[]>(`/api/contacts/${c.id}/alert-prefs`);
    const byType = emptyPrefs();
    for (const row of rows) byType[row.alert_type] = row;
    setPrefs(byType);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(clientId));
    setPrefs(emptyPrefs());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { welcome, ...body } = form;
    try {
      const contactId = editingId ?? (await api.post<Contact>('/api/contacts', body)).id;
      if (editingId) await api.patch(`/api/contacts/${editingId}`, body);
      await Promise.all(TYPE_ORDER.map((type) => api.put(`/api/contacts/${contactId}/alert-prefs/${type}`, prefs[type])));
      if (!editingId && welcome) await api.post(`/api/contacts/${contactId}/welcome`);
      cancelEdit();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao salvar');
    }
  }

  async function remove(c: Contact) {
    if (!window.confirm(`Remover contato "${c.name}"?`)) return;
    await api.del(`/api/contacts/${c.id}`);
    load();
  }

  async function sendWelcome(c: Contact) {
    await api.post(`/api/contacts/${c.id}/welcome`);
    window.alert('Boas-vindas enfileiradas.');
  }

  async function sendTest(c: Contact) {
    await api.post(`/api/contacts/${c.id}/test`);
    window.alert('Teste enfileirado.');
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <form className="card" onSubmit={submit}>
        <h3>{editingId ? 'Editar contato' : 'Novo contato'}</h3>
        <div className="inline">
          <input placeholder="nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          <input
            placeholder="telefone (E.164, ex +5511999999999)"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            required
          />
        </div>
        <div className="inline">
          <label>
            <input type="checkbox" checked={form.channel_voice} onChange={(e) => setForm((f) => ({ ...f, channel_voice: e.target.checked }))} />{' '}
            voz
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.channel_whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, channel_whatsapp: e.target.checked }))}
            />{' '}
            whatsapp
          </label>
          <label>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />{' '}
            <strong>Contato ativo</strong>
          </label>
        </div>

        <h3>Preferências de alertas</h3>
        <p>
          <small>
            Cada tipo de alerta tem seu próprio liga/desliga, dias, horário e intervalo de re-alerta. Na mensagem
            diária, os dias e o horário são o agendamento do envio.
          </small>
        </p>
        {TYPE_ORDER.map((type) => (
          <AlertPrefSection key={type} pref={prefs[type]} onChange={(p) => setPrefs((cur) => ({ ...cur, [type]: p }))} />
        ))}

        {!editingId && (
          <div className="inline">
            <label>
              <input
                type="checkbox"
                checked={form.welcome}
                onChange={(e) => setForm((f) => ({ ...f, welcome: e.target.checked }))}
              />{' '}
              enviar boas-vindas ao cadastrar
            </label>
          </div>
        )}
        <div className="inline">
          <button type="submit">{editingId ? 'Salvar' : 'Adicionar'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={cancelEdit}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td className={c.active ? 'status-online' : 'status-offline'}>{c.active ? 'ativo' : 'inativo'}</td>
              <td>
                <button className="secondary" onClick={() => edit(c)}>
                  Editar
                </button>{' '}
                <button className="secondary" onClick={() => sendWelcome(c)}>
                  Boas-vindas
                </button>{' '}
                <button className="secondary" onClick={() => sendTest(c)}>
                  Testar canal
                </button>{' '}
                <button className="danger" onClick={() => remove(c)}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
