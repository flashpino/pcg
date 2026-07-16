import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  alert_temperature: boolean;
  alert_connectivity: boolean;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  renotify_minutes: number;
  days_of_week: number[];
  window_start: string;
  window_end: string;
  timezone: string;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function emptyForm(clientId: number) {
  return {
    client_id: clientId,
    name: '',
    phone: '',
    alert_temperature: true,
    alert_connectivity: true,
    channel_voice: true,
    channel_whatsapp: true,
    renotify_minutes: 60,
    days_of_week: [1, 2, 3, 4, 5] as number[],
    window_start: '07:00',
    window_end: '18:00',
    timezone: 'America/Sao_Paulo',
    welcome: false,
  };
}

export function ClientContacts({ clientId }: { clientId: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm(clientId));

  function load() {
    api.get<Contact[]>(`/api/contacts?clientId=${clientId}`).then(setContacts).catch((err) => setError(err.message));
  }

  useEffect(load, [clientId]);

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(day) ? f.days_of_week.filter((d) => d !== day) : [...f.days_of_week, day].sort(),
    }));
  }

  function edit(c: Contact) {
    setEditingId(c.id);
    setForm({ ...c, welcome: false });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(clientId));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { welcome, ...body } = form;
    try {
      if (editingId) {
        await api.patch(`/api/contacts/${editingId}`, body);
      } else {
        const created = await api.post<Contact>('/api/contacts', body);
        if (welcome) await api.post(`/api/contacts/${created.id}/welcome`);
      }
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
            <input
              type="checkbox"
              checked={form.alert_temperature}
              onChange={(e) => setForm((f) => ({ ...f, alert_temperature: e.target.checked }))}
            />{' '}
            temperatura/umidade
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.alert_connectivity}
              onChange={(e) => setForm((f) => ({ ...f, alert_connectivity: e.target.checked }))}
            />{' '}
            conectividade
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.channel_voice}
              onChange={(e) => setForm((f) => ({ ...f, channel_voice: e.target.checked }))}
            />{' '}
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
        </div>
        <div className="inline">
          {DIAS.map((label, i) => (
            <label key={i}>
              <input type="checkbox" checked={form.days_of_week.includes(i)} onChange={() => toggleDay(i)} /> {label}
            </label>
          ))}
        </div>
        <div className="inline">
          <label>
            janela{' '}
            <input type="time" value={form.window_start} onChange={(e) => setForm((f) => ({ ...f, window_start: e.target.value }))} />
            {' – '}
            <input type="time" value={form.window_end} onChange={(e) => setForm((f) => ({ ...f, window_end: e.target.value }))} />
          </label>
          <input
            placeholder="timezone"
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          />
          <label>
            re-alerta (min){' '}
            <input
              type="number"
              style={{ width: '4rem' }}
              value={form.renotify_minutes}
              onChange={(e) => setForm((f) => ({ ...f, renotify_minutes: Number(e.target.value) }))}
            />
          </label>
        </div>
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
            <th>Janela</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td>
                {c.days_of_week.map((d) => DIAS[d]).join('/')} {c.window_start}-{c.window_end}
              </td>
              <td>
                <button className="secondary" onClick={() => edit(c)}>
                  Editar
                </button>{' '}
                <button className="secondary" onClick={() => sendWelcome(c)}>
                  Boas-vindas
                </button>{' '}
                <button className="secondary" onClick={() => sendTest(c)}>
                  Testar
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
