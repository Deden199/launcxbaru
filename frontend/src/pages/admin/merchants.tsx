'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRequireAuth } from '@/hooks/useAuth';
import { Check, X, Edit } from 'lucide-react';
import styles from './merchants.module.css';

type Merchant    = { id: string; name: string; phoneNumber: string; mdr: number };
type SubMerchant = { id: string; netzMerchantId: string; netzPartnerId: string; fee: number };
type PGProvider  = { id: string; name: string; credentials: { partnerId: string } };

export default function AdminMerchantsPage() {
  useRequireAuth();

  const [merchants, setMerchants]       = useState<Merchant[]>([]);
  const [subs, setSubs]                 = useState<Record<string, SubMerchant[]>>({});
  const [providers, setProviders]       = useState<PGProvider[]>([]);
  const [selectedProv, setSelectedProv] = useState<string>('');
  const [merchantPgId, setMerchantPgId] = useState<string>('');
  const [fee, setFee]                   = useState<string>('');
  const [loading, setLoading]           = useState<string|false>(false);
  const [error, setError]               = useState<string>('');

  useEffect(() => {
    api.get<Merchant[]>('/admin/merchants').then(r => {
      setMerchants(r.data);
      r.data.forEach(m =>
        api.get<SubMerchant[]>(`/admin/merchants/${m.id}/pg`)
           .then(r2 => setSubs(s => ({ ...s, [m.id]: r2.data })))
      );
    });
    api.get<PGProvider[]>('/admin/pg-providers').then(r => {
      setProviders(r.data);
      if (r.data.length) setSelectedProv(r.data[0].id);
    });
  }, []);

  const connectPG = async (mid: string) => {
    if (!selectedProv)        { setError('Pilih Payment Gateway'); return; }
    if (!merchantPgId.trim()) { setError('Isi Merchant PG ID'); return; }
    if (!fee.trim())          { setError('Isi Fee (%) untuk koneksi'); return; }
    setError(''); setLoading(mid);

    const prov = providers.find(p => p.id === selectedProv)!;
    try {
      await api.post(`/admin/merchants/${mid}/pg`, {
        netzMerchantId: merchantPgId,
        netzPartnerId: prov.credentials.partnerId,
        fee: Number(fee),
      });
      const { data } = await api.get<SubMerchant[]>(`/admin/merchants/${mid}/pg`);
      setSubs(s => ({ ...s, [mid]: data }));
      setMerchantPgId(''); setFee('');
    } catch (e: any) {
      alert(e.response?.data?.error || 'Gagal connect PG');
    } finally {
      setLoading(false);
    }
  };

  const editFee = async (mid: string, s: SubMerchant) => {
    const val = prompt('Masukkan fee baru (%)', s.fee.toString());
    if (val == null) return;
    const newFee = Number(val);
    if (isNaN(newFee)) { alert('Fee harus berupa angka'); return; }
    await api.patch(`/admin/merchants/${mid}/pg/${s.id}`, { fee: newFee });
    const { data } = await api.get<SubMerchant[]>(`/admin/merchants/${mid}/pg`);
    setSubs(s => ({ ...s, [mid]: data }));
  };

  const disconnectPG = async (mid: string, sid: string) => {
    if (!confirm('Yakin disconnect?')) return;
    await api.delete(`/admin/merchants/${mid}/pg/${sid}`);
    setSubs(s => ({ ...s, [mid]: s[mid].filter(x => x.id !== sid) }));
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Merchant Settings</h1>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {merchants.map(m => (
          <div key={m.id} className={styles.card}>
            <div className={styles.header}>
              <div className={styles.name}>
                <Check /> <span>{m.name}</span>
              </div>
              <div className={styles.meta}>
                {m.phoneNumber || '–'} | MDR {m.mdr}%
              </div>
            </div>

            <div className={styles.formRow}>
              <select
                className={styles.select}
                value={selectedProv}
                onChange={e => setSelectedProv(e.target.value)}>
                {providers.map(p =>
                  <option key={p.id} value={p.id}>{p.name}</option>
                )}
              </select>

              <input
                className={styles.input}
                readOnly
                value={providers.find(p => p.id===selectedProv)?.credentials.partnerId || ''}
              />

              <input
                className={styles.input}
                placeholder="Merchant PG ID"
                value={merchantPgId}
                onChange={e => setMerchantPgId(e.target.value)}
              />

              <input
                className={styles.input}
                placeholder="Fee (%)"
                type="number"
                step="0.01"
                min="0"
                value={fee}
                onChange={e => setFee(e.target.value)}
              />

              <button
                className={styles.button}
                disabled={loading===m.id}
                onClick={() => connectPG(m.id)}>
                {loading===m.id ? '…' : 'Connect'}
              </button>
            </div>

            <ul className={styles.list}>
              {(subs[m.id]||[]).map(s => (
                <li key={s.id} className={styles.listItem}>
                  <span>
                    {s.netzMerchantId} | {s.netzPartnerId} | {s.fee}%
                  </span>
                  <div>
                    <button className={styles.iconBtn}
                      onClick={() => editFee(m.id, s)}>
                      <Edit />
                    </button>
                    <button className={styles.iconBtn}
                      onClick={() => disconnectPG(m.id, s.id)}>
                      <X />
                    </button>
                  </div>
                </li>
              ))}
              {!(subs[m.id]||[]).length &&
                <li className={styles.empty}>Belum ada koneksi PG</li>
              }
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
