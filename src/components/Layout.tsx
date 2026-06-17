import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRightLeft,
  BarChart3,
  Clock,
  LayoutDashboard,
  LogOut,
  Package,
  RefreshCw,
  Settings,
  ShoppingCart,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { authService } from '../services/authService';
import type { PermissionCode } from '../services/db';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const navItems: {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  permission: PermissionCode;
}[] = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
  { name: 'Kasir', path: '/pos', icon: ShoppingCart, permission: 'pos:use' },
  { name: 'Produk', path: '/products', icon: Package, permission: 'products:read' },
  { name: 'Stok', path: '/stock', icon: ArrowRightLeft, permission: 'stock:read' },
  { name: 'Shift', path: '/shift', icon: Clock, permission: 'shift:manage' },
  { name: 'Laporan', path: '/reports', icon: BarChart3, permission: 'reports:view' },
  { name: 'Pelanggan', path: '/customers', icon: Users, permission: 'customers:manage' },
  { name: 'Sinkronisasi', path: '/sync', icon: RefreshCw, permission: 'sync:manage' },
  { name: 'Pengaturan', path: '/settings', icon: Settings, permission: 'settings:manage' }
];

export default function Layout() {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const allowedNav = useMemo(
    () => navItems.filter((item) => authService.can(user, item.permission)),
    [user]
  );

  const handleLogout = () => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <span className="font-medium text-slate-800">Keluar dari aplikasi?</span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              authService.logout();
              navigate('/login');
              toast.dismiss(t.id);
            }}
            className="px-3 py-1.5 bg-danger text-white rounded-md text-sm font-bold"
          >
            Ya, Keluar
          </button>
          <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1.5 bg-slate-200 text-slate-800 rounded-md text-sm font-bold">
            Batal
          </button>
        </div>
      </div>
    ), { duration: 5000, position: 'top-center' });
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      <aside className="w-64 bg-white border-r border-slate-200 flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <h1 className="text-xl font-bold text-primary-700 flex items-center gap-2">
            <span className="bg-primary-600 text-white p-1.5 rounded-lg">
              <ShoppingCart size={20} />
            </span>
            Kastur POS
          </h1>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {allowedNav.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )
              }
            >
              <item.icon size={18} />
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold',
            isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          )}>
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            {isOnline ? 'Online' : 'Offline'} · transaksi tetap lokal
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user?.name || 'Unknown'}</p>
              <p className="text-xs text-slate-500 truncate">{user?.role || 'Staff'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
              title="Keluar"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pb-16 md:pb-0">
        <Outlet />
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200">
        <div className="grid grid-cols-5">
          {allowedNav.slice(0, 5).map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-bold',
                  isActive ? 'text-primary-700 bg-primary-50' : 'text-slate-500'
                )
              }
            >
              <item.icon size={20} />
              <span className="truncate max-w-full px-1">{item.name}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
