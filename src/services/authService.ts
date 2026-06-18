import { db, initializeDatabase, type PermissionCode, type RoleName, type User } from './db';

export interface SessionUser {
  id: string;
  name: string;
  role: RoleName;
  role_id: string;
  phone?: string;
  email?: string;
  position_title?: string;
  profile_note?: string;
  permissions: PermissionCode[];
}

const SESSION_KEY = 'pos_current_user';

function normalizeEmail(value?: string) {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value?: string) {
  return (value || '').replace(/\D/g, '');
}

function toSessionUser(user: User, permissions: PermissionCode[]): SessionUser {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    role_id: user.role_id,
    phone: user.phone,
    email: user.email,
    position_title: user.position_title,
    profile_note: user.profile_note,
    permissions
  };
}

export const authService = {
  async login(identifierOrPin: string, pin?: string) {
    await initializeDatabase();

    let user: User | undefined;
    if (pin === undefined) {
      user = await db.users.where('pin').equals(identifierOrPin).first();
    } else {
      const email = normalizeEmail(identifierOrPin);
      const phone = normalizePhone(identifierOrPin);
      const candidates = await db.users.where('pin').equals(pin).toArray();
      user = candidates.find((candidate) => {
        const emailMatches = email.length > 0 && normalizeEmail(candidate.email) === email;
        const phoneMatches = phone.length > 0 && normalizePhone(candidate.phone) === phone;
        return candidate.is_active && (emailMatches || phoneMatches);
      });
    }

    if (!user || !user.is_active) {
      return {
        success: false,
        message: pin === undefined ? 'PIN salah atau user nonaktif' : 'Email/nomor HP atau PIN salah'
      };
    }

    const role = await db.roles.get(user.role_id);
    const sessionUser = toSessionUser(user, role?.permissions || []);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));

    await db.audit_logs.add({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      user_id: user.id,
      action: 'LOGIN',
      entity: 'user',
      entity_id: user.id,
      created_at: new Date().toISOString()
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'audit_log', action: 'login', id: user.id } }));
    }

    return { success: true, user: sessionUser };
  },

  logout() {
    localStorage.removeItem(SESSION_KEY);
  },

  getCurrentUser(): SessionUser | null {
    const userStr = localStorage.getItem(SESSION_KEY);
    if (!userStr) return null;

    try {
      return JSON.parse(userStr) as SessionUser;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },

  async refreshCurrentUser() {
    const currentUser = this.getCurrentUser();
    if (!currentUser) return null;

    const user = await db.users.get(currentUser.id);
    if (!user || !user.is_active) {
      this.logout();
      return null;
    }

    const role = await db.roles.get(user.role_id);
    const sessionUser = toSessionUser(user, role?.permissions || []);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    return sessionUser;
  },

  hasPermission(permission: PermissionCode) {
    const user = this.getCurrentUser();
    return Boolean(user?.permissions.includes(permission));
  },

  can(user: SessionUser | null, permission: PermissionCode) {
    return Boolean(user?.permissions.includes(permission));
  }
};
