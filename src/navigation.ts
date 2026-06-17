import {
  ArrowRightLeft,
  BarChart3,
  Clock,
  LayoutDashboard,
  Package,
  RefreshCw,
  Settings,
  ShoppingCart,
  UserRound,
  Users
} from 'lucide-react';
import type { PermissionCode } from './services/db';

export const navItems: {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  permission?: PermissionCode;
}[] = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
  { name: 'Kasir', path: '/pos', icon: ShoppingCart, permission: 'pos:use' },
  { name: 'Produk', path: '/products', icon: Package, permission: 'products:read' },
  { name: 'Stok', path: '/stock', icon: ArrowRightLeft, permission: 'stock:read' },
  { name: 'Shift', path: '/shift', icon: Clock, permission: 'shift:manage' },
  { name: 'Laporan', path: '/reports', icon: BarChart3, permission: 'reports:view' },
  { name: 'Pelanggan', path: '/customers', icon: Users, permission: 'customers:manage' },
  { name: 'Sinkronisasi', path: '/sync', icon: RefreshCw, permission: 'sync:manage' },
  { name: 'Pengaturan', path: '/settings', icon: Settings, permission: 'settings:manage' },
  { name: 'Profil', path: '/profile', icon: UserRound }
];
