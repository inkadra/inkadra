// SPDX-License-Identifier: MPL-2.0

/** Joins the class names that are set. Internal: not exported from the package. */
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');
