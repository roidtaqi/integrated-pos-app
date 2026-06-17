import { db, type PaymentMethod } from './db';

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function endOfTodayIso() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

export const reportService = {
  async getDashboardSummary() {
    const todayTransactions = await this.getTransactionsInRange(startOfTodayIso(), endOfTodayIso());
    const totalSales = todayTransactions.reduce((sum, transaction) => sum + transaction.total, 0);
    const totalTransactions = todayTransactions.length;
    const pendingSync = await db.transactions.where('sync_status').equals('PENDING').count();
    const productCount = (await db.products.toArray()).filter((product) => product.is_active).length;
    const lowStockCount = (await db.stock_balances.toArray()).filter((stock) => stock.qty <= stock.low_stock_threshold).length;
    const bestSelling = await this.getBestSelling(todayTransactions.map((transaction) => transaction.id), 5);

    return { totalSales, totalTransactions, pendingSync, productCount, lowStockCount, bestSelling };
  },

  async getTransactionsInRange(startDate: string, endDate: string) {
    const transactions = await db.transactions.toArray();
    return transactions.filter(
      (transaction) =>
        transaction.status === 'COMPLETED' &&
        transaction.created_at >= startDate &&
        transaction.created_at <= endDate
    );
  },

  async getBestSelling(transactionIds: string[], limit = 10) {
    const items = await db.transaction_items.toArray();
    const validItems = items.filter((item) => transactionIds.includes(item.transaction_id));
    const productSales: Record<string, { name: string; qty: number; total: number }> = {};

    for (const item of validItems) {
      if (!productSales[item.product_id]) {
        productSales[item.product_id] = { name: item.product_name, qty: 0, total: 0 };
      }
      productSales[item.product_id].qty += item.qty;
      productSales[item.product_id].total += item.subtotal;
    }

    return Object.entries(productSales)
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
  },

  async getReports(startDate: string, endDate: string) {
    const transactions = await this.getTransactionsInRange(startDate, endDate);
    const transactionIds = transactions.map((transaction) => transaction.id);
    const totalGrossSales = transactions.reduce((sum, transaction) => sum + transaction.subtotal, 0);
    const totalDiscount = transactions.reduce((sum, transaction) => sum + transaction.discount_total, 0);
    const totalTax = transactions.reduce((sum, transaction) => sum + transaction.tax_total, 0);
    const totalNetSales = transactions.reduce((sum, transaction) => sum + transaction.total, 0);
    const totalTransactions = transactions.length;

    const paymentSummary: Record<PaymentMethod, number> = {
      cash: 0,
      qris: 0,
      transfer: 0,
      edc: 0
    };

    for (const transaction of transactions) {
      const payments = await db.payments.where('transaction_id').equals(transaction.id).toArray();
      for (const payment of payments) {
        paymentSummary[payment.method] += payment.amount;
      }
    }

    const users = await db.users.toArray();
    const salesByCashier = users
      .map((user) => {
        const userTransactions = transactions.filter((transaction) => transaction.cashier_id === user.id);
        return {
          id: user.id,
          name: user.name,
          role: user.role,
          transactions: userTransactions.length,
          total: userTransactions.reduce((sum, transaction) => sum + transaction.total, 0)
        };
      })
      .filter((item) => item.transactions > 0)
      .sort((a, b) => b.total - a.total);

    const shifts = await db.shifts.toArray();
    const salesByShift = shifts
      .map((shift) => {
        const shiftTransactions = transactions.filter((transaction) => transaction.shift_id === shift.id);
        const cashier = users.find((user) => user.id === shift.cashier_id);
        return {
          id: shift.id,
          cashierName: cashier?.name || shift.cashier_id,
          openedAt: shift.opened_at,
          closedAt: shift.closed_at,
          transactions: shiftTransactions.length,
          total: shiftTransactions.reduce((sum, transaction) => sum + transaction.total, 0)
        };
      })
      .filter((item) => item.transactions > 0)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

    return {
      totalGrossSales,
      totalDiscount,
      totalTax,
      totalNetSales,
      totalTransactions,
      paymentSummary,
      bestSelling: await this.getBestSelling(transactionIds, 10),
      salesByCashier,
      salesByShift
    };
  }
};
