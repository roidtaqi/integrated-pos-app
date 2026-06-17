import { db, type PaymentMethod, type TransactionItem } from './db';
import { createId, createTransactionId } from '../utils/id';

export interface CheckoutPayload {
  cashier_id: string;
  outlet_id: string;
  shift_id?: string;
  customer_id?: string;
  items: {
    product_id: string;
    unit_id: string;
    qty: number;
    discount: number;
  }[];
  payments: {
    method: PaymentMethod;
    amount: number;
  }[];
  transaction_discount?: number;
  tax_rate?: number;
}

export const transactionService = {
  async processCheckout(payload: CheckoutPayload) {
    if (payload.items.length === 0) {
      throw new Error('Keranjang kosong.');
    }

    const transactionId = createTransactionId();
    const now = new Date().toISOString();

    return db.transaction(
      'rw',
      [
        db.products,
        db.product_units,
        db.transactions,
        db.transaction_items,
        db.payments,
        db.stock_balances,
        db.stock_movements,
        db.sync_queue,
        db.audit_logs
      ],
      async () => {
        const transactionItems: TransactionItem[] = [];
        let subtotal = 0;
        let itemDiscountTotal = 0;

        for (const cartItem of payload.items) {
          const product = await db.products.get(cartItem.product_id);
          const unit = await db.product_units.get(cartItem.unit_id);

          if (!product || !unit || unit.product_id !== cartItem.product_id) {
            throw new Error('Produk atau satuan tidak valid.');
          }

          if (!product.is_active) {
            throw new Error(`${product.name} sudah nonaktif dan tidak boleh dijual.`);
          }

          const qty = Math.max(1, Number(cartItem.qty) || 1);
          const unitPrice = unit.active_selling_price;
          const gross = unitPrice * qty;
          const discount = Math.max(0, Math.min(Number(cartItem.discount) || 0, gross));
          const lineSubtotal = gross - discount;

          subtotal += gross;
          itemDiscountTotal += discount;

          transactionItems.push({
            id: createId('item'),
            transaction_id: transactionId,
            product_id: product.id,
            product_name: product.name,
            unit_id: unit.id,
            unit_name: unit.unit_name,
            qty,
            unit_price: unitPrice,
            discount,
            subtotal: lineSubtotal
          });
        }

        const transactionDiscount = Math.max(0, Math.min(payload.transaction_discount || 0, subtotal - itemDiscountTotal));
        const taxableAmount = subtotal - itemDiscountTotal - transactionDiscount;
        const taxTotal = Math.round(taxableAmount * ((payload.tax_rate || 0) / 100));
        const total = taxableAmount + taxTotal;
        const paid = payload.payments.reduce((sum, payment) => sum + payment.amount, 0);

        if (paid < total) {
          throw new Error('Total pembayaran masih kurang dari tagihan.');
        }

        const change = paid - total;
        const discountTotal = itemDiscountTotal + transactionDiscount;

        await db.transactions.add({
          id: transactionId,
          cashier_id: payload.cashier_id,
          outlet_id: payload.outlet_id,
          shift_id: payload.shift_id,
          customer_id: payload.customer_id,
          created_at: now,
          subtotal,
          discount_total: discountTotal,
          tax_total: taxTotal,
          total,
          paid,
          change,
          status: 'COMPLETED',
          sync_status: 'PENDING'
        });

        await db.transaction_items.bulkAdd(transactionItems);

        for (const item of transactionItems) {
          const unit = await db.product_units.get(item.unit_id);
          const qtyInBase = item.qty * (unit?.conversion_to_base || 1);
          const balance = await db.stock_balances.where({ product_id: item.product_id, outlet_id: payload.outlet_id }).first();

          await db.stock_movements.add({
            id: createId('move'),
            product_id: item.product_id,
            unit_id: item.unit_id,
            outlet_id: payload.outlet_id,
            type: 'SALE',
            qty_change: -qtyInBase,
            created_at: now,
            reference_id: transactionId,
            note: `Penjualan ${item.qty} ${item.unit_name}`
          });

          if (balance) {
            await db.stock_balances.update(balance.id, {
              qty: balance.qty - qtyInBase,
              last_updated: now
            });
          } else {
            await db.stock_balances.add({
              id: createId('stock'),
              product_id: item.product_id,
              outlet_id: payload.outlet_id,
              qty: -qtyInBase,
              low_stock_threshold: 5,
              last_updated: now
            });
          }
        }

        for (const payment of payload.payments) {
          await db.payments.add({
            id: createId('pay'),
            transaction_id: transactionId,
            method: payment.method,
            amount: payment.amount
          });
        }

        const exportPayload = {
          transaction_id: transactionId,
          cashier_id: payload.cashier_id,
          outlet_id: payload.outlet_id,
          created_at: now,
          items: transactionItems.map((item) => ({
            product_id: item.product_id,
            unit_id: item.unit_id,
            qty: item.qty,
            unit_price: item.unit_price,
            discount: item.discount,
            subtotal: item.subtotal
          })),
          payments: payload.payments,
          total,
          paid,
          change
        };

        const queueId = createId('queue');
        await db.sync_queue.add({
          id: queueId,
          entity: 'transaction',
          entity_id: transactionId,
          operation: 'CREATE',
          payload: JSON.stringify(exportPayload),
          status: 'PENDING',
          retry_count: 0,
          created_at: now,
          updated_at: now
        });

        await db.audit_logs.add({
          id: createId('audit'),
          user_id: payload.cashier_id,
          action: 'CHECKOUT_COMPLETED',
          entity: 'transaction',
          entity_id: transactionId,
          metadata: JSON.stringify({ total, paid, change, items: transactionItems.length }),
          created_at: now
        });

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pos-sync-queue-created', { detail: { queueId, transactionId } }));
        }

        return {
          success: true,
          transactionId,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paid,
          change,
          items: transactionItems
        };
      }
    );
  }
};
