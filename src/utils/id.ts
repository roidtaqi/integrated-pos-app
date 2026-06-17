export function createId(prefix?: string) {
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return prefix ? `${prefix}_${id}` : id;
}

export function createTransactionId(date = new Date()) {
  const stamp = date.toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `TRX-${stamp}-${suffix}`;
}
