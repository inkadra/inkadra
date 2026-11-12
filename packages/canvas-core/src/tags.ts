// SPDX-License-Identifier: MPL-2.0

/**
 * A tag or group name as it is stored and compared: trimmed, without a leading #, spaces
 * collapsed, in lower case, at most 40 characters.
 */
export function normaliseTag(text: string): string {
  return text.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
}
