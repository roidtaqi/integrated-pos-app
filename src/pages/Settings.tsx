import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Receipt, Save, ShieldCheck, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../services/db';
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
  const users = useLiveQuery(() => db.users.toArray(), []) || [];
  const roles = useLiveQuery(() => db.roles.toArray(), []) || [];

  useEffect(() => {
    async function load() {
      setSettings(await settingsService.getReceiptSettings());
    }

    void load();
  }, []);

  const handleSave = async () => {
    await settingsService.saveSettings(settings);
    toast.success('Pengaturan berhasil disimpan.');
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-slate-500">Outlet, struk, role, payment method, dan integrasi</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-4">
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 bg-primary-50 text-primary-700 rounded-xl flex items-center justify-center">
                <Store size={20} />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Informasi Toko</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nama toko</label>
                <input
                  type="text"
                  value={settings.store_name}
                  onChange={(event) => setSettings({ ...settings, store_name: event.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nomor telepon</label>
                <input
                  type="text"
                  value={settings.store_phone}
                  onChange={(event) => setSettings({ ...settings, store_phone: event.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Alamat</label>
              <textarea
                value={settings.store_address}
                onChange={(event) => setSettings({ ...settings, store_address: event.target.value })}
                rows={3}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none resize-none"
              />
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center">
                <Receipt size={20} />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Struk & Pajak</h2>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Footer struk</label>
              <textarea
                value={settings.receipt_footer}
                onChange={(event) => setSettings({ ...settings, receipt_footer: event.target.value })}
                rows={2}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none resize-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4 font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.tax_enabled}
                  onChange={(event) => setSettings({ ...settings, tax_enabled: event.target.checked })}
                  className="w-5 h-5"
                />
                Aktifkan pajak
              </label>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Rate pajak (%)</label>
                <input
                  type="number"
                  value={settings.tax_rate}
                  onChange={(event) => setSettings({ ...settings, tax_rate: Number(event.target.value) })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
            </div>
            <button onClick={() => void handleSave()} className="w-full py-4 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2">
              <Save size={20} /> Simpan Pengaturan
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-4">
              <div className="w-10 h-10 bg-amber-50 text-amber-700 rounded-xl flex items-center justify-center">
                <ShieldCheck size={20} />
              </div>
              <h2 className="text-lg font-bold text-slate-900">User & Role MVP</h2>
            </div>
            <div className="space-y-3">
              {users.map((user) => (
                <div key={user.id} className="flex justify-between items-center rounded-xl bg-slate-50 p-4">
                  <div>
                    <p className="font-bold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.role} · PIN {user.pin}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {user.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Permission Ringkas</h2>
            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex justify-between gap-3">
                    <p className="font-bold text-slate-900">{role.name}</p>
                    <span className="text-xs font-bold text-primary-700">{role.permissions.length} permission</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{role.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
