// SPDX-License-Identifier: AGPL-3.0-only
export interface PastedCrew {
  source: string;
  name: string;
  role: string;
  phone: string;
  department: string;
  status: 'new' | 'duplicate' | 'header' | 'agent';
}
const header =
  /^(name|nome|cognome|ruolo|role|phone|telephone|telefono|tel\.?|pick[ -]?up(?:\/call)?|call(?: time)?|email|e-mail|department|reparto)$/i;
const phone = /(?:\+?\d[\d ()./-]*){7,}/;

/** Old call sheets have no stable columns: preserve the original text for skipped rows. */
export function parseCrewPaste(text: string, existing: readonly string[] = []): PastedCrew[] {
  let department = '';
  const names = new Set(existing.map((name) => name.trim().toLowerCase()));
  return text.split(/\r?\n/).flatMap((source) => {
    const line = source.trim();
    if (!line) return [];
    const columns = line.split(/\t|;| · | {2,}/).map((s) => s.trim());
    const row: PastedCrew = { source, name: '', role: '', phone: '', department, status: 'new' };
    if (columns.some((c) => header.test(c)) && columns.every((c) => !c || header.test(c)))
      return [{ ...row, status: 'header' }];
    if (/^(agent|agente|agency|agenzia)\s*:/i.test(line)) return [{ ...row, status: 'agent' }];
    if (
      columns.length === 1 &&
      /\p{L}/u.test(line) &&
      line === line.toUpperCase() &&
      !/\d/.test(line)
    ) {
      department = line;
      return [];
    }
    const parts = columns
      .map((column) => {
        const match = column.match(phone);
        if (!match) return column;
        row.phone = [row.phone, match[0].trim()].filter(Boolean).join(' · ');
        return column.replace(match[0], '').trim();
      })
      .filter(Boolean);
    row.name = parts.shift() ?? '';
    row.role = parts.join(' · ');
    if (!row.name) return [{ ...row, status: 'header' }];
    const key = row.name.toLowerCase();
    row.status = names.has(key) ? 'duplicate' : 'new';
    names.add(key);
    return [row];
  });
}
