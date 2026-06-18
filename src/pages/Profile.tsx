import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Save, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { db, type User } from '../services/db';

const emptyProfile = {
  name: '',
  pin: '',
  phone: '',
  email: '',
  position_title: '',
  profile_note: ''
};

type ProfileDraft = typeof emptyProfile;

function toProfileDraft(user?: User): ProfileDraft {
  if (!user) return emptyProfile;

  return {
    name: user.name,
    pin: user.pin,
    phone: user.phone || '',
    email: user.email || '',
    position_title: user.position_title || '',
    profile_note: user.profile_note || ''
  };
}

export default function Profile() {
  const sessionUser = authService.getCurrentUser();
  const user = useLiveQuery(
    () => sessionUser ? db.users.get(sessionUser.id) : undefined,
    [sessionUser?.id]
  );
  const [draftOverrides, setDraftOverrides] = useState<Partial<ProfileDraft>>({});
  const baseDraft = useMemo(() => toProfileDraft(user), [user]);
  const draft = { ...baseDraft, ...draftOverrides };

  const updateDraft = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setDraftOverrides((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!draft.name.trim()) {
      toast.error('Nama wajib diisi.');
      return;
    }
    if (!/^\d{4,6}$/.test(draft.pin)) {
      toast.error('PIN harus berupa 4-6 digit angka.');
      return;
    }

    const duplicatePin = await db.users.where('pin').equals(draft.pin).first();
    if (duplicatePin && duplicatePin.id !== user.id) {
      toast.error(`PIN sudah dipakai oleh ${duplicatePin.name}.`);
      return;
    }

    await db.users.update(user.id, {
      name: draft.name.trim(),
      pin: draft.pin,
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      position_title: draft.position_title.trim(),
      profile_note: draft.profile_note.trim()
    });
    await authService.refreshCurrentUser();
    setDraftOverrides({});
    window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'user', action: 'profile_updated', id: user.id } }));
    toast.success('Profil berhasil diperbarui.');
  };

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Profil Saya</h1>
        <p className="text-slate-500">Ubah data diri, kontak, catatan profile, dan PIN login.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <UserRound size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{user?.name || 'User'}</h2>
            <p className="text-sm text-slate-500">{user?.role || 'Role'} · {user?.is_active ? 'Aktif' : 'Nonaktif'}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Nama lengkap</label>
              <input
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">PIN</label>
              <input
                value={draft.pin}
                onChange={(event) => updateDraft('pin', event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Nomor HP</label>
              <input
                value={draft.phone}
                onChange={(event) => updateDraft('phone', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Email</label>
              <input
                value={draft.email}
                onChange={(event) => updateDraft('email', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Jabatan / keterangan singkat</label>
            <input
              value={draft.position_title}
              onChange={(event) => updateDraft('position_title', event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Catatan profile</label>
            <textarea
              value={draft.profile_note}
              onChange={(event) => updateDraft('profile_note', event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={() => void handleSave()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-4 font-bold text-white shadow-sm transition-colors hover:bg-primary-700"
          >
            <Save size={20} /> Simpan Profil
          </button>
        </div>
      </div>
    </div>
  );
}
