import { db, type SyncLog } from './db';
import { createId } from '../utils/id';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Gagal memproses data.';
}

export const syncService = {
  async getPendingTransactions() {
    return db.transactions.where('sync_status').equals('PENDING').toArray();
  },

  async getPendingQueue() {
    return db.sync_queue.where('status').equals('PENDING').toArray();
  },

  async exportSalesData(options: { markAsSynced?: boolean } = {}) {
    try {
      const pendingTx = await this.getPendingTransactions();
      if (pendingTx.length === 0) {
        return { success: false, message: 'Tidak ada transaksi pending untuk di-export.' };
      }

      const salesPayload = [];
      for (const tx of pendingTx) {
        const items = await db.transaction_items.where('transaction_id').equals(tx.id).toArray();
        const payments = await db.payments.where('transaction_id').equals(tx.id).toArray();

        salesPayload.push({
          transaction_id: tx.id,
          cashier_id: tx.cashier_id,
          outlet_id: tx.outlet_id,
          created_at: tx.created_at,
          items: items.map((item) => ({
            product_id: item.product_id,
            unit_id: item.unit_id,
            qty: item.qty,
            unit_price: item.unit_price,
            discount: item.discount,
            subtotal: item.subtotal
          })),
          payments: payments.map((payment) => ({
            method: payment.method,
            amount: payment.amount
          })),
          total: tx.total,
          paid: tx.paid,
          change: tx.change
        });
      }

      if (options.markAsSynced) {
        await this.markTransactionsAsSynced(pendingTx.map((tx) => tx.id));
      }

      await db.sync_logs.add({
        id: createId('sync'),
        type: 'EXPORT_SALES',
        status: 'SUCCESS',
        records_processed: pendingTx.length,
        message: `Export sales dibuat untuk ${pendingTx.length} transaksi`,
        created_at: new Date().toISOString()
      });

      return { success: true, data: { sales: salesPayload }, count: pendingTx.length };
    } catch (error) {
      const message = getErrorMessage(error);
      await db.sync_logs.add({
        id: createId('sync'),
        type: 'EXPORT_SALES',
        status: 'FAILED',
        records_processed: 0,
        message,
        created_at: new Date().toISOString()
      });
      return { success: false, message };
    }
  },

  async markTransactionsAsSynced(transactionIds: string[]) {
    const now = new Date().toISOString();
    await db.transaction('rw', db.transactions, db.sync_queue, async () => {
      for (const transactionId of transactionIds) {
        await db.transactions.update(transactionId, { sync_status: 'SYNCED' });
        const queued = await db.sync_queue.where({ entity: 'transaction', entity_id: transactionId }).toArray();
        for (const item of queued) {
          await db.sync_queue.update(item.id, { status: 'SYNCED', updated_at: now });
        }
      }
    });
  },

  async getSyncLogs(): Promise<SyncLog[]> {
    return db.sync_logs.orderBy('created_at').reverse().toArray();
  }
};
