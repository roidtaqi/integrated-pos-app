import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, CheckCircle, CloudDownload, CloudUpload, Database, FileJson, FolderUp, RefreshCw, Upload, Wifi } from 'lucide-react';
import toast from 'react-hot-toast';
import { productService } from '../services/productService';
import { syncService } from '../services/syncService';
import { realtimeSyncService } from '../services/realtimeSyncService';
import { authService } from '../services/authService';

export default function Sync() {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPullingCloud, setIsPullingCloud] = useState(false);
  const [isPushingPending, setIsPushingPending] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBackingUpAll, setIsBackingUpAll] = useState(false);
  const [isRestoringAll, setIsRestoringAll] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState(realtimeSyncService.getStatus());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingTx = useLiveQuery(() => syncService.getPendingTransactions(), []) || [];
  const pendingQueue = useLiveQuery(() => syncService.getPendingQueue(), []) || [];

  useEffect(() => {
    const unsubscribe = realtimeSyncService.subscribe(setConnectionStatus);
    return () => {
      unsubscribe();
    };
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus(null);

    const reader = new FileReader();
    reader.onload = async (readerEvent) => {
      try {
        const raw = readerEvent.target?.result as string;
        const result = file.name.toLowerCase().endsWith('.csv')
          ? await productService.importProductsFromCsv(raw)
          : await productService.importProductsFromJson(JSON.parse(raw));

        if (result.success) {
          setImportStatus({ success: true, msg: `Berhasil mengimpor ${result.count} produk.` });
          toast.success('Katalog produk berhasil diperbarui.');
        } else {
          setImportStatus({ success: false, msg: result.message || 'Gagal mengimpor produk.' });
        }
      } catch {
        setImportStatus({ success: false, msg: 'Format file tidak valid. Gunakan JSON/CSV sesuai kontrak Inventory Pricing App.' });
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setImportStatus({ success: false, msg: 'Gagal membaca file.' });
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await syncService.exportSalesData();
      if (!result.success || !result.data) {
        toast.error(result.message || 'Tidak ada data untuk export.');
        return;
      }

      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `pos-sales-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Export dibuat untuk ${result.count} transaksi.`);
    } finally {
      setIsExporting(false);
    }
  };

  const markAsSynced = async () => {
    await syncService.markTransactionsAsSynced(pendingTx.map((transaction) => transaction.id));
    toast.success('Transaksi pending ditandai sudah diekspor.');
  };

  const connectRealtime = async () => {
    setIsConnecting(true);
    try {
      const config = await realtimeSyncService.getConfig();
      await realtimeSyncService.saveConfig(config);
      await realtimeSyncService.connect(config.url);
      realtimeSyncService.startAutoCloudPull();
      realtimeSyncService.startAutoCloudPush();
      toast.success('POS terhubung ke Kastur Cloud.');
    } catch (error) {
      console.error(error);
      toast.error('Gagal menghubungkan POS ke cloud.');
    } finally {
      setIsConnecting(false);
    }
  };

  const pushPendingNow = async () => {
    setIsPushingPending(true);
    try {
      await realtimeSyncService.pushPendingNow();
      toast.success('Pending queue dikirim ke sync server.');
    } catch (error) {
      console.error(error);
      toast.error('Gagal mengirim pending queue.');
    } finally {
      setIsPushingPending(false);
    }
  };

  const pullCloudCatalog = async () => {
    setIsPullingCloud(true);
    try {
      const result = await realtimeSyncService.pullCloudCatalog();
      if (result.success) {
        toast.success(`Cloud catalog diterima: ${result.count} produk.`);
      } else {
        toast.error(result.message || 'Cloud belum memiliki catalog.');
      }
    } catch (error) {
      console.error(error);
      toast.error('Gagal mengambil catalog cloud.');
    } finally {
      setIsPullingCloud(false);
    }
  };

  const backupAllData = async () => {
    setIsBackingUpAll(true);
    try {
      const result = await realtimeSyncService.pushCloudPosSnapshot();
      toast.success(`Semua data POS tersimpan: ${result.records} records.`);
    } catch (error) {
      console.error(error);
      toast.error('Gagal menyimpan semua data POS ke cloud.');
    } finally {
      setIsBackingUpAll(false);
    }
  };

  const restoreAllData = async () => {
    setIsRestoringAll(true);
    try {
      const result = await realtimeSyncService.pullCloudPosSnapshot();
      if (result.success) {
        await authService.refreshCurrentUser();
        toast.success(`Data POS dipulihkan: ${result.records} records.`);
      } else {
        toast.error(result.message || 'Cloud belum memiliki backup POS.');
      }
    } catch (error) {
      console.error(error);
      toast.error('Gagal mengambil semua data POS dari cloud.');
    } finally {
      setIsRestoringAll(false);
    }
  };

  const confirmRestoreAllData = () => {
    toast((item) => (
      <div className="flex max-w-sm flex-col gap-3">
        <div>
          <p className="font-bold text-slate-900">Ambil semua data dari cloud?</p>
          <p className="mt-1 text-sm text-slate-600">Data POS di device ini akan disamakan dengan backup cloud.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              toast.dismiss(item.id);
              void restoreAllData();
            }}
            className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-bold text-white"
          >
            Lanjut
          </button>
          <button
            type="button"
            onClick={() => toast.dismiss(item.id)}
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
          >
            Batal
          </button>
        </div>
      </div>
    ), { duration: 8000, position: 'top-center' });
  };

  const connectionLabel: Record<typeof connectionStatus, string> = {
    CONNECTED: 'Terhubung',
    CONNECTING: 'Menghubungkan',
    DISABLED: 'Belum aktif',
    OFFLINE: 'Offline',
    ERROR: 'Error'
  };
  const connectionClass = connectionStatus === 'CONNECTED'
    ? 'bg-emerald-50 text-emerald-700'
    : connectionStatus === 'CONNECTING'
      ? 'bg-amber-50 text-amber-700'
      : connectionStatus === 'ERROR'
        ? 'bg-danger/10 text-danger'
        : 'bg-slate-100 text-slate-600';
  const formatIntervalLabel = (intervalMs: number) => intervalMs < 60000
    ? `${Math.round(intervalMs / 1000)} detik`
    : `${Math.round(intervalMs / 60000)} menit`;
  const autoPullIntervalMs = realtimeSyncService.getAutoPullIntervalMs();
  const autoPushIntervalMs = realtimeSyncService.getAutoPushIntervalMs();
  const autoPullLabel = formatIntervalLabel(autoPullIntervalMs);
  const autoPushLabel = formatIntervalLabel(autoPushIntervalMs);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 pb-24 sm:px-6 sm:py-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:gap-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Sinkronisasi</h1>
          <p className="mt-1 text-sm text-slate-500">Status cloud, transaksi pending, dan backup data POS.</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Cloud Sync Kastur</h2>
              <p className="mt-1 text-sm text-slate-500">POS otomatis memakai server Kastur Cloud.</p>
            </div>
            <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-bold ${connectionClass}`}>
              {connectionLabel[connectionStatus]}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Pending</p>
              <p className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">{pendingTx.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Queue</p>
              <p className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">{pendingQueue.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Mode</p>
              <p className="mt-1 text-sm font-extrabold text-emerald-700">Auto Sync</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              onClick={() => void connectRealtime()}
              disabled={isConnecting}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:bg-slate-300"
            >
              <Wifi size={18} />
              {isConnecting ? 'Menghubungkan...' : 'Hubungkan Ulang'}
            </button>
            <button
              onClick={() => void pullCloudCatalog()}
              disabled={isPullingCloud}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <CloudDownload size={18} />
              {isPullingCloud ? 'Mengambil...' : 'Ambil Catalog'}
            </button>
            <button
              onClick={() => void pushPendingNow()}
              disabled={isPushingPending}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-900 disabled:bg-slate-300"
            >
              <Upload size={18} />
              {isPushingPending ? 'Mengirim...' : 'Kirim Pending'}
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700">
                <Database size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-emerald-900">Data POS Cloud</h3>
                <p className="mt-1 text-sm text-emerald-800">
                  Menyimpan penjualan, pembayaran, shift, kas, stok, pelanggan, user, outlet, audit, dan settings toko. POS otomatis upload perubahan setiap {autoPushLabel}, lalu mengambil data cloud setiap {autoPullLabel} saat device aman untuk di-update.
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void backupAllData()}
                disabled={isBackingUpAll}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
              >
                <CloudUpload size={18} />
                {isBackingUpAll ? 'Menyimpan...' : 'Backup Semua Data'}
              </button>
              <button
                type="button"
                onClick={confirmRestoreAllData}
                disabled={isRestoringAll}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <CloudDownload size={18} />
                {isRestoringAll ? 'Mengambil...' : 'Ambil Semua Data'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">File Manual</h2>
              <p className="mt-1 text-sm text-slate-500">Cadangan jika cloud belum dipakai.</p>
            </div>
            <RefreshCw className="h-5 w-5 shrink-0 text-slate-400" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <FolderUp size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-900">Import Katalog</h3>
                  <p className="mt-1 text-sm text-slate-500">JSON/CSV dari Inventory.</p>
                </div>
              </div>
              <input type="file" accept=".json,.csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="mt-3 flex min-h-11 w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:bg-slate-300"
              >
                {isImporting ? 'Mengimpor...' : 'Pilih JSON/CSV'}
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Upload size={20} />
                  {pendingTx.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{pendingTx.length}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-900">Export Sales</h3>
                  <p className="mt-1 text-sm text-slate-500">{pendingTx.length} transaksi pending.</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => void handleExport()}
                  disabled={isExporting || pendingTx.length === 0}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-900 disabled:bg-slate-300"
                >
                  <FileJson size={18} />
                  {isExporting ? 'Memproses...' : 'Download'}
                </button>
                <button
                  onClick={() => void markAsSynced()}
                  disabled={pendingTx.length === 0}
                  className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Tandai Selesai
                </button>
              </div>
            </div>
          </div>
        </section>

        {importStatus && (
          <div className={`flex items-center gap-3 rounded-xl p-4 ${importStatus.success ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'}`}>
            {importStatus.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-bold sm:text-base">{importStatus.msg}</span>
          </div>
        )}

      </div>
    </div>
  );
}
