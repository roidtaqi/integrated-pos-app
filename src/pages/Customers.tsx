import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Plus, User, Phone, MapPin, Trophy } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../services/db';

export default function Customers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', address: '' });

  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  
  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.phone.includes(searchQuery)
  );

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) {
      toast.error('Nama dan Nomor HP wajib diisi!');
      return;
    }

    try {
      await db.customers.add({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        points: 0,
        created_at: new Date().toISOString()
      });
      toast.success('Pelanggan berhasil ditambahkan!');
      setFormData({ name: '', phone: '', address: '' });
      setShowModal(false);
    } catch {
      toast.error('Gagal menambahkan pelanggan');
    }
  };

  return (
    <div className="p-6 h-full flex flex-col bg-slate-50">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pelanggan</h1>
          <p className="text-slate-500">Kelola data pelanggan dan loyalty point</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={20} /> Tambah Pelanggan
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="Cari nama atau nomor HP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-shadow"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filteredCustomers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <User size={64} className="mb-4 opacity-50" />
              <p className="text-lg font-medium">Belum ada data pelanggan</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredCustomers.map(c => (
                <div key={c.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-primary-300 transition-colors">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold text-xl">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                      <Trophy size={14} /> {c.points} Poin
                    </div>
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg">{c.name}</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-500">
                    <div className="flex items-center gap-2">
                      <Phone size={16} /> {c.phone}
                    </div>
                    {c.address && (
                      <div className="flex items-center gap-2">
                        <MapPin size={16} /> {c.address}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-900">Tambah Pelanggan Baru</h3>
            </div>
            <form onSubmit={handleAddCustomer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap *</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                  placeholder="Budi Santoso"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nomor HP *</label>
                <input 
                  type="tel" 
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                  placeholder="08123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Alamat (Opsional)</label>
                <textarea 
                  value={formData.address}
                  onChange={e => setFormData({...formData, address: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none resize-none"
                  rows={3}
                  placeholder="Jl. Merdeka No. 1"
                ></textarea>
              </div>
              
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-3 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                  Batal
                </button>
                <button type="submit" className="flex-1 py-3 font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl transition-colors shadow-sm">
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
