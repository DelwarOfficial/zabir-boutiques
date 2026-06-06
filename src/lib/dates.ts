/**
 * Generate a UTC timestamp string for D1 storage.
 * Format: YYYY-MM-DD HH:MM:SS
 * Never use SQLite datetime("now") — always pass timestamps as bound parameters.
 */
export function nowSql(date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}
