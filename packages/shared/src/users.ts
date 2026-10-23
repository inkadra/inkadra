// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

export const InstanceRole = z.enum(['admin', 'member']);
export type InstanceRole = z.infer<typeof InstanceRole>;

export const User = z
  .object({
    id: Id,
    email: z.email(),
    name: z.string().min(1).max(120),
    image: z.url().nullable(),
    role: InstanceRole,
    locale: z.string().max(16).nullable(),
    twoFactorEnabled: z.boolean(),
    createdAt: Timestamp,
  })
  .openapi('User');
export type User = z.infer<typeof User>;

export const UserSummary = User.pick({ id: true, name: true, image: true }).openapi('UserSummary');
export type UserSummary = z.infer<typeof UserSummary>;

export const UpdateMe = z
  .object({
    name: z.string().min(1).max(120),
    locale: z.string().max(16).nullable(),
  })
  .partial()
  .openapi('UpdateMe');
export type UpdateMe = z.infer<typeof UpdateMe>;

/** Body of DELETE /api/v1/me. */
export const DeleteMe = z
  .object({
    password: z
      .string()
      .max(128)
      .optional()
      .openapi({
        description:
          'Required when the account has a password. Accounts that only sign in with Google or ' +
          'OIDC must have signed in during the last 15 minutes instead.',
      }),
  })
  .openapi('DeleteMe');
export type DeleteMe = z.infer<typeof DeleteMe>;

/** `details` of the 409 answer to DELETE /api/v1/me. */
export const DeleteMeBlocked = z
  .object({
    soleOwnerOf: z.array(z.object({ id: Id, name: z.string() })).openapi({
      description:
        'Projects shared with other people where this account is the only owner: make someone ' +
        'else owner first. Projects nobody else is in are deleted with the account.',
    }),
  })
  .openapi('DeleteMeBlocked');
export type DeleteMeBlocked = z.infer<typeof DeleteMeBlocked>;

// Tokens for the browser clipper, the mobile app and scripts -------------------------

export const AppClient = z.enum(['clipper', 'mobile']).openapi({
  description:
    'Official apps that can ask for a token through /authorize, each with exact redirect ' +
    'addresses: `clipper` → `https://<id>.chromiumapp.org/auth` for the official extension ids ' +
    '(plus CLIPPER_EXTENSION_IDS for self-built ones), `mobile` → `inkadra://auth`.',
});
export type AppClient = z.infer<typeof AppClient>;

export const PersonalToken = z
  .object({
    id: Id,
    name: z.string().min(1).max(80),
    client: AppClient.nullable().openapi({ description: 'Null for tokens made by hand.' }),
    prefix: z.string().openapi({ description: 'First characters, to recognise the token.' }),
    createdAt: Timestamp,
    lastUsedAt: Timestamp.nullable(),
    expiresAt: Timestamp.nullable(),
  })
  .openapi('PersonalToken');
export type PersonalToken = z.infer<typeof PersonalToken>;

export const CreatePersonalToken = z
  .object({
    name: z.string().trim().min(1).max(80),
    expiresInDays: z.int().min(1).max(3650).nullable().default(null),
  })
  .openapi('CreatePersonalToken');
export type CreatePersonalToken = z.infer<typeof CreatePersonalToken>;

export const CreatedPersonalToken = PersonalToken.extend({
  token: z.string().openapi({
    description: 'Shown only once. Send it as `Authorization: Bearer <token>`.',
    example: 'ink_8Qd2…',
  }),
}).openapi('CreatedPersonalToken');
export type CreatedPersonalToken = z.infer<typeof CreatedPersonalToken>;

const Base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

/**
 * Sent by the /authorize page once the signed-in person allows the app (OAuth 2.0
 * authorization code with PKCE, RFC 7636, without client secrets).
 */
export const CreateAppAuthorization = z
  .object({
    clientId: AppClient,
    redirectUri: z.url(),
    codeChallenge: Base64Url.min(43).max(128),
    codeChallengeMethod: z.literal('S256'),
    state: z.string().max(512).optional(),
    deviceName: z.string().trim().min(1).max(80).optional(),
  })
  .openapi('CreateAppAuthorization');
export type CreateAppAuthorization = z.infer<typeof CreateAppAuthorization>;

export const AppAuthorizationRedirect = z
  .object({
    redirectTo: z.url().openapi({
      description: 'redirectUri with `code` (valid 2 minutes, once) and `state` added.',
    }),
  })
  .openapi('AppAuthorizationRedirect');
export type AppAuthorizationRedirect = z.infer<typeof AppAuthorizationRedirect>;

export const ExchangeAppCode = z
  .object({
    clientId: AppClient,
    code: z.string().min(1).max(256),
    codeVerifier: Base64Url.min(43).max(128),
    redirectUri: z.url(),
  })
  .openapi('ExchangeAppCode');
export type ExchangeAppCode = z.infer<typeof ExchangeAppCode>;

export const AppToken = z
  .object({
    token: z.string().openapi({ description: 'Send it as `Authorization: Bearer <token>`.' }),
    tokenId: Id,
    user: User,
  })
  .openapi('AppToken');
export type AppToken = z.infer<typeof AppToken>;
