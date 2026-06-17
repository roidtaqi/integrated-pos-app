export function formatRupiah(value: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(value: string | number | Date) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function toDateInputValue(date = new Date()) {
  return date.toISOString().split('T')[0];
}
