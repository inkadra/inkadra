// No imports: the export dialog shows dates before the PDF engine (pdf-lib) loads (#827).

/** A `YYYY-MM-DD` date in the reader's language, read as a calendar date. */
export function calendarDate(date: string, language: string, style: 'short' | 'long'): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(time);
}
