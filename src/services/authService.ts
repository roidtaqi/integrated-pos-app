import { db, initializeDatabase, type PermissionCode, type RoleName, type User } from './db';

export interface SessionUser {
  id: string;
  name: string;
  role: RoleName;
  role_id: string;
  permissions: PermissionCode[];
}

const SESSION_KEY = 'pos_current_user';

function toSessionUser(user: User, permissions: PermissionCode[]): SessionUser {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    role_id: user.role_id,
    permissions
  };
}

export const authService = {
  async login(pin: string) {
    await initializeDatabase();

    const user = await db.users.where('pin').equals(pin).first();
    if (!user || !user.is_active) {
      return { success: false, message: 'PIN salah atau user nonaktif' };
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

  hasPermission(permission: PermissionCode) {
    const user = this.getCurrentUser();
    return Boolean(user?.permissions.includes(permission));
  },

  can(user: SessionUser | null, permission: PermissionCode) {
    return Boolean(user?.permissions.includes(permission));
  }
};
