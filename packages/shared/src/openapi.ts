// SPDX-License-Identifier: MPL-2.0
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Asset, CreateLinkPreview, LinkPreview, UploadMetadata, VariantParams } from './assets.ts';
import { Board, BoardDetail, CreateBoard, UpdateBoard } from './boards.ts';
import { ClipRequest, ClipResult } from './clip.ts';
import { ApiError, Id, PageQuery, page, z } from './common.ts';
import { API_PREFIX, AUTH_PREFIX } from './constants.ts';
import { Diagnostics, Health, Instance } from './instance.ts';
import {
  CreateProject,
  Project,
  ProjectMember,
  SetProjectMember,
  UpdateProject,
} from './projects.ts';
import {
  AcceptedInvitation,
  BoardAccess,
  BoardAccessEntry,
  CreateInvitation,
  Invitation,
  InvitationPreview,
  InvitationQuery,
  InvitationResult,
  Person,
  SetBoardGrant,
  UserSearchQuery,
} from './sharing.ts';
import {
  AppAuthorizationRedirect,
  AppToken,
  CreateAppAuthorization,
  CreatedPersonalToken,
  CreatePersonalToken,
  DeleteMe,
  DeleteMeBlocked,
  ExchangeAppCode,
  PersonalToken,
  UpdateMe,
  User,
} from './users.ts';

export const API_VERSION = '0.3.0';

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'session', {
  type: 'apiKey',
  in: 'cookie',
  name: 'inkadra.session_token',
  description:
    'Session cookie set by the sign-in endpoints. Over HTTPS its name carries the `__Secure-` prefix.',
});
registry.registerComponent('securitySchemes', 'bearer', {
  type: 'http',
  scheme: 'bearer',
  description:
    'Personal or app token (browser clipper, mobile app, scripts): `ink_…`. Also accepted by ' +
    'the collab WebSocket as the Hocuspocus `token`.',
});

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  400: { description: 'Invalid request', ...json(ApiError) },
  401: { description: 'Not signed in', ...json(ApiError) },
  403: { description: 'Not allowed', ...json(ApiError) },
  404: { description: 'Not found', ...json(ApiError) },
};
const secured: Array<Record<string, string[]>> = [{ session: [] }, { bearer: [] }];
const v1 = (path: string) => `${API_PREFIX}${path}`;
const idParam = (name: string) => z.object({ [name]: Id });

// Instance -------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/health'),
  tags: ['Instance'],
  summary: 'Liveness and dependency checks, for Docker and reverse proxies.',
  responses: {
    200: { description: 'Healthy', ...json(Health) },
    503: { description: 'Unhealthy', ...json(Health) },
  },
});

registry.registerPath({
  method: 'get',
  path: v1('/instance'),
  tags: ['Instance'],
  summary: 'Public information the login screen and the apps need before signing in.',
  responses: { 200: { description: 'Instance', ...json(Instance) } },
});

registry.registerPath({
  method: 'get',
  path: v1('/diagnostics'),
  tags: ['Instance'],
  summary: 'Installation self-check: proxy, URL, database, queue and storage.',
  description:
    'Open to anyone while the instance has no accounts, so the person installing it can check ' +
    'the setup before signing up; `expected` and `actual` are then always null. Afterwards ' +
    'administrators only. Rate limited.',
  security: [{}, ...secured],
  responses: {
    200: { description: 'Diagnostics', ...json(Diagnostics) },
    401: errors[401],
    403: errors[403],
    429: { description: 'Too many requests', ...json(ApiError) },
  },
});

// Auth (Better Auth) ----------------------------------------------------------

const Credentials = z
  .object({ email: z.email(), password: z.string().min(10).max(128) })
  .openapi('Credentials');
const SignUp = Credentials.extend({ name: z.string().min(1).max(120) }).openapi('SignUp');
/** Errors from /api/auth come from Better Auth and use this shape instead of ApiError. */
const AuthError = z
  .object({ code: z.string().optional(), message: z.string() })
  .openapi('AuthError');
const authErrors = {
  400: { description: 'Invalid request', ...json(AuthError) },
  401: { description: 'Wrong credentials', ...json(AuthError) },
  403: { description: 'Registration closed (code REGISTRATION_CLOSED)', ...json(AuthError) },
};

const Session = z
  .object({
    user: User,
    session: z.object({ id: z.string(), expiresAt: z.string() }),
  })
  .openapi('Session');

registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-up/email`,
  tags: ['Auth'],
  summary: 'Create an account. Allowed only while registration is `first-user` or `open`.',
  request: { body: json(SignUp) },
  responses: { 200: { description: 'Signed up and signed in', ...json(Session) }, ...authErrors },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-in/email`,
  tags: ['Auth'],
  summary: 'Sign in with email and password. Sets the session cookie.',
  request: { body: json(Credentials) },
  responses: { 200: { description: 'Signed in', ...json(Session) }, 401: authErrors[401] },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-out`,
  tags: ['Auth'],
  summary: 'Sign out and clear the session cookie.',
  security: secured,
  responses: { 200: { description: 'Signed out' } },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-in/social`,
  tags: ['Auth'],
  summary: 'Start Google sign-in (`provider: "google"`), when Instance.auth.google is true.',
  description:
    'Answers with the Google address to open (`url`); Google sends the person back to ' +
    '`/api/auth/callback/google`, which sets the session cookie and redirects to `callbackURL`. ' +
    'Accounts with the same verified email are linked. In `invite` mode a new person needs an ' +
    'invitation claimed first (see POST /invitations/by-token/{token}/claim).',
  request: {
    body: json(
      z.object({
        provider: z.literal('google'),
        callbackURL: z.string().optional(),
        errorCallbackURL: z.string().optional(),
      }),
    ),
  },
  responses: {
    200: { description: 'Where to send the browser', ...json(z.object({ url: z.url() })) },
  },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-in/oauth2`,
  tags: ['Auth'],
  summary: 'Start sign-in with a generic OIDC provider listed in Instance.auth.oidc.',
  request: {
    body: json(
      z.object({
        providerId: z.string(),
        callbackURL: z.string().optional(),
        errorCallbackURL: z.string().optional(),
      }),
    ),
  },
  responses: {
    200: { description: 'Where to send the browser', ...json(z.object({ url: z.url() })) },
  },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/sign-in/magic-link`,
  tags: ['Auth'],
  summary: 'Email a sign-in link, when Instance.auth.magicLink is true. Valid 15 minutes.',
  description:
    'Always answers 200, whether or not the address has an account, so addresses cannot be ' +
    'probed. Without an account and outside `open` registration no email is sent.',
  request: {
    body: json(z.object({ email: z.email(), callbackURL: z.string().optional() })),
  },
  responses: { 200: { description: 'Accepted' } },
});
registry.registerPath({
  method: 'post',
  path: `${AUTH_PREFIX}/two-factor/verify-totp`,
  tags: ['Auth'],
  summary: 'Second step of a sign-in when the account has two-factor authentication.',
  description:
    'Sign-in answers `{ twoFactorRedirect: true }` instead of a session for these accounts. ' +
    'Send the 6-digit code from the authenticator app here, or a backup code to ' +
    '`/two-factor/verify-backup-code` (`{ code }`). Enable with `/two-factor/enable` ' +
    '(`{ password }`, answers `totpURI` and `backupCodes`), then confirm with a first code here; ' +
    'disable with `/two-factor/disable` (`{ password }`).',
  request: {
    body: json(z.object({ code: z.string().length(6), trustDevice: z.boolean().optional() })),
  },
  responses: { 200: { description: 'Signed in', ...json(Session) }, 401: authErrors[401] },
});
registry.registerPath({
  method: 'get',
  path: `${AUTH_PREFIX}/get-session`,
  tags: ['Auth'],
  summary: 'Current session, or null.',
  responses: { 200: { description: 'Session', ...json(Session.nullable()) } },
});

// Me -------------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/me'),
  tags: ['Users'],
  security: secured,
  responses: { 200: { description: 'Signed-in user', ...json(User) }, 401: errors[401] },
});
registry.registerPath({
  method: 'patch',
  path: v1('/me'),
  tags: ['Users'],
  security: secured,
  request: { body: json(UpdateMe) },
  responses: { 200: { description: 'Updated', ...json(User) }, ...errors },
});

registry.registerPath({
  method: 'delete',
  path: v1('/me'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Delete the account, its sessions and tokens, and the projects nobody else is in.',
  description:
    'Not available with a bearer token. Cards and files the person added to shared projects ' +
    'stay, without an author.',
  request: { body: json(DeleteMe) },
  responses: {
    204: { description: 'Deleted' },
    ...errors,
    409: {
      description: 'Sole owner of shared projects (details: DeleteMeBlocked)',
      ...json(ApiError),
    },
  },
});
registry.register('DeleteMeBlocked', DeleteMeBlocked);
registry.registerPath({
  method: 'get',
  path: v1('/me/tokens'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Personal and app tokens of the signed-in person.',
  responses: {
    200: { description: 'Tokens', ...json(z.object({ items: z.array(PersonalToken) })) },
    401: errors[401],
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/me/tokens'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Create a personal token, for scripts or a self-built app.',
  request: { body: json(CreatePersonalToken) },
  responses: { 201: { description: 'Created', ...json(CreatedPersonalToken) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/me/tokens/{tokenId}'),
  tags: ['Users'],
  security: secured,
  summary: 'Revoke a token. A token can revoke itself (sign out of the app).',
  request: { params: idParam('tokenId') },
  responses: { 204: { description: 'Revoked' }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/app-authorizations'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Allow an official app to act as the signed-in person; called by /authorize.',
  description:
    'Apps open `<server>/authorize?client_id=<clipper|mobile>&redirect_uri=…&state=…&' +
    'code_challenge=…&code_challenge_method=S256` in a browser. Once the person allows it, ' +
    'the page sends this request and follows `redirectTo`; the app then exchanges the code.',
  request: { body: json(CreateAppAuthorization) },
  responses: { 200: { description: 'Redirect', ...json(AppAuthorizationRedirect) }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/app-authorizations/token'),
  tags: ['Users'],
  security: [{}],
  summary: 'Exchange an authorization code and its PKCE verifier for an app token.',
  request: { body: json(ExchangeAppCode) },
  responses: {
    200: { description: 'Token', ...json(AppToken) },
    400: { description: 'Unknown, used or expired code, or wrong verifier', ...json(ApiError) },
    429: { description: 'Too many requests', ...json(ApiError) },
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/users/search'),
  tags: ['Users'],
  security: secured,
  summary: 'People to share with: those who share a project with you, or an exact email.',
  request: { query: UserSearchQuery },
  responses: {
    200: { description: 'At most 10 people', ...json(z.object({ items: z.array(Person) })) },
    401: errors[401],
  },
});

// Projects -------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/projects'),
  tags: ['Projects'],
  security: secured,
  request: { query: PageQuery.extend({ archived: z.enum(['true', 'false']).optional() }) },
  responses: {
    200: { description: 'Projects the user can see', ...json(page(Project)) },
    401: errors[401],
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/projects'),
  tags: ['Projects'],
  security: secured,
  summary: 'Create a project with its root board. The creator becomes owner.',
  request: { body: json(CreateProject) },
  responses: { 201: { description: 'Created', ...json(Project) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/projects/{projectId}'),
  tags: ['Projects'],
  security: secured,
  request: { params: idParam('projectId') },
  responses: { 200: { description: 'Project', ...json(Project) }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/projects/{projectId}'),
  tags: ['Projects'],
  security: secured,
  request: { params: idParam('projectId'), body: json(UpdateProject) },
  responses: { 200: { description: 'Updated', ...json(Project) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/projects/{projectId}'),
  tags: ['Projects'],
  security: secured,
  summary: 'Delete a project and everything in it. Owners only.',
  request: { params: idParam('projectId') },
  responses: { 204: { description: 'Deleted' }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/projects/{projectId}/members'),
  tags: ['Projects'],
  security: secured,
  request: { params: idParam('projectId') },
  responses: {
    200: { description: 'Members', ...json(z.object({ items: z.array(ProjectMember) })) },
    ...errors,
  },
});
registry.registerPath({
  method: 'put',
  path: v1('/projects/{projectId}/members/{userId}'),
  tags: ['Projects'],
  security: secured,
  summary: 'Add a member or change a role.',
  description:
    'Editors can add people as editor, commenter or viewer. Changing the role of an existing ' +
    'member, and anything about owners, is for owners. A project always keeps one owner.',
  request: { params: z.object({ projectId: Id, userId: Id }), body: json(SetProjectMember) },
  responses: { 200: { description: 'Member added or changed', ...json(ProjectMember) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/projects/{projectId}/members/{userId}'),
  tags: ['Projects'],
  security: secured,
  request: { params: z.object({ projectId: Id, userId: Id }) },
  responses: { 204: { description: 'Removed' }, ...errors },
});

// Boards ---------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/projects/{projectId}/boards'),
  tags: ['Boards'],
  security: secured,
  summary: 'Every board of the project, flat. Build the tree from parentBoardId.',
  request: { params: idParam('projectId') },
  responses: {
    200: { description: 'Boards', ...json(z.object({ items: z.array(Board) })) },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/projects/{projectId}/boards'),
  tags: ['Boards'],
  security: secured,
  request: { params: idParam('projectId'), body: json(CreateBoard) },
  responses: { 201: { description: 'Created', ...json(Board) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}'),
  tags: ['Boards'],
  security: secured,
  summary: 'Board metadata. The content is the Yjs document, synced over the collab WebSocket.',
  request: { params: idParam('boardId') },
  responses: { 200: { description: 'Board', ...json(BoardDetail) }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/boards/{boardId}'),
  tags: ['Boards'],
  security: secured,
  request: { params: idParam('boardId'), body: json(UpdateBoard) },
  responses: { 200: { description: 'Updated', ...json(Board) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/boards/{boardId}'),
  tags: ['Boards'],
  security: secured,
  summary: 'Move a board and its sub-boards to the trash. The root board cannot be deleted.',
  request: { params: idParam('boardId') },
  responses: { 204: { description: 'Deleted' }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: v1('/shared-boards'),
  tags: ['Boards'],
  security: secured,
  summary: 'Boards shared with you in projects you are not a member of.',
  description:
    'Only the top board of each shared subtree. Their projects are not listed by GET ' +
    '/projects; GET /projects/{projectId}/boards answers with the boards you can open.',
  responses: {
    200: { description: 'Boards', ...json(z.object({ items: z.array(Board) })) },
    401: errors[401],
  },
});

// Sharing --------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/access'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Everyone who can open the board, with their effective role and where it comes from.',
  description:
    'Roles come down from the project to its boards. A grant on a board replaces the ' +
    'inherited role (higher or lower) for that board and its sub-boards; the nearest grant ' +
    'wins. Needs at least viewer.',
  request: { params: idParam('boardId') },
  responses: { 200: { description: 'Access', ...json(BoardAccess) }, ...errors },
});
registry.registerPath({
  method: 'put',
  path: v1('/boards/{boardId}/grants/{userId}'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Give someone a role on this board and its sub-boards.',
  description:
    'Needs editor on the board; the role can be at most your own, and you cannot change the ' +
    'access of someone whose role here is higher than yours. Not for the root board: use ' +
    'project members.',
  request: { params: z.object({ boardId: Id, userId: Id }), body: json(SetBoardGrant) },
  responses: { 200: { description: 'Granted', ...json(BoardAccessEntry) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/boards/{boardId}/grants/{userId}'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Remove a grant: the person goes back to the inherited role, or loses access.',
  request: { params: z.object({ boardId: Id, userId: Id }) },
  responses: { 204: { description: 'Removed' }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/invitations'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Invitations still usable, for a project or a board (editors), or all (admins).',
  request: { query: InvitationQuery },
  responses: {
    200: { description: 'Invitations', ...json(z.object({ items: z.array(Invitation) })) },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/invitations'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Invite someone to a project or a board, or (admins) to the instance.',
  description:
    'With the address of an existing account the role is given straight away. Otherwise an ' +
    'invitation is created and, when SMTP is configured, emailed. Signing up through an ' +
    'invitation works even when registration is `invite`.',
  request: { body: json(CreateInvitation) },
  responses: {
    200: { description: 'Existing account: role given', ...json(InvitationResult) },
    201: { description: 'Invitation created', ...json(InvitationResult) },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/invitations/{invitationId}/resend'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Send an email invitation again and push its expiry back.',
  request: { params: idParam('invitationId') },
  responses: { 200: { description: 'Sent', ...json(Invitation) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/invitations/{invitationId}'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Revoke an invitation. Its link stops working at once.',
  request: { params: idParam('invitationId') },
  responses: { 204: { description: 'Revoked' }, ...errors },
});
const tokenParam = z.object({ token: z.string().min(16).max(128) });
registry.registerPath({
  method: 'get',
  path: v1('/invitations/by-token/{token}'),
  tags: ['Sharing'],
  security: [{}],
  summary: 'What an invitation link is for, shown before signing in. Rate limited.',
  request: { params: tokenParam },
  responses: {
    200: { description: 'Preview', ...json(InvitationPreview) },
    404: errors[404],
    429: { description: 'Too many requests', ...json(ApiError) },
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/invitations/by-token/{token}/claim'),
  tags: ['Sharing'],
  security: [{}],
  summary: 'Remember the invitation in this browser, so the next sign-up can use it.',
  description:
    'Sets a short-lived cookie. A sign-up (email, Google or OIDC) while it is set is allowed ' +
    'in `invite` mode and accepts the invitation once the account exists.',
  request: { params: tokenParam },
  responses: { 204: { description: 'Claimed' }, 404: errors[404] },
});
registry.registerPath({
  method: 'post',
  path: v1('/invitations/by-token/{token}/accept'),
  tags: ['Sharing'],
  security: secured,
  summary: 'Accept an invitation with the signed-in account.',
  request: { params: tokenParam },
  responses: { 200: { description: 'Accepted', ...json(AcceptedInvitation) }, ...errors },
});

// Assets and uploads ----------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: v1('/uploads'),
  tags: ['Assets'],
  security: secured,
  summary: 'Start a resumable upload (tus 1.0). Continue with PATCH on the Location returned.',
  description:
    'tus creation endpoint. Send `Tus-Resumable: 1.0.0`, `Upload-Length` and `Upload-Metadata` ' +
    'with the base64 encoded fields of UploadMetadata. Every response about the upload, ' +
    'including this one, carries `Inkadra-Asset-Id`: the asset exists from the start with ' +
    'status `pending` and is processed once the last byte arrives. Needs `editor` on the ' +
    'project. Uploads left unfinished are removed after 24 hours.',
  request: {
    headers: z.object({
      'Tus-Resumable': z.literal('1.0.0'),
      'Upload-Length': z.string(),
      'Upload-Metadata': z.string().openapi({ description: 'tus metadata, see UploadMetadata' }),
    }),
  },
  responses: {
    201: { description: 'Upload created; Location header points to it' },
    ...errors,
    413: { description: 'Larger than the instance limit (see Instance.limits)' },
  },
});
const uploadParams = z.object({ uploadId: Id });
registry.registerPath({
  method: 'head',
  path: v1('/uploads/{uploadId}'),
  tags: ['Assets'],
  security: secured,
  summary: 'Offset of a resumable upload (tus 1.0), to resume after an interruption.',
  request: { params: uploadParams },
  responses: { 200: { description: '`Upload-Offset` and `Upload-Length` headers' }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/uploads/{uploadId}'),
  tags: ['Assets'],
  security: secured,
  summary: 'Append bytes at `Upload-Offset` (tus 1.0, `application/offset+octet-stream`).',
  request: { params: uploadParams },
  responses: { 204: { description: 'Bytes stored; new `Upload-Offset` header' }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/uploads/{uploadId}'),
  tags: ['Assets'],
  security: secured,
  summary: 'Cancel an unfinished upload (tus termination extension).',
  request: { params: uploadParams },
  responses: { 204: { description: 'Cancelled' }, ...errors },
});
registry.register('UploadMetadata', UploadMetadata);
registry.registerPath({
  method: 'get',
  path: v1('/assets/{assetId}'),
  tags: ['Assets'],
  security: secured,
  request: { params: idParam('assetId') },
  responses: { 200: { description: 'Asset', ...json(Asset) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/assets/{assetId}/file'),
  tags: ['Assets'],
  security: secured,
  summary: 'The original file. Supports `Range`; `?download=1` asks the browser to save it.',
  description:
    'Types a browser could run as a page (HTML, SVG, XML) are always sent as attachments, ' +
    'with a sandbox Content-Security-Policy.',
  request: {
    params: idParam('assetId'),
    query: z.object({ download: z.enum(['1']).optional() }),
  },
  responses: {
    200: { description: 'File' },
    206: { description: 'Part of the file' },
    ...errors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/assets/{assetId}/variants/{size}'),
  tags: ['Assets'],
  security: secured,
  summary: 'A WebP thumbnail, without any metadata of the original.',
  request: { params: VariantParams },
  responses: {
    200: { description: 'WebP image', content: { 'image/webp': { schema: z.string() } } },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/link-previews'),
  tags: ['Assets'],
  security: secured,
  summary: 'Read title, description and image of a public web page, for a link card.',
  description:
    'The server fetches the page itself, only over http(s) on public addresses, with a size ' +
    'and time limit. Needs `editor` on the project. The image becomes an asset of the project.',
  request: { body: json(CreateLinkPreview) },
  responses: {
    200: { description: 'Preview', ...json(LinkPreview) },
    ...errors,
    400: { description: 'Invalid address, or the page could not be fetched', ...json(ApiError) },
  },
});

// Clip -----------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: v1('/clip'),
  tags: ['Clip'],
  security: secured,
  summary: 'Save an image, a link or a text to a board, from the clipper or the share sheet.',
  request: {
    body: {
      content: {
        'application/json': { schema: ClipRequest },
        'multipart/form-data': {
          schema: z.object({
            boardId: Id,
            columnId: z.string().optional(),
            sourceUrl: z.url().optional(),
            note: z.string().optional(),
            file: z.string().openapi({ format: 'binary' }),
          }),
        },
      },
    },
  },
  responses: { 201: { description: 'Card created', ...json(ClipResult) }, ...errors },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Inkadra API',
      version: API_VERSION,
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      description:
        'REST API of a self-hosted Inkadra server. Board content is not here: it is a Yjs ' +
        'document synced over the WebSocket at /collab (see @inkadra/doc-schema).',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Instance' },
      { name: 'Auth' },
      { name: 'Users' },
      { name: 'Projects' },
      { name: 'Boards' },
      { name: 'Sharing' },
      { name: 'Assets' },
      { name: 'Clip' },
    ],
  });
}
