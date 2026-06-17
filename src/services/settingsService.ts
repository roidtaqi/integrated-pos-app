import { db } from './db';

export interface ReceiptSettings {
  store_name: string;
  store_address: string;
  store_phone: string;
  receipt_footer: string;
  tax_enabled: boolean;
  tax_rate: number;
}

const defaults: ReceiptSettings = {
  store_name: 'Kastur POS',
  store_address: 'Jl. Roid Nawir No. 1',
  store_phone: '08123456789',
  receipt_footer: 'Terima kasih sudah belanja di Kastur',
  tax_enabled: false,
  tax_rate: 0
};

export const settingsService = {
  async getReceiptSettings(): Promise<ReceiptSettings> {
    const settings = await db.app_settings.toArray();
    const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));

    return {
      store_name: values.store_name || defaults.store_name,
      store_address: values.store_address || defaults.store_address,
      store_phone: values.store_phone || defaults.store_phone,
      receipt_footer: values.receipt_footer || defaults.receipt_footer,
      tax_enabled: values.tax_enabled === 'true',
      tax_rate: Number(values.tax_rate || defaults.tax_rate)
    };
  },

  async saveSettings(settings: ReceiptSettings) {
    const now = new Date().toISOString();
    await db.app_settings.bulkPut([
      { key: 'store_name', value: settings.store_name, updated_at: now },
      { key: 'store_address', value: settings.store_address, updated_at: now },
      { key: 'store_phone', value: settings.store_phone, updated_at: now },
      { key: 'receipt_footer', value: settings.receipt_footer, updated_at: now },
      { key: 'tax_enabled', value: String(settings.tax_enabled), updated_at: now },
      { key: 'tax_rate', value: String(settings.tax_rate), updated_at: now }
    ]);
  }
};
