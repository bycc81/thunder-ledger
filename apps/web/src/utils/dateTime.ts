function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatBusinessDate(value?: string | null): string {
  if (!value) return '--';
  const matched = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.\d+)?Z)?$/.exec(value);
  return matched ? `${matched[1]} 00:00:00` : formatDateTime(value);
}
