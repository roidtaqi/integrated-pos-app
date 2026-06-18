import { db, type CashMovementType, type Shift } from './db';
import { createId } from '../utils/id';

export const shiftService = {
  async getCurrentShift(cashierId: string): Promise<Shift | undefined> {
    return db.shifts.where({ cashier_id: cashierId, status: 'OPEN' }).first();
  },

  async openShift(cashierId: string, outletId: string, startingCash: number) {
    const existing = await this.getCurrentShift(cashierId);
    if (existing) {
      return { success: false, message: 'Shift sudah terbuka.' };
    }

    const now = new Date().toISOString();
    const newShift: Shift = {
      id: createId('shift'),
      cashier_id: cashierId,
      outlet_id: outletId,
      opened_at: now,
      starting_cash: Math.max(0, startingCash),
      status: 'OPEN'
    };

    await db.transaction('rw', db.shifts, db.audit_logs, async () => {
      await db.shifts.add(newShift);
      await db.audit_logs.add({
        id: createId('audit'),
        user_id: cashierId,
        action: 'SHIFT_OPENED',
        entity: 'shift',
        entity_id: newShift.id,
        metadata: JSON.stringify({ startingCash: newShift.starting_cash }),
        created_at: now
      });
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'shift', action: 'opened', id: newShift.id } }));
    }

    return { success: true, shift: newShift };
  },

  async addCashMovement(shiftId: string, type: CashMovementType, amount: number, note: string) {
    const shift = await db.shifts.get(shiftId);
    if (!shift || shift.status !== 'OPEN') {
      return { success: false, message: 'Shift aktif tidak ditemukan.' };
    }

    const now = new Date().toISOString();
    await db.transaction('rw', db.cash_movements, db.audit_logs, async () => {
      await db.cash_movements.add({
        id: createId('cash'),
        shift_id: shift.id,
        cashier_id: shift.cashier_id,
        outlet_id: shift.outlet_id,
        type,
        amount: Math.max(0, amount),
        note,
        created_at: now
      });

      await db.audit_logs.add({
        id: createId('audit'),
        user_id: shift.cashier_id,
        action: type,
        entity: 'cash_movement',
        entity_id: shift.id,
        metadata: JSON.stringify({ amount, note }),
        created_at: now
      });
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'cash_movement', action: type, shiftId } }));
    }

    return { success: true };
  },

  async getShiftSummary(shift: Shift) {
    const end = shift.closed_at || new Date().toISOString();
    const transactions = await db.transactions
      .where('created_at')
      .between(shift.opened_at, end, true, true)
      .toArray();

    const shiftTransactions = transactions.filter(
      (transaction) => transaction.cashier_id === shift.cashier_id && transaction.status === 'COMPLETED'
    );

    let cashSales = 0;
    let nonCashSales = 0;

    for (const transaction of shiftTransactions) {
      const payments = await db.payments.where('transaction_id').equals(transaction.id).toArray();
      const cashPaid = payments.filter((payment) => payment.method === 'cash').reduce((sum, payment) => sum + payment.amount, 0);
      const nonCashPaid = payments.filter((payment) => payment.method !== 'cash').reduce((sum, payment) => sum + payment.amount, 0);

      cashSales += Math.max(0, cashPaid - transaction.change);
      nonCashSales += Math.min(transaction.total, nonCashPaid);
    }

    const cashMovements = await db.cash_movements.where('shift_id').equals(shift.id).toArray();
    const cashIn = cashMovements
      .filter((movement) => movement.type === 'CASH_IN')
      .reduce((sum, movement) => sum + movement.amount, 0);
    const cashOut = cashMovements
      .filter((movement) => movement.type === 'CASH_OUT')
      .reduce((sum, movement) => sum + movement.amount, 0);

    const expectedCash = shift.starting_cash + cashSales + cashIn - cashOut;

    return {
      transactionCount: shiftTransactions.length,
      grossSales: shiftTransactions.reduce((sum, transaction) => sum + transaction.subtotal, 0),
      netSales: shiftTransactions.reduce((sum, transaction) => sum + transaction.total, 0),
      cashSales,
      nonCashSales,
      cashIn,
      cashOut,
      expectedCash,
      cashMovements
    };
  },

  async closeShift(shiftId: string, actualCash: number) {
    const shift = await db.shifts.get(shiftId);
    if (!shift || shift.status === 'CLOSED') {
      return { success: false, message: 'Shift tidak valid.' };
    }

    const summary = await this.getShiftSummary(shift);
    const difference = actualCash - summary.expectedCash;
    const now = new Date().toISOString();

    await db.transaction('rw', db.shifts, db.audit_logs, async () => {
      await db.shifts.update(shiftId, {
        closed_at: now,
        status: 'CLOSED',
        expected_cash: summary.expectedCash,
        actual_cash: actualCash,
        difference
      });

      await db.audit_logs.add({
        id: createId('audit'),
        user_id: shift.cashier_id,
        action: 'SHIFT_CLOSED',
        entity: 'shift',
        entity_id: shiftId,
        metadata: JSON.stringify({ expectedCash: summary.expectedCash, actualCash, difference }),
        created_at: now
      });
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'shift', action: 'closed', id: shiftId } }));
    }

    return { success: true, expectedCash: summary.expectedCash, difference, summary };
  }
};
