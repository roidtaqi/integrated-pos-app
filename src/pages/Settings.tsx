import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Receipt, Save, ShieldCheck, Store, UserRoundCog, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { db, type PermissionCode, type Role, type RoleName, type User } from '../services/db';
import { settingsService, type ReceiptSettings } from '../services/settingsService';

const emptySettings: ReceiptSettings = {
  store_name: '',
  store_address: '',
  store_phone: '',
  receipt_footer: '',
  tax_enabled: false,
  tax_rate: 0
};

const emptyUserDraft = {
  name: '',
  pin: '',
  role_id: '',
  is_active: true,
  phone: '',
  email: '',
  position_title: '',
  profile_note: ''
};

type UserDraft = typeof emptyUserDraft;
const EMPTY_USERS: User[] = [];
const EMPTY_ROLES: Role[] = [];
const EMPTY_PERMISSIONS: Array<{ code: PermissionCode; name: string }> = [];

const permissionGroups: Array<{ title: string; codes: PermissionCode[] }> = [
  {
    title: 'Operasional',
    codes: ['dashboard:view', 'pos:use', 'shift:manage', 'customers:manage', 'receipt:print']
  },
  {
    title: 'Produk & Stok',
    codes: ['products:read', 'products:manage', 'stock:read', 'stock:manage']
  },
  {
    title: 'Laporan & Sync',
    codes: ['reports:view', 'sync:manage']
  },
  {
    title: 'Kontrol Admin',
    codes: ['settings:manage', 'users:manage', 'discount:apply', 'void:manage', 'refund:manage', 'cash:manage']
  }
];

function toUserDraft(user?: User): UserDraft {
  if (!user) return emptyUserDraft;

  return {
    name: user.name,
    pin: user.pin,
    role_id: user.role_id,
    is_active: user.is_active,
    phone: user.phone || '',
    email: user.email || '',
    position_title: user.position_title || '',
    profile_note: user.profile_note || ''
  };
}

function roleNameFromRole(role?: Role): RoleName {
  return role?.name || 'Kasir';
}

export default function Settings() {
  const currentUser = authService.getCurrentUser();
  const canManageUsers = authService.can(currentUser, 'users:manage');
  const [settings, setSettings] = useState<ReceiptSettings>(emptySettings);
  const users = useLiveQuery(() => db.users.toArray(), []) ?? EMPTY_USERS;
  const roles = useLiveQuery(() => db.roles.toArray(), []) ?? EMPTY_ROLES;
  const permissions = useLiveQuery(() => db.permissions.toArray(), []) ?? EMPTY_PERMISSIONS;
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userDraftState, setUserDraftState] = useState<{ userId: string; values: Partial<UserDraft> }>({ userId: '', values: {} });
  const [selectedRoleId, setSelectedRoleId] = useState('role_admin');
  const [roleDraftState, setRoleDraftState] = useState<{ roleId: string; description?: string; permissions?: PermissionCode[] }>({ roleId: '' });

  const activeSelectedUserId = selectedUserId || users[0]?.id || '';
  const selectedUser = useMemo(
    () => users.find((user) => user.id === activeSelectedUserId),
    [activeSelectedUserId, users]
  );

  const editableRoles = roles.filter((role) => role.id !== 'role_owner');
  const activeSelectedRoleId = selectedRoleId || roles.find((role) => role.id === 'role_admin')?.id || editableRoles[0]?.id || roles[0]?.id || '';
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === activeSelectedRoleId),
    [activeSelectedRoleId, roles]
  );
  const canEditSelectedUser = canManageUsers || selectedUser?.id === currentUser?.id;
  const baseUserDraft = useMemo(() => toUserDraft(selectedUser), [selectedUser]);
  const userDraft = userDraftState.userId === selectedUser?.id
    ? { ...baseUserDraft, ...userDraftState.values }
    : baseUserDraft;
  const roleDescription = roleDraftState.roleId === selectedRole?.id && roleDraftState.description !== undefined
    ? roleDraftState.description
    : selectedRole?.description || '';
  const rolePermissions = roleDraftState.roleId === selectedRole?.id && roleDraftState.permissions
    ? roleDraftState.permissions
    : selectedRole?.permissions || [];

  const permissionMap = useMemo(
    () => new Map(permissions.map((permission) => [permission.code, permission.name])),
    [permissions]
  );

  const ownerPermissionCount = permissions.length;

  useEffect(() => {
    async function load() {
      setSettings(await settingsService.getReceiptSettings());
    }

    void load();
  }, []);

  const handleSaveSettings = async () => {
    await settingsService.saveSettings(settings);
    toast.success('Pengaturan berhasil disimpan.');
  };

  const updateUserDraft = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => {
    if (!selectedUser) return;
    setUserDraftState((draft) => ({
      userId: selectedUser.id,
      values: draft.userId === selectedUser.id ? { ...draft.values, [key]: value } : { [key]: value }
    }));
  };

  const handleSaveUser = async () => {
    if (!canEditSelectedUser || !selectedUser) return;
    if (!userDraft.name.trim()) {
      toast.error('Nama user wajib diisi.');
      return;
    }
    if (!/^\d{4,6}$/.test(userDraft.pin)) {
      toast.error('PIN harus berupa 4-6 digit angka.');
      return;
    }

    const duplicatePin = users.find((user) => user.id !== selectedUser.id && user.pin === userDraft.pin);
    if (duplicatePin) {
      toast.error(`PIN sudah dipakai oleh ${duplicatePin.name}.`);
      return;
    }

    const nextRole = canManageUsers
      ? roles.find((role) => role.id === userDraft.role_id)
      : roles.find((role) => role.id === selectedUser.role_id);

    await db.users.update(selectedUser.id, {
      name: userDraft.name.trim(),
      pin: userDraft.pin,
      role_id: canManageUsers ? userDraft.role_id : selectedUser.role_id,
      role: roleNameFromRole(nextRole),
      phone: userDraft.phone.trim(),
      email: userDraft.email.trim(),
      position_title: userDraft.position_title.trim(),
      profile_note: userDraft.profile_note.trim(),
      is_active: canManageUsers ? userDraft.is_active : selectedUser.is_active
    });

    if (selectedUser.id === currentUser?.id) {
      await authService.refreshCurrentUser();
    }

    setUserDraftState({ userId: '', values: {} });
    toast.success('Profil user berhasil disimpan.');
  };

  const togglePermission = (permission: PermissionCode) => {
    if (!canManageUsers || !selectedRole || selectedRole.id === 'role_owner') return;
    const nextPermissions = rolePermissions.includes(permission)
      ? rolePermissions.filter((item) => item !== permission)
      : [...rolePermissions, permission];

    setRoleDraftState((draft) => ({
      roleId: selectedRole.id,
      description: draft.roleId === selectedRole.id ? draft.description : roleDescription,
      permissions: nextPermissions
    }));
  };

  const handleSaveRole = async () => {
    if (!canManageUsers || !selectedRole) return;

    const nextPermissions = selectedRole.id === 'role_owner'
      ? permissions.map((permission) => permission.code)
      : rolePermissions;

    await db.roles.update(selectedRole.id, {
      description: roleDescription.trim(),
      permissions: nextPermissions
    });

    if (selectedRole.id === currentUser?.role_id) {
      await authService.refreshCurrentUser();
    }

    setRoleDraftState({ roleId: '' });
    toast.success('Permission role berhasil disimpan.');
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-slate-500">Outlet, struk, user, profile role, permission, dan integrasi</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.05fr] gap-4">
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
            <button onClick={() => void handleSaveSettings()} className="w-full py-4 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2">
              <Save size={20} /> Simpan Pengaturan
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 bg-amber-50 text-amber-700 rounded-xl flex items-center justify-center">
                <UserRoundCog size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Profil User</h2>
                <p className="text-sm text-slate-500">Owner bisa mengubah data diri, role, PIN, dan status user.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-4">
              <div className="space-y-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      activeSelectedUserId === user.id
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-slate-200 bg-slate-50 hover:border-primary-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-900">{user.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                        {user.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{user.role} · PIN {user.pin}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {!canManageUsers && (
                  <div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                    Kamu bisa mengubah profil sendiri. Role, status, dan permission hanya bisa diubah Owner.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Nama lengkap</label>
                    <input
                      value={userDraft.name}
                      disabled={!canEditSelectedUser}
                      onChange={(event) => updateUserDraft('name', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">PIN</label>
                    <input
                      value={userDraft.pin}
                      disabled={!canEditSelectedUser}
                      onChange={(event) => updateUserDraft('pin', event.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Role</label>
                    <select
                      value={userDraft.role_id}
                      disabled={!canManageUsers}
                      onChange={(event) => updateUserDraft('role_id', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={userDraft.is_active}
                      disabled={!canManageUsers}
                      onChange={(event) => updateUserDraft('is_active', event.target.checked)}
                      className="h-5 w-5"
                    />
                    User aktif
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Nomor HP</label>
                    <input
                      value={userDraft.phone}
                      disabled={!canEditSelectedUser}
                      onChange={(event) => updateUserDraft('phone', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                    <input
                      value={userDraft.email}
                      disabled={!canEditSelectedUser}
                      onChange={(event) => updateUserDraft('email', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Jabatan / keterangan singkat</label>
                  <input
                    value={userDraft.position_title}
                    disabled={!canEditSelectedUser}
                    onChange={(event) => updateUserDraft('position_title', event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Catatan profile</label>
                  <textarea
                    value={userDraft.profile_note}
                    disabled={!canEditSelectedUser}
                    onChange={(event) => updateUserDraft('profile_note', event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                  />
                </div>

                <button
                  onClick={() => void handleSaveUser()}
                  disabled={!canEditSelectedUser}
                  className="w-full rounded-xl bg-primary-600 py-3 font-bold text-white hover:bg-primary-700 disabled:bg-slate-300"
                >
                  Simpan Profil User
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 bg-violet-50 text-violet-700 rounded-xl flex items-center justify-center">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Permission Role</h2>
                <p className="text-sm text-slate-500">Owner selalu punya semua permission. Role lain bisa disesuaikan.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-4">
              <div className="space-y-2">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      activeSelectedRoleId === role.id
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-slate-200 bg-slate-50 hover:border-primary-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-900">{role.name}</p>
                      <span className="text-xs font-bold text-primary-700">
                        {role.id === 'role_owner' ? ownerPermissionCount : role.permissions.length}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{role.description}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {selectedRole?.id === 'role_owner' && (
                  <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    Owner dikunci dengan akses penuh agar selalu bisa memulihkan permission user lain.
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Keterangan role</label>
                  <textarea
                    value={roleDescription}
                    disabled={!canManageUsers}
                    onChange={(event) => {
                      if (!selectedRole) return;
                      setRoleDraftState((draft) => ({
                        roleId: selectedRole.id,
                        description: event.target.value,
                        permissions: draft.roleId === selectedRole.id ? draft.permissions : rolePermissions
                      }));
                    }}
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:text-slate-500"
                  />
                </div>

                <div className="space-y-3">
                  {permissionGroups.map((group) => (
                    <div key={group.title} className="rounded-xl border border-slate-200 p-3">
                      <h3 className="mb-2 text-sm font-bold text-slate-900">{group.title}</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {group.codes.map((code) => {
                          const isEnabled = selectedRole?.id === 'role_owner' || rolePermissions.includes(code);
                          return (
                            <button
                              key={code}
                              type="button"
                              disabled={!canManageUsers || selectedRole?.id === 'role_owner'}
                              onClick={() => togglePermission(code)}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                                isEnabled
                                  ? 'border-primary-200 bg-primary-50 text-primary-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-500'
                              } disabled:cursor-default`}
                            >
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${isEnabled ? 'bg-primary-600 text-white' : 'bg-slate-200 text-transparent'}`}>
                                <Check size={14} />
                              </span>
                              <span>{permissionMap.get(code) || code}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => void handleSaveRole()}
                  disabled={!canManageUsers}
                  className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  Simpan Permission Role
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
              <Users size={18} />
              Ringkasan Role
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {roles.map((role) => (
                <div key={role.id} className="rounded-lg bg-white p-3">
                  <div className="font-bold text-slate-900">{role.name}</div>
                  <div className="text-xs text-slate-500">{role.id === 'role_owner' ? ownerPermissionCount : role.permissions.length} permission</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
