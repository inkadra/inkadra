// SPDX-License-Identifier: AGPL-3.0-only
export interface PastedCrew {
  source: string;
  name: string;
  role: string;
  phone: string;
  department: string;
  status: 'new' | 'duplicate' | 'header' | 'agent' | 'noName';
}
const header =
  /^(name|nome|cognome|ruolo|role|phone|telephone|telefono|tel\.?|pick[ -]?up(?:\/call)?|call(?: time)?|email|e-mail|department|reparto)$/i;
const phone = /(?:\+?\d[\d ()./-]*){7,}/;
// A separator left at either end of a column ("Fonico ·" from "Paolo Riva · Fonico · ") goes too.
const split = (line: string) =>
  line.split(/\t|;| · | {2,}/).map((s) => s.trim().replace(/^·\s*|\s*·$/g, ''));
const count = (text: string, char: string) => text.split(char).length - 1;

/** The phone in a column, without the punctuation of a note that follows it: "… 789 (agent)". */
function phoneIn(column: string): string | null {
  const match = column.match(phone)?.[0];
  if (!match) return null;
  let found = match.replace(/[^\d)]+$/, '');
  while (found.endsWith(')') && count(found, ')') > count(found, '('))
    found = found.slice(0, -1).replace(/[^\d)]+$/, '');
  return found;
}

/** A row that reads as a person: more than one column, or a phone. */
const personRow = (line: string) => split(line).filter(Boolean).length > 1 || !!phoneIn(line);

/** Old call sheets have no stable columns: preserve the original text for skipped rows. */
export function parseCrewPaste(
  text: string,
  existing: readonly string[] = [],
  departments: readonly string[] = [],
): PastedCrew[] {
  let department = '';
  const names = new Set(existing.map((name) => name.trim().toLowerCase()));
  const lines = text.split(/\r?\n/);
  return lines.flatMap((source, index) => {
    const line = source.trim();
    if (!line) return [];
    const columns = split(line);
    const row: PastedCrew = { source, name: '', role: '', phone: '', department, status: 'new' };
    if (columns.some((c) => header.test(c)) && columns.every((c) => !c || header.test(c)))
      return [{ ...row, status: 'header' }];
    if (/^(agent|agente|agency|agenzia)\s*:/i.test(line)) return [{ ...row, status: 'agent' }];
    if (columns.length === 1 && !phoneIn(line)) {
      // A department is one the project knows, or a line in capitals heading a list of people;
      // a list of names in capitals, one per line, stays a list of people.
      const known = departments.find((d) => d.toLocaleLowerCase() === line.toLocaleLowerCase());
      const next = lines.slice(index + 1).find((l) => l.trim());
      const shouted = /\p{L}/u.test(line) && line === line.toUpperCase() && !/\d/.test(line);
      if (known || (shouted && next !== undefined && personRow(next.trim()))) {
        department = known ?? line.charAt(0) + line.slice(1).toLocaleLowerCase();
        return [];
      }
    }
    const parts = columns
      .map((column) => {
        const found = phoneIn(column);
        if (!found) return column;
        row.phone = [row.phone, found].filter(Boolean).join(' · ');
        return column.replace(found, '').trim();
      })
      .filter(Boolean);
    row.name = parts.shift() ?? '';
    row.role = parts.join(' · ');
    if (!row.name) return [{ ...row, status: 'noName' }];
    const key = row.name.toLowerCase();
    row.status = names.has(key) ? 'duplicate' : 'new';
    names.add(key);
    return [row];
  });
}
