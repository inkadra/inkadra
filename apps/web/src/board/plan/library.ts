// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The library's catalogue, search and names live in canvas-core (decision 0116): the web and the
 * mobile app find the same icons, in the same order, for the same query.
 */
export {
  foldSearch as fold,
  isNoteTool,
  LIBRARY_CATEGORIES,
  type LibraryCategoryId as CategoryId,
  type LibraryHit,
  type LibraryItem,
  placeOf,
  projectKitDetail,
  searchLibrary,
} from '@inkadra/canvas-core';
