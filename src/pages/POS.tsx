import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Package,
  Printer,
  QrCode,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  Wallet
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useReactToPrint } from 'react-to-print';
import toast from 'react-hot-toast';
import { productService, type ProductWithUnits } from '../services/productService';
import { transactionService } from '../services/transactionService';
import { authService } from '../services/authService';
import { shiftService } from '../services/shiftService';
import { settingsService } from '../services/settingsService';
import { Receipt, type ReceiptProps } from '../components/Receipt';
import type { PaymentMethod, ProductUnit } from '../services/db';
import { formatRupiah } from '../utils/format';

interface CartItem {
  product_id: string;
  unit_id: string;
  name: string;
  barcode: string;
  units: ProductUnit[];
  unit_name: string;
  price: number;
  qty: number;
  discount: number;
  stock_qty: number;
}

const paymentMethods: { method: PaymentMethod; label: string; icon: typeof Banknote; className: string }[] = [
  { method: 'cash', label: 'Cash', icon: Banknote, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { method: 'qris', label: 'QRIS', icon: QrCode, className: 'bg-sky-50 text-sky-700 border-sky-200' },
  { method: 'transfer', label: 'Transfer', icon: Wallet, className: 'bg-violet-50 text-violet-700 border-violet-200' },
  { method: 'edc', label: 'EDC', icon: CreditCard, className: 'bg-amber-50 text-amber-700 border-amber-200' }
];

export default function POS() {
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
  const [inputAmount, setInputAmount] = useState('');
  const [paymentSplits, setPaymentSplits] = useState<{ method: PaymentMethod; amount: number }[]>([]);
  const [transactionDiscount, setTransactionDiscount] = useState(0);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<ReceiptProps | null>(null);

  const receiptRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const user = authService.getCurrentUser();
  const canDiscount = authService.hasPermission('discount:apply');
  const liveProducts = useLiveQuery(() => productService.getActiveProductsWithUnits(), []);
  const products = useMemo(() => liveProducts || [], [liveProducts]);
  const settings = useLiveQuery(() => settingsService.getReceiptSettings(), []) || null;

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    onAfterPrint: () => setShowReceiptDialog(false)
  });

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) =>
      product.name.toLowerCase().includes(query) ||
      product.sku.toLowerCase().includes(query) ||
      product.barcode.includes(searchQuery.trim()) ||
      product.category.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const itemDiscountTotal = cart.reduce((sum, item) => sum + item.discount, 0);
  const sanitizedTransactionDiscount = Math.min(Math.max(0, transactionDiscount), Math.max(0, subtotal - itemDiscountTotal));
  const taxableAmount = subtotal - itemDiscountTotal - sanitizedTransactionDiscount;
  const taxTotal = settings?.tax_enabled ? Math.round(taxableAmount * ((settings.tax_rate || 0) / 100)) : 0;
  const total = taxableAmount + taxTotal;
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPaidSoFar = paymentSplits.reduce((sum, payment) => sum + payment.amount, 0);
  const remainingToPay = Math.max(0, total - totalPaidSoFar);

  const addToCart = (product: ProductWithUnits, unit = product.defaultUnit) => {
    setCart((previousCart) => {
      const existing = previousCart.find((item) => item.product_id === product.id && item.unit_id === unit.id);
      if (existing) {
        return previousCart.map((item) =>
          item.product_id === product.id && item.unit_id === unit.id
            ? { ...item, qty: item.qty + 1 }
            : item
        );
      }

      return [
        ...previousCart,
        {
          product_id: product.id,
          unit_id: unit.id,
          name: product.name,
          barcode: product.barcode || '-',
          units: product.units,
          unit_name: unit.unit_name,
          price: unit.active_selling_price,
          qty: 1,
          discount: 0,
          stock_qty: product.stock_qty
        }
      ];
    });
  };

  const handleSearchEnter = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    const productByBarcode = await productService.findByBarcode(query);
    if (productByBarcode) {
      addToCart(productByBarcode);
      setSearchQuery('');
      toast.success(`${productByBarcode.name} ditambahkan`);
      return;
    }

    if (filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
      setSearchQuery('');
      return;
    }

    toast.error('Produk tidak ditemukan atau hasil pencarian masih lebih dari satu.');
  };

  const updateQty = (productId: string, unitId: string, delta: number) => {
    setCart((previousCart) => previousCart.map((item) => {
      if (item.product_id !== productId || item.unit_id !== unitId) return item;
      return { ...item, qty: Math.max(1, item.qty + delta) };
    }));
  };

  const updateUnit = (productId: string, currentUnitId: string, nextUnitId: string) => {
    setCart((previousCart) => previousCart.map((item) => {
      if (item.product_id !== productId || item.unit_id !== currentUnitId) return item;

      const nextUnit = item.units.find((unit) => unit.id === nextUnitId);
      if (!nextUnit) return item;

      return {
        ...item,
        unit_id: nextUnit.id,
        unit_name: nextUnit.unit_name,
        price: nextUnit.active_selling_price,
        discount: Math.min(item.discount, nextUnit.active_selling_price * item.qty)
      };
    }));
  };

  const updateItemDiscount = (productId: string, unitId: string, value: number) => {
    setCart((previousCart) => previousCart.map((item) => {
      if (item.product_id !== productId || item.unit_id !== unitId) return item;
      return { ...item, discount: Math.min(Math.max(0, value), item.price * item.qty) };
    }));
  };

  const removeItem = (productId: string, unitId: string) => {
    setCart((previousCart) => previousCart.filter((item) => item.product_id !== productId || item.unit_id !== unitId));
  };

  const clearCart = () => {
    setCart([]);
    setTransactionDiscount(0);
    setPaymentSplits([]);
  };

  const initiateCheckout = async () => {
    if (cart.length === 0) return;
    if (!user) {
      toast.error('Sesi telah habis, silakan login kembali.');
      return;
    }

    const currentShift = await shiftService.getCurrentShift(user.id);
    if (!currentShift) {
      toast.error('Shift belum dibuka. Buka shift sebelum menerima pembayaran.');
      return;
    }

    setPaymentSplits([]);
    setInputAmount(total.toString());
    setSelectedMethod('cash');
    setPaymentModal(true);
  };

  const handleAddPayment = () => {
    const amount = Number(inputAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Nominal pembayaran tidak valid.');
      return;
    }

    setPaymentSplits((previous) => [...previous, { method: selectedMethod, amount }]);
    const newPaid = totalPaidSoFar + amount;
    setInputAmount(newPaid < total ? String(total - newPaid) : '');
  };

  const processTransaction = async () => {
    if (cart.length === 0 || !user) return;

    let finalPayments = [...paymentSplits];
    const currentInputAmount = Number(inputAmount);
    if (Number.isFinite(currentInputAmount) && currentInputAmount > 0 && finalPayments.reduce((sum, payment) => sum + payment.amount, 0) < total) {
      finalPayments = [...finalPayments, { method: selectedMethod, amount: currentInputAmount }];
    }

    if (finalPayments.reduce((sum, payment) => sum + payment.amount, 0) < total) {
      toast.error('Total pembayaran masih kurang dari tagihan.');
      return;
    }

    const currentShift = await shiftService.getCurrentShift(user.id);
    if (!currentShift) {
      toast.error('Shift belum dibuka. Buka shift sebelum menyimpan transaksi.');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await transactionService.processCheckout({
        cashier_id: user.id,
        outlet_id: currentShift.outlet_id,
        shift_id: currentShift.id,
        items: cart.map((item) => ({
          product_id: item.product_id,
          unit_id: item.unit_id,
          qty: item.qty,
          discount: item.discount
        })),
        payments: finalPayments,
        transaction_discount: sanitizedTransactionDiscount,
        tax_rate: settings?.tax_enabled ? settings.tax_rate : 0
      });

      setLastReceipt({
        transactionId: result.transactionId,
        cashierName: user.name,
        createdAt: new Date().toISOString(),
        storeName: settings?.store_name || 'Kastur POS',
        storeAddress: settings?.store_address || '-',
        storePhone: settings?.store_phone || '-',
        receiptFooter: settings?.receipt_footer || 'Terima kasih',
        items: result.items.map((item) => ({
          name: item.product_name,
          unitName: item.unit_name,
          qty: item.qty,
          price: item.unit_price,
          discount: item.discount,
          subtotal: item.subtotal
        })),
        subtotal: result.subtotal,
        discountTotal: result.discountTotal,
        taxTotal: result.taxTotal,
        total: result.total,
        paid: result.paid,
        change: result.change,
        payments: finalPayments
      });

      clearCart();
      setPaymentModal(false);
      setShowReceiptDialog(true);
      toast.success('Transaksi berhasil disimpan offline.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memproses transaksi.';
      toast.error(message);
    } finally {
      setIsProcessing(false);
      searchInputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-full w-full font-sans print:hidden relative overflow-hidden">
      <div className="flex-1 flex flex-col h-full bg-slate-50 border-r border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Scan barcode atau cari nama/SKU produk"
                className="w-full pl-12 pr-4 py-3 bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white transition-all outline-none"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSearchEnter();
                }}
              />
            </div>
            <button
              onClick={() => void handleSearchEnter()}
              className="p-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors active:bg-slate-300"
              title="Scan / tambah produk"
            >
              <ScanLine size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
              <Package size={64} className="mb-4 opacity-50" />
              <p className="text-lg font-medium">Tidak ada produk ditemukan</p>
              <p className="text-sm">Import katalog dari menu Sinkronisasi, lalu coba scan ulang.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 pb-24 lg:pb-0">
              {filteredProducts.map((product) => {
                const lowStock = product.stock_qty <= 5;

                return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className="bg-white rounded-xl border border-slate-200 hover:border-primary-400 hover:shadow-lg active:scale-[0.99] transition-all text-left flex flex-col min-h-[188px] overflow-hidden group shadow-sm"
                  >
                    <div className="h-20 w-full flex items-center justify-center bg-slate-100 text-primary-700 transition-colors group-hover:bg-primary-50 shrink-0">
                      <Package size={30} />
                    </div>
                    <div className="p-3 flex-1 flex flex-col min-w-0 w-full">
                      <div className="flex items-start gap-2">
                        <h3 className="font-bold text-slate-800 line-clamp-2 leading-tight group-hover:text-primary-700 transition-colors text-sm">
                          {product.name}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium mt-1 uppercase truncate">{product.barcode || product.sku}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-1 rounded font-bold uppercase">
                          {product.defaultUnit.unit_name}
                        </span>
                        <span className={`${lowStock ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} text-[10px] px-2 py-1 rounded font-bold`}>
                          Stok {product.stock_qty}
                        </span>
                      </div>
                      <div className="mt-auto pt-3 text-primary-700 font-extrabold text-lg tracking-tight">
                        {formatRupiah(product.price)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={`
        ${cart.length > 0 ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        absolute lg:static bottom-0 left-0 w-full lg:w-[420px] h-[78vh] lg:h-full
        flex flex-col bg-white shadow-2xl lg:shadow-lg z-30 transition-transform duration-300 rounded-t-3xl lg:rounded-none
      `}>
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mt-3 mb-1 lg:hidden shrink-0" />

        <div className="h-14 lg:h-20 px-4 lg:px-6 flex items-center justify-between border-b border-slate-200 bg-slate-50/60 shrink-0">
          <h2 className="text-base lg:text-lg font-bold flex items-center gap-2 text-slate-800">
            <ShoppingCart size={20} className="text-primary-700" /> Pesanan ({totalItems})
          </h2>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-danger hover:text-danger/80 text-sm font-medium flex items-center gap-1 bg-danger/10 px-3 py-1.5 rounded-lg transition-colors">
              <Trash2 size={16} /> Kosongkan
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
              <ShoppingCart size={48} className="mb-4 opacity-30" />
              <p className="font-medium">Keranjang masih kosong</p>
              <p className="text-xs mt-1">Scan barcode atau pilih produk.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={`${item.product_id}-${item.unit_id}`} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-800 text-sm truncate">{item.name}</h4>
                    <p className="text-primary-700 font-bold text-sm mt-1">{formatRupiah(item.price)}</p>
                  </div>
                  <button onClick={() => removeItem(item.product_id, item.unit_id)} className="p-2 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg">
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                  <select
                    value={item.unit_id}
                    onChange={(event) => updateUnit(item.product_id, item.unit_id, event.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {item.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_name} · {formatRupiah(unit.active_selling_price)}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-200">
                    <button onClick={() => updateQty(item.product_id, item.unit_id, -1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-danger font-bold shadow-sm">
                      -
                    </button>
                    <span className="w-6 text-center font-bold text-slate-700 text-sm">{item.qty}</span>
                    <button onClick={() => updateQty(item.product_id, item.unit_id, 1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-primary-700 font-bold shadow-sm">
                      +
                    </button>
                  </div>
                </div>

                {canDiscount && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-500 uppercase">Diskon item</span>
                    <input
                      type="number"
                      min={0}
                      value={item.discount || ''}
                      onChange={(event) => updateItemDiscount(item.product_id, item.unit_id, Number(event.target.value))}
                      className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="space-y-2 mb-5">
            <div className="flex justify-between text-slate-500 text-sm font-medium">
              <span>Subtotal</span>
              <span>{formatRupiah(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500 text-sm font-medium">
              <span>Diskon item</span>
              <span>-{formatRupiah(itemDiscountTotal)}</span>
            </div>
            {canDiscount && (
              <div className="flex justify-between items-center gap-3 text-slate-500 text-sm font-medium">
                <span>Diskon transaksi</span>
                <input
                  type="number"
                  min={0}
                  value={transactionDiscount || ''}
                  onChange={(event) => setTransactionDiscount(Number(event.target.value))}
                  className="w-32 bg-white border border-slate-200 rounded-lg px-3 py-2 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="0"
                />
              </div>
            )}
            {taxTotal > 0 && (
              <div className="flex justify-between text-slate-500 text-sm font-medium">
                <span>Pajak</span>
                <span>{formatRupiah(taxTotal)}</span>
              </div>
            )}
            <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
              <span className="font-bold text-slate-800">Total</span>
              <span className="text-2xl font-bold text-primary-700">{formatRupiah(total)}</span>
            </div>
          </div>

          <button
            onClick={() => void initiateCheckout()}
            disabled={isProcessing || cart.length === 0}
            className="w-full py-4 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl text-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <Banknote size={24} />
            Bayar Sekarang
          </button>
        </div>
      </div>

      {paymentModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Pembayaran</h3>
                <p className="text-sm text-slate-500">{totalItems} item</p>
              </div>
              <p className="text-2xl font-bold text-primary-700">{formatRupiah(total)}</p>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              {paymentSplits.length > 0 && (
                <div className="mb-6 space-y-2">
                  <h4 className="text-sm font-bold text-slate-500 uppercase">Pembayaran masuk</h4>
                  {paymentSplits.map((payment, index) => (
                    <div key={`${payment.method}-${index}`} className="flex justify-between items-center bg-emerald-50 text-emerald-800 p-3 rounded-xl border border-emerald-100">
                      <span className="font-bold">{payment.method.toUpperCase()}</span>
                      <div className="flex items-center gap-4">
                        <span className="font-bold">{formatRupiah(payment.amount)}</span>
                        <button onClick={() => setPaymentSplits((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="text-danger hover:text-danger/80">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold text-slate-700 pt-2 px-1">
                    <span>Sisa tagihan</span>
                    <span className={remainingToPay <= 0 ? 'text-emerald-700' : 'text-danger'}>
                      {remainingToPay <= 0 ? 'Lunas' : formatRupiah(remainingToPay)}
                    </span>
                  </div>
                </div>
              )}

              {remainingToPay > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-500 uppercase">Metode bayar</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {paymentMethods.map((item) => (
                      <button
                        key={item.method}
                        onClick={() => setSelectedMethod(item.method)}
                        className={`p-3 rounded-xl border-2 font-bold transition-colors flex flex-col items-center gap-2 ${
                          selectedMethod === item.method ? item.className : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <item.icon size={20} />
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="text-sm font-bold text-slate-500 mb-1 block">Nominal diterima</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={inputAmount}
                        onChange={(event) => setInputAmount(event.target.value)}
                        className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-lg font-bold text-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                      />
                      <button onClick={handleAddPayment} className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 rounded-xl transition-colors">
                        Tambah
                      </button>
                    </div>
                  </div>

                  {selectedMethod === 'cash' && (
                    <div className="grid grid-cols-3 gap-2">
                      {[total, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000]
                        .filter((amount, index, values) => amount > 0 && values.indexOf(amount) === index)
                        .map((amount) => (
                          <button key={amount} onClick={() => setInputAmount(String(amount))} className="py-2 rounded-lg bg-slate-100 text-slate-700 font-bold text-sm">
                            {formatRupiah(amount)}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-white grid grid-cols-2 gap-4">
              <button onClick={() => setPaymentModal(false)} disabled={isProcessing} className="py-4 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                Batal
              </button>
              <button
                onClick={() => void processTransaction()}
                disabled={isProcessing || totalPaidSoFar + (Number(inputAmount) || 0) < total}
                className="py-4 font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 rounded-xl transition-colors shadow-sm"
              >
                {isProcessing ? 'Memproses...' : 'Selesaikan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceiptDialog && lastReceipt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-6 text-center bg-emerald-50 border-b border-emerald-100">
              <div className="w-16 h-16 bg-emerald-600 text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                <Banknote size={32} />
              </div>
              <h3 className="text-2xl font-bold text-emerald-800">Transaksi Berhasil</h3>
              <p className="text-emerald-700 font-medium mt-1">Kembalian: {formatRupiah(lastReceipt.change)}</p>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
              <Receipt ref={receiptRef} {...lastReceipt} />
            </div>

            <div className="p-6 grid gap-3">
              <button onClick={handlePrint} className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                <Printer size={20} /> Cetak Struk
              </button>
              <button onClick={() => setShowReceiptDialog(false)} className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">
                Tutup & Lanjut
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
