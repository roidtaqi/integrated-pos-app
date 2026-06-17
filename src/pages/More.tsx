import { NavLink } from 'react-router-dom';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { authService } from '../services/authService';
import { navItems } from '../navigation';

const primaryMobilePaths = new Set(['/pos', '/products', '/stock', '/shift']);

export default function More() {
  const user = authService.getCurrentUser();
  const menuItems = navItems.filter((item) =>
    !primaryMobilePaths.has(item.path) && (!item.permission || authService.can(user, item.permission))
  );

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-6">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <MoreHorizontal size={26} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Lainnya</h1>
        <p className="text-slate-500">Menu tambahan sesuai akses role kamu.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {menuItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Icon size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900">{item.name}</div>
              </div>
              <ChevronRight size={20} className="shrink-0 text-slate-400" />
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
