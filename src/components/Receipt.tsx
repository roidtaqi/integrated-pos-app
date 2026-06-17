import React from 'react';
import { formatDateTime, formatRupiah } from '../utils/format';

export interface ReceiptProps {
  transactionId: string;
  cashierName: string;
  createdAt: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  receiptFooter: string;
  items: { name: string; unitName: string; qty: number; price: number; discount: number; subtotal: number }[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paid: number;
  change: number;
  payments: { method: string; amount: number }[];
}

export const Receipt = React.forwardRef<HTMLDivElement, ReceiptProps>(({
  transactionId,
  cashierName,
  createdAt,
  storeName,
  storeAddress,
  storePhone,
  receiptFooter,
  items,
  subtotal,
  discountTotal,
  taxTotal,
  total,
  paid,
  change,
  payments
}, ref) => (
  <div ref={ref} className="p-4 bg-white text-black text-xs font-mono w-[58mm] mx-auto print:block" style={{ margin: 0, padding: '10mm' }}>
    <div className="text-center mb-4">
      <h2 className="font-bold text-lg">{storeName}</h2>
      <p>{storeAddress}</p>
      <p>Telp: {storePhone}</p>
    </div>

    <div className="border-b border-dashed border-gray-400 pb-2 mb-2">
      <div className="flex justify-between gap-3">
        <span>{formatDateTime(createdAt)}</span>
        <span>Kasir: {cashierName.split(' ')[0]}</span>
      </div>
      <div>No: {transactionId}</div>
    </div>

    <div className="border-b border-dashed border-gray-400 pb-2 mb-2">
      {items.map((item, index) => (
        <div key={`${item.name}-${index}`} className="mb-1">
          <div className="font-bold">{item.name}</div>
          <div className="flex justify-between">
            <span>{item.qty} {item.unitName} x {formatRupiah(item.price)}</span>
            <span>{formatRupiah(item.subtotal)}</span>
          </div>
          {item.discount > 0 && (
            <div className="flex justify-between">
              <span>Diskon item</span>
              <span>-{formatRupiah(item.discount)}</span>
            </div>
          )}
        </div>
      ))}
    </div>

    <div className="border-b border-dashed border-gray-400 pb-2 mb-2 space-y-0.5">
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatRupiah(subtotal)}</span>
      </div>
      {discountTotal > 0 && (
        <div className="flex justify-between">
          <span>Diskon</span>
          <span>-{formatRupiah(discountTotal)}</span>
        </div>
      )}
      {taxTotal > 0 && (
        <div className="flex justify-between">
          <span>Pajak</span>
          <span>{formatRupiah(taxTotal)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-sm">
        <span>Total</span>
        <span>{formatRupiah(total)}</span>
      </div>
      {payments.map((payment, index) => (
        <div key={`${payment.method}-${index}`} className="flex justify-between">
          <span>Bayar ({payment.method.toUpperCase()})</span>
          <span>{formatRupiah(payment.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between">
        <span>Diterima</span>
        <span>{formatRupiah(paid)}</span>
      </div>
      <div className="flex justify-between">
        <span>Kembali</span>
        <span>{formatRupiah(change)}</span>
      </div>
    </div>

    <div className="text-center mt-4">
      <p>{receiptFooter}</p>
    </div>
  </div>
));
