import { db, type StockMovementType } from './db';
import { createId } from '../utils/id';

const DEFAULT_OUTLET_ID = 'outlet_001';

export const stockService = {
  async adjustStock(params: {
    product_id: string;
    outlet_id?: string;
    new_qty: number;
    note?: string;
    user_id?: string;
  }) {
    const outletId = params.outlet_id || DEFAULT_OUTLET_ID;
    const now = new Date().toISOString();

    const result = await db.transaction('rw', db.stock_balances, db.stock_movements, db.audit_logs, async () => {
      const existing = await db.stock_balances.where({ product_id: params.product_id, outlet_id: outletId }).first();
      const previousQty = existing?.qty || 0;
      const qtyChange = params.new_qty - previousQty;

      if (existing) {
        await db.stock_balances.update(existing.id, {
          qty: params.new_qty,
          last_updated: now
        });
      } else {
        await db.stock_balances.add({
          id: createId('stock'),
          product_id: params.product_id,
          outlet_id: outletId,
          qty: params.new_qty,
          low_stock_threshold: 5,
          last_updated: now
        });
      }

      await db.stock_movements.add({
        id: createId('move'),
        product_id: params.product_id,
        outlet_id: outletId,
        type: 'ADJUSTMENT',
        qty_change: qtyChange,
        created_at: now,
        reference_id: 'stock_opname',
        note: params.note || 'Stock opname'
      });

      await db.audit_logs.add({
        id: createId('audit'),
        user_id: params.user_id || 'system',
        action: 'STOCK_ADJUSTMENT',
        entity: 'stock_balance',
        entity_id: params.product_id,
        metadata: JSON.stringify({ previousQty, newQty: params.new_qty, qtyChange }),
        created_at: now
      });

      return { success: true, previousQty, newQty: params.new_qty, qtyChange };
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'stock', action: 'adjusted', productId: params.product_id } }));
    }

    return result;
  },

  async getStockOverview(outletId = DEFAULT_OUTLET_ID) {
    const [balances, products, units] = await Promise.all([
      db.stock_balances.where('outlet_id').equals(outletId).toArray(),
      db.products.toArray(),
      db.product_units.toArray()
    ]);

    return balances.map((balance) => {
      const product = products.find((item) => item.id === balance.product_id);
      const defaultUnit = units.find((unit) => unit.product_id === balance.product_id && unit.conversion_to_base === 1)
        || units.find((unit) => unit.product_id === balance.product_id);
      const lowStock = balance.qty <= balance.low_stock_threshold;

      return {
        ...balance,
        productName: product?.name || 'Unknown Product',
        sku: product?.sku || '-',
        category: product?.category || '-',
        unitName: defaultUnit?.unit_name || 'base',
        lowStock
      };
    });
  },

  async getMovements(limit = 50) {
    const movements = await db.stock_movements.orderBy('created_at').reverse().limit(limit).toArray();
    const products = await db.products.toArray();

    return movements.map((movement) => ({
      ...movement,
      productName: products.find((product) => product.id === movement.product_id)?.name || 'Unknown Product',
      typeLabel: this.getMovementLabel(movement.type)
    }));
  },

  getMovementLabel(type: StockMovementType) {
    const labels: Record<StockMovementType, string> = {
      SALE: 'Penjualan',
      REFUND: 'Refund',
      VOID: 'Void',
      ADJUSTMENT: 'Adjustment',
      IMPORT: 'Import',
      SYNC: 'Sync'
    };
    return labels[type];
  }
};
