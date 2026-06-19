import { useEffect, useState } from 'react';
import { Receipt, Save, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { settingsService, type ReceiptSettings } from '../services/settingsService';

const emptySettings: ReceiptSettings = {
  store_name: '',
  store_address: '',
  store_phone: '',
  receipt_footer: '',
  tax_enabled: false,
  tax_rate: 0
};

export default function Settings() {
  const [settings, setSettings] = useState<ReceiptSettings>(emptySettings);

  useEffect(() => {
    async function load() {
      setSettings(await settingsService.getReceiptSettings());
    }

    void load();
  }, []);

  const handleSaveSettings = async () => {
    await settingsService.saveSettings(settings);
    window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'settings', action: 'updated' } }));
    toast.success('Pengaturan berhasil disimpan.');
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pengaturan</h1>
          <p className="text-slate-500">Informasi toko, struk, dan pajak.</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <Store size={20} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Informasi Toko</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Nama toko</label>
              <input
                type="text"
                value={settings.store_name}
                onChange={(event) => setSettings({ ...settings, store_name: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Nomor telepon</label>
              <input
                type="text"
                value={settings.store_phone}
                onChange={(event) => setSettings({ ...settings, store_phone: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-bold text-slate-700">Alamat</label>
            <textarea
              value={settings.store_address}
              onChange={(event) => setSettings({ ...settings, store_address: event.target.value })}
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Receipt size={20} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Struk & Pajak</h2>
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Footer struk</label>
            <textarea
              value={settings.receipt_footer}
              onChange={(event) => setSettings({ ...settings, receipt_footer: event.target.value })}
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-700">
              <input
                type="checkbox"
                checked={settings.tax_enabled}
                onChange={(event) => setSettings({ ...settings, tax_enabled: event.target.checked })}
                className="h-5 w-5"
              />
              Aktifkan pajak
            </label>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Rate pajak (%)</label>
              <input
                type="number"
                value={settings.tax_rate}
                onChange={(event) => setSettings({ ...settings, tax_rate: Number(event.target.value) })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <button onClick={() => void handleSaveSettings()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-4 font-bold text-white shadow-sm transition-colors hover:bg-primary-700">
            <Save size={20} /> Simpan Pengaturan
          </button>
        </section>
      </div>
    </div>
  );
}
