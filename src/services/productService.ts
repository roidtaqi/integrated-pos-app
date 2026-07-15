import { db, type Product, type ProductBarcode, type ProductUnit } from './db';
import { createId } from '../utils/id';

interface ImportContractUnit {
  unit_id?: string;
  id?: string;
  unit_name?: string;
  unitName?: string;
  conversion_to_base?: number;
  conversionToBase?: number;
  active_selling_price?: number;
  activeSellingPrice?: number;
  cost_price?: number;
  manualCost?: number;
  effective_date?: string;
  effectiveDate?: string;
  barcode?: string;
}

interface ImportContractProduct {
  id: string;
  sku?: string;
  name: string;
  barcode?: string;
  category?: string;
  brand?: string;
  is_active?: boolean;
  isActive?: boolean;
  categoryId?: number;
  brandId?: number;
  units?: ImportContractUnit[];
}

interface PriceCalculation {
  productUnitId: string;
  effectiveDate?: string;
  activeSellingPrice?: number;
  roundedPrice?: number;
  finalCost?: number;
  status?: string;
}

interface InventoryPricingBackup {
  products: ImportContractProduct[];
  productUnits?: Array<ImportContractUnit & { productId: string }>;
  categories?: { id: number; name: string }[];
  brands?: { id: number; name: string }[];
  priceCalculations?: PriceCalculation[];
}

export interface ProductWithUnits extends Product {
  units: ProductUnit[];
  defaultUnit: ProductUnit;
  price: number;
  stock_qty: number;
}

const DEFAULT_OUTLET_ID = 'outlet_001';

function toBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'aktif', 'active'].includes(value.toLowerCase());
  return fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeCsv(text: string): InventoryPricingBackup {
  const rows = parseCsv(text);
  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());
  const products = new Map<string, ImportContractProduct>();

  for (const row of dataRows) {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
    const productId = record.product_id || record.id;
    const unitId = record.unit_id || `${productId}-${record.unit_name || 'unit'}`;
    if (!productId || !record.name || !unitId) continue;

    const existing = products.get(productId);
    const product: ImportContractProduct = existing || {
      id: productId,
      sku: record.sku,
      name: record.name,
      barcode: record.barcode,
      category: record.category || 'Umum',
      brand: record.brand || '-',
      is_active: toBoolean(record.is_active, true),
      units: []
    };

    product.units = product.units || [];
    product.units.push({
      unit_id: unitId,
      unit_name: record.unit_name || 'pcs',
      conversion_to_base: toNumber(record.conversion_to_base, 1),
      active_selling_price: toNumber(record.active_selling_price, 0),
      cost_price: toNumber(record.cost_price, 0),
      effective_date: record.effective_date || new Date().toISOString().slice(0, 10)
    });
    products.set(productId, product);
  }

  return { products: Array.from(products.values()) };
}

function normalizeCatalog(data: InventoryPricingBackup) {
  const now = new Date().toISOString();
  const categoryMap = new Map<number, string>();
  const brandMap = new Map<number, string>();
  const activePriceMap = new Map<string, PriceCalculation>();

  data.categories?.forEach((category) => categoryMap.set(category.id, category.name));
  data.brands?.forEach((brand) => brandMap.set(brand.id, brand.name));
  data.priceCalculations
    ?.filter((price) => price.status === 'ACTIVE')
    .forEach((price) => activePriceMap.set(price.productUnitId, price));

  const products: Product[] = [];
  const units: ProductUnit[] = [];
  const barcodes: ProductBarcode[] = [];

  for (const rawProduct of data.products || []) {
    const rawUnits = rawProduct.units || data.productUnits?.filter((unit) => unit.productId === rawProduct.id) || [];
    if (rawUnits.length === 0) continue;

    const product: Product = {
      id: rawProduct.id,
      sku: rawProduct.sku || '-',
      barcode: rawProduct.barcode || '',
      name: rawProduct.name,
      category: rawProduct.category || (rawProduct.categoryId ? categoryMap.get(rawProduct.categoryId) : undefined) || 'Umum',
      brand: rawProduct.brand || (rawProduct.brandId ? brandMap.get(rawProduct.brandId) : undefined) || '-',
      is_active: toBoolean(rawProduct.is_active ?? rawProduct.isActive, true),
      source: 'INVENTORY_PRICING_APP',
      updated_at: now
    };
    products.push(product);

    if (product.barcode) {
      barcodes.push({
        id: `barcode_${product.id}`,
        product_id: product.id,
        barcode: product.barcode
      });
    }

    for (const rawUnit of rawUnits) {
      const unitId = rawUnit.unit_id || rawUnit.id;
      if (!unitId) continue;

      const activePrice = activePriceMap.get(unitId);
      const unitBarcode = rawUnit.barcode;
      const unit: ProductUnit = {
        id: unitId,
        product_id: product.id,
        unit_name: rawUnit.unit_name || rawUnit.unitName || 'pcs',
        conversion_to_base: toNumber(rawUnit.conversion_to_base ?? rawUnit.conversionToBase, 1),
        active_selling_price: toNumber(
          rawUnit.active_selling_price ?? rawUnit.activeSellingPrice ?? activePrice?.activeSellingPrice ?? activePrice?.roundedPrice,
          0
        ),
        cost_price: toNumber(rawUnit.cost_price ?? rawUnit.manualCost ?? activePrice?.finalCost, 0),
        effective_date: rawUnit.effective_date || rawUnit.effectiveDate || activePrice?.effectiveDate || new Date().toISOString().slice(0, 10)
      };
      units.push(unit);

      if (unitBarcode) {
        barcodes.push({
          id: `barcode_${unit.id}`,
          product_id: product.id,
          unit_id: unit.id,
          barcode: unitBarcode
        });
      }
    }
  }

  return { products, units, barcodes };
}

export const productService = {
  async importProductsFromJson(jsonData: InventoryPricingBackup, options: { fromCloud?: boolean } = {}) {
    try {
      const normalized = normalizeCatalog(jsonData);
      await this.persistCatalog(normalized.products, normalized.units, normalized.barcodes, 'IMPORT_PRODUCT', options);
      return { success: true, count: normalized.products.length };
    } catch {
      return { success: false, message: 'Gagal mengimpor katalog JSON Inventory Pricing App.' };
    }
  },

  async importProductsFromCsv(csvText: string) {
    try {
      const normalizedData = normalizeCsv(csvText);
      const normalized = normalizeCatalog(normalizedData);
      await this.persistCatalog(normalized.products, normalized.units, normalized.barcodes, 'IMPORT_CSV');
      return { success: true, count: normalized.products.length };
    } catch {
      return { success: false, message: 'Gagal mengimpor CSV. Pastikan header sesuai kontrak.' };
    }
  },

  async persistCatalog(
    products: Product[],
    units: ProductUnit[],
    barcodes: ProductBarcode[],
    logType: 'IMPORT_PRODUCT' | 'IMPORT_CSV',
    options: { fromCloud?: boolean } = {}
  ) {
    const now = new Date().toISOString();

    await db.transaction(
      'rw',
      [db.products, db.product_units, db.product_barcodes, db.stock_balances, db.stock_movements, db.sync_logs, db.audit_logs],
      async () => {
        await db.products.clear();
        await db.product_units.clear();
        await db.product_barcodes.clear();

        if (products.length > 0) await db.products.bulkPut(products);
        if (units.length > 0) await db.product_units.bulkPut(units);
        if (barcodes.length > 0) await db.product_barcodes.bulkPut(barcodes);

        for (const product of products) {
          const existingBalance = await db.stock_balances.where({ product_id: product.id, outlet_id: DEFAULT_OUTLET_ID }).first();
          if (!existingBalance) {
            await db.stock_balances.add({
              id: createId('stock'),
              product_id: product.id,
              outlet_id: DEFAULT_OUTLET_ID,
              qty: 0,
              low_stock_threshold: 5,
              last_updated: now
            });
          }
        }

        await db.sync_logs.add({
          id: createId('sync'),
          type: logType,
          status: 'SUCCESS',
          records_processed: products.length,
          message: `Import katalog berhasil: ${products.length} produk, ${units.length} satuan`,
          created_at: now
        });

        if (!options.fromCloud) {
          await db.audit_logs.add({
            id: createId('audit'),
            user_id: 'system',
            action: 'IMPORT_CATALOG',
            entity: 'product',
            entity_id: 'catalog',
            metadata: JSON.stringify({ products: products.length, units: units.length }),
            created_at: now
          });
        }
      }
    );

    if (!options.fromCloud && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos-data-changed', { detail: { entity: 'catalog', action: 'imported', products: products.length } }));
    }
  },

  async getProductsWithUnits(includeInactive = true, outletId = DEFAULT_OUTLET_ID): Promise<ProductWithUnits[]> {
    const products = await db.products.toArray();
    const units = await db.product_units.toArray();
    const balances = await db.stock_balances.where('outlet_id').equals(outletId).toArray();

    return products
      .filter((product) => includeInactive || product.is_active)
      .map((product) => {
        const productUnits = units.filter((unit) => unit.product_id === product.id);
        const defaultUnit = productUnits.find((unit) => unit.conversion_to_base === 1) || productUnits[0];
        const balance = balances.find((item) => item.product_id === product.id);

        if (!defaultUnit) return null;

        return {
          ...product,
          units: productUnits,
          defaultUnit,
          price: defaultUnit.active_selling_price,
          stock_qty: balance?.qty || 0
        };
      })
      .filter((product): product is ProductWithUnits => product !== null);
  },

  async getActiveProductsWithUnits(outletId = DEFAULT_OUTLET_ID) {
    return this.getProductsWithUnits(false, outletId);
  },

  async findByBarcode(barcode: string, outletId = DEFAULT_OUTLET_ID) {
    const trimmed = barcode.trim();
    if (!trimmed) return undefined;

    const barcodeRecord = await db.product_barcodes.where('barcode').equals(trimmed).first();
    const product = barcodeRecord
      ? await db.products.get(barcodeRecord.product_id)
      : await db.products.where('barcode').equals(trimmed).first();

    if (!product || !product.is_active) return undefined;

    const units = await db.product_units.where('product_id').equals(product.id).toArray();
    const defaultUnit = units.find((unit) => unit.id === barcodeRecord?.unit_id) || units.find((unit) => unit.conversion_to_base === 1) || units[0];
    if (!defaultUnit) return undefined;

    const balance = await db.stock_balances.where({ product_id: product.id, outlet_id: outletId }).first();
    return {
      ...product,
      units,
      defaultUnit,
      price: defaultUnit.active_selling_price,
      stock_qty: balance?.qty || 0
    };
  }
};
