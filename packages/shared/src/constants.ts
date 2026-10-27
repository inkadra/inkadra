// SPDX-License-Identifier: MPL-2.0
/** Dependency-free constants, safe to import from browser bundles. */

/** Prefix of every versioned REST endpoint. Authentication lives under /api/auth. */
export const API_PREFIX = '/api/v1';
export const AUTH_PREFIX = '/api/auth';
export const COLLAB_PATH = '/collab';

/**
 * Widest moving thumbnail the worker makes for a GIF or an animated WebP, served at
 * `variants/{size}?animated=1`. Larger pictures have a static poster only.
 */
export const MOVING_THUMBNAIL_MAX_WIDTH = 1024;
