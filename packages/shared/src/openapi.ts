// SPDX-License-Identifier: MPL-2.0
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  Asset,
  CreateLinkPreview,
  LinkPreview,
  ThumbnailSize,
  UploadMetadata,
  VariantParams,
  VariantQuery,
} from './assets.ts';
import {
  Board,
  BoardCounts,
  BoardDetail,
  BoardPreview,
  CreateBoard,
  RecentBoard,
  RecentBoardQuery,
  UpdateBoard,
} from './boards.ts';
import { ClassificationCatalogs } from './classifications.ts';
import { BoardColumns, ClipRequest, ClipResult } from './clip.ts';
import {
  CommentCounts,
  CommentQuery,
  Comment as CommentSchema,
  CommentThread,
  CreateComment,
  ElementRef,
  GuestComment,
  GuestCommentThread,
  GuestCreateComment,
  GuestUpdateComment,
  ReplyQuery,
  UpdateComment,
} from './comments.ts';
import { ApiError, Id, OutcomeUnknown, PageQuery, page, z } from './common.ts';
import { API_PREFIX, AUTH_PREFIX } from './constants.ts';
import {
  CreateGuestSession,
  CreateShareLink,
  GuestBoardSnapshot,
  GuestDenied,
  GuestPick,
  GuestSession,
  SetPick,
  ShareLink,
  ShareLinkPicks,
  ShareLinkPreview,
  UpdateGuestSession,
  UpdateShareLink,
} from './guests.ts';
import { Diagnostics, Health, Instance, InstanceVersion } from './instance.ts';
import {
  InstanceMember,
  InstanceSettings,
  StorageUsage,
  UpdateInstanceMember,
  UpdateInstanceSettings,
} from './instance-admin.ts';
import {
  MarkAllRead,
  Notification,
  NotificationPreferences,
  NotificationQuery,
  UnreadCount,
  UpdateNotificationPreferences,
} from './notifications.ts';
import {
  CreateProject,
  Project,
  ProjectMember,
  SetProjectMember,
  SetProjectPin,
  UpdateProject,
} from './projects.ts';
import {
  BoardReviews,
  ElementReview,
  ElementReviewEvent,
  GuestElementReview,
  GuestSetElementReview,
  ReviewHistoryQuery,
  SetElementReview,
} from './reviews.ts';
import {
  MySchedule,
  MyScheduleQuery,
  Schedule,
  ShootingDay,
  ShootingDayInput,
  UpdateShootingDay,
} from './schedule.ts';
import { SearchQuery, SearchResult, TagCount } from './search.ts';
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
  AccountSession,
  AppAuthorizationRedirect,
  AppToken,
  CreateAppAuthorization,
  CreatedPersonalToken,
  CreatePersonalToken,
  DeleteMe,
  DeleteMeBlocked,
  DenyAppAuthorization,
  ExchangeAppCode,
  PersonalToken,
  UpdateMe,
  UploadAvatar,
  User,
} from './users.ts';
import {
  BoardVersion,
  BoardVersionConflict,
  BoardVersionQuery,
  CreateBoardVersion,
  RestoredBoardVersion,
  UpdateBoardVersion,
} from './versions.ts';

export const API_VERSION = '0.7.0';

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
/** A change handed to the board: a 500 may leave it unknown whether it was made. */
const outcome = {
  500: {
    description:
      'The change may or may not have been made. OutcomeUnknown (`outcome_unknown`) explicitly ' +
      'reports uncertainty. A missing or unrecognized details.reason also means the outcome ' +
      'is unknown, including on legacy servers. Reconcile state before retrying; never infer ' +
      'that a retry is safe from the absence of a recognized reason.',
    ...json(ApiError),
  },
};
registry.register('OutcomeUnknown', OutcomeUnknown);

// Schedule ------------------------------------------------------------------
const schedulePath = v1('/boards/{boardId}/schedule');
registry.registerPath({
  method: 'get',
  path: schedulePath,
  tags: ['Schedule'],
  security: secured,
  summary: 'Read shooting days for this board; requires viewer access.',
  request: { params: idParam('boardId') },
  responses: {
    200: { description: 'Shooting days ordered by date and id.', ...json(Schedule) },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: schedulePath,
  tags: ['Schedule'],
  security: secured,
  summary: 'Create a project shooting day anchored to this board; requires editor access.',
  request: { params: idParam('boardId'), body: json(ShootingDayInput) },
  responses: { 201: { description: 'Created', ...json(ShootingDay) }, ...errors },
});
registry.registerPath({
  method: 'put',
  path: `${schedulePath}/{dayId}`,
  tags: ['Schedule'],
  security: secured,
  summary: 'Replace a day and its ordered blocks with revision checking; requires editor access.',
  request: { params: z.object({ boardId: Id, dayId: Id }), body: json(UpdateShootingDay) },
  responses: {
    200: { description: 'Updated', ...json(ShootingDay) },
    ...errors,
    409: {
      description: 'Stale revision or removed day. Reload before editing.',
      ...json(ApiError),
    },
  },
});
registry.registerPath({
  method: 'delete',
  path: `${schedulePath}/{dayId}`,
  tags: ['Schedule'],
  security: secured,
  summary: 'Remove a shooting day; requires editor access and its current revision.',
  request: {
    params: z.object({ boardId: Id, dayId: Id }),
    body: json(z.object({ revision: z.number().int().min(1) }).strict()),
  },
  responses: {
    204: { description: 'Removed' },
    ...errors,
    409: { description: 'Stale revision or removed day.', ...json(ApiError) },
  },
});

registry.registerPath({
  method: 'get',
  path: v1('/me/shooting-days'),
  tags: ['Schedule'],
  security: secured,
  summary: 'Shooting days of every board you can open, between two local dates.',
  description:
    'For the Home: days in projects that are not archived, ordered by date, call time and id. ' +
    'Each day is checked with the same rule as GET /boards/{boardId}/schedule (viewer on its ' +
    'board), so days of boards you cannot open are left out. At most 62 days per request.',
  request: { query: MyScheduleQuery },
  responses: {
    200: { description: 'Shooting days', ...json(MySchedule) },
    400: errors[400],
    401: errors[401],
  },
});

// Instance -------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/instance/version'),
  tags: ['Instance'],
  security: secured,
  summary: 'Software version for signed-in users.',
  responses: { 200: { description: 'Version', ...json(InstanceVersion) }, ...errors },
});

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
  path: v1('/instance/settings'),
  tags: ['Instance'],
  security: secured,
  summary: 'Administrator only: instance branding and registration settings.',
  responses: { 200: { description: 'Settings', ...json(InstanceSettings) }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/instance/settings'),
  tags: ['Instance'],
  security: secured,
  summary: 'Administrator only: persist instance name and registration mode.',
  request: { body: { required: true, ...json(UpdateInstanceSettings) } },
  responses: { 200: { description: 'Saved settings', ...json(InstanceSettings) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/instance/members'),
  tags: ['Instance'],
  security: secured,
  summary: 'Administrator only: directory of active and deactivated instance accounts.',
  responses: {
    200: { description: 'Members', ...json(z.object({ items: z.array(InstanceMember) })) },
    ...errors,
  },
});
registry.registerPath({
  method: 'patch',
  path: v1('/instance/members/{userId}'),
  tags: ['Instance'],
  security: secured,
  summary: 'Administrator only: change global role or deactivate/reactivate an account.',
  description:
    'Deactivation preserves content and memberships, revokes sessions and personal tokens and prevents sign-in. The last active administrator cannot be demoted or deactivated. Invitations never grant administrator privileges.',
  request: {
    params: z.object({ userId: Id }),
    body: { required: true, ...json(UpdateInstanceMember) },
  },
  responses: {
    200: { description: 'Updated', ...json(z.object({ ok: z.literal(true) })) },
    ...errors,
    409: { description: 'Last active administrator', ...json(ApiError) },
  },
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
  summary:
    'Start sign-in with Google (`provider: "google"`, when Instance.auth.google is true) or an ' +
    'OIDC provider (`provider`: an id from Instance.auth.oidc).',
  description:
    'Answers with the provider address to open (`url`); the provider sends the person back to ' +
    '`/api/auth/callback/{provider}`, which sets the session cookie and redirects to ' +
    '`callbackURL`. ' +
    'Accounts with the same verified email are linked. In `invite` mode a new person needs an ' +
    'invitation claimed first (see POST /invitations/by-token/{token}/claim).',
  request: {
    body: json(
      z.object({
        provider: z.string().openapi({ example: 'google' }),
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

registry.registerPath({
  method: 'get',
  path: v1('/instance/classifications'),
  tags: ['Instance'],
  security: secured,
  responses: {
    200: { description: 'Instance-wide classification catalogs', ...json(ClassificationCatalogs) },
    ...errors,
  },
});
registry.registerPath({
  method: 'put',
  path: v1('/instance/classifications'),
  tags: ['Instance'],
  security: secured,
  request: { body: json(ClassificationCatalogs) },
  responses: {
    200: {
      description: 'Administrator update; revision prevents lost edits; IDs cannot be removed',
      ...json(ClassificationCatalogs),
    },
    ...errors,
  },
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
  method: 'put',
  path: v1('/me/avatar'),
  tags: ['Users'],
  security: [{ session: [] }],
  request: { body: json(UploadAvatar) },
  responses: { 200: { description: 'Updated avatar', ...json(User) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/me/avatar'),
  tags: ['Users'],
  security: [{ session: [] }],
  responses: { 200: { description: 'Removed avatar', ...json(User) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/users/{userId}/avatar/{version}'),
  tags: ['Users'],
  security: secured,
  request: { params: z.object({ userId: Id, version: z.uuid() }) },
  responses: {
    200: {
      description: 'Current profile image',
      content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
    },
    ...errors,
  },
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
      description:
        'Sole owner of shared projects (details: DeleteMeBlocked), or last active instance administrator.',
      ...json(ApiError),
    },
  },
});
registry.register('DeleteMeBlocked', DeleteMeBlocked);
registry.registerPath({
  method: 'get',
  path: v1('/me/sessions'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Browsers signed in to the account, without their tokens.',
  responses: {
    200: { description: 'Sessions', ...json(z.object({ items: z.array(AccountSession) })) },
    401: errors[401],
    403: errors[403],
  },
});
registry.registerPath({
  method: 'delete',
  path: v1('/me/sessions/{sessionId}'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Sign a browser out of the account. Ending the current session signs out.',
  request: { params: idParam('sessionId') },
  responses: { 204: { description: 'Ended' }, ...errors },
});
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
    'code_challenge=…&code_challenge_method=S256&device_name=…` in a browser. The page shows ' +
    'which app and device ask for access; once the person allows it, it sends this request ' +
    'and follows `redirectTo`, and the app exchanges the code. The redirect address must be ' +
    'one of the exact addresses allowed for the client (see AppClient).',
  request: { body: json(CreateAppAuthorization) },
  responses: { 200: { description: 'Redirect', ...json(AppAuthorizationRedirect) }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/app-authorizations/deny'),
  tags: ['Users'],
  security: [{ session: [] }],
  summary: 'Tell an official app that the person denied it; called by /authorize.',
  description:
    'Checks the redirect address like `POST /app-authorizations` and answers with it plus ' +
    '`error=access_denied` and `state` (RFC 6749 §4.1.2.1). No code is issued.',
  request: { body: json(DenyAppAuthorization) },
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
  description:
    'Only for people who can share (editor or owner of at least one project or board). An ' +
    'exact email match confirms that the account exists, so the endpoint is rate limited ' +
    '(30 searches a minute).',
  request: { query: UserSearchQuery },
  responses: {
    200: { description: 'At most 10 people', ...json(z.object({ items: z.array(Person) })) },
    401: errors[401],
    403: errors[403],
    429: { description: 'Too many requests', ...json(ApiError) },
  },
});

registry.registerPath({
  method: 'get',
  path: v1('/instance/storage'),
  tags: ['Instance'],
  security: secured,
  summary: 'Administrator-only sum of original asset sizes; excludes derived files and database.',
  responses: {
    200: {
      description: 'Original asset usage',
      ...json(StorageUsage),
    },
    ...errors,
  },
});

// Projects -------------------------------------------------------------------

registry.registerPath({
  method: 'put',
  path: v1('/projects/{projectId}/pin'),
  tags: ['Projects'],
  security: secured,
  summary: 'Set the caller’s personal project pin. Requires project membership.',
  request: { params: idParam('projectId'), body: json(SetProjectPin) },
  responses: { 200: { description: 'Updated', ...json(Project) }, ...errors },
});

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
  path: v1('/me/recent-boards'),
  tags: ['Boards'],
  security: secured,
  summary: 'Boards you can open, most recently edited first.',
  description:
    'For the Home: boards of projects that are not archived, including boards shared with ' +
    'you, ordered by `editedAt`. Not paged; `limit` caps the list.',
  request: { query: RecentBoardQuery },
  responses: {
    200: {
      description: 'Boards',
      ...json(z.object({ items: z.array(RecentBoard), nextCursor: z.null() })),
    },
    400: errors[400],
    401: errors[401],
  },
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

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/columns'),
  tags: ['Boards'],
  security: secured,
  summary: 'Columns of a board, to choose where a clip goes. Needs viewer.',
  description:
    'Read from the stored board document, so a column added seconds ago can be missing. ' +
    'Clipping still needs editor (see SearchHit.myRole and Board.myRole).',
  request: { params: idParam('boardId') },
  responses: { 200: { description: 'Columns', ...json(BoardColumns) }, ...errors },
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
  description:
    'The poster by default. With `?animated=1`, the moving copy of a GIF or an animated ' +
    'WebP, when `Asset.animated` says the worker wrote one: 404 otherwise.',
  request: { params: VariantParams, query: VariantQuery },
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

// Search ---------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/search'),
  tags: ['Search'],
  security: secured,
  summary: 'Find projects, boards and cards the caller can open.',
  description:
    'Matches parts of words without case, in titles, notes, captions, to-dos, shot data, tags ' +
    'and file names. Only boards the caller can read are searched. Card content comes from an ' +
    'index of the board documents, updated a few seconds after each edit.',
  request: { query: SearchQuery },
  responses: { 200: { description: 'Results, best first', ...json(SearchResult) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/projects/{projectId}/tags'),
  tags: ['Search'],
  security: secured,
  summary: 'Tags used on the cards of a project, most used first.',
  description:
    'Counts only the boards the caller can read, with the same rule as /search: when board ' +
    'grants limit someone to some boards of a project, tags of the other boards stay hidden.',
  request: { params: idParam('projectId') },
  responses: {
    200: { description: 'Tags', ...json(z.object({ items: z.array(TagCount) })) },
    ...errors,
  },
});

// Comments -------------------------------------------------------------------

const commentParams = z.object({ commentId: Id });
const tooMany = { 429: { description: 'Too many requests', ...json(ApiError) } };
const realtime =
  ' Open boards are told with the stateless collab message `{"type":"comments"}` (BoardNotice ' +
  'in @inkadra/doc-schema) and fetch again.';

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/comments'),
  tags: ['Comments'],
  security: secured,
  summary: 'Comment threads of a board and its cards, newest first.',
  description:
    'Needs viewer. Threads are ordered by when they were started (newest first, then by id), ' +
    'so the cursor never skips or repeats a thread while people reply. Each thread comes with ' +
    'its latest replies and `replyCount`; earlier replies come from ' +
    '`GET /comments/{commentId}/replies`.',
  request: { params: idParam('boardId'), query: CommentQuery },
  responses: { 200: { description: 'Threads', ...json(page(CommentThread)) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/comment-counts'),
  tags: ['Comments'],
  security: secured,
  summary: 'Open and resolved threads per card, for the badges on the canvas.',
  description: 'Needs viewer.',
  request: { params: idParam('boardId') },
  responses: { 200: { description: 'Counts', ...json(CommentCounts) }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/boards/{boardId}/comments'),
  tags: ['Comments'],
  security: secured,
  summary: 'Start a thread on the board or a card, or reply to one.',
  description:
    'Needs commenter. Mentions of people who cannot read the board are dropped; the others, ' +
    'the authors of the thread and the creator of the card are notified. A reply must belong ' +
    'to a thread of the same board.' +
    realtime,
  request: { params: idParam('boardId'), body: json(CreateComment) },
  responses: { 201: { description: 'Created', ...json(CommentSchema) }, ...errors, ...tooMany },
});
registry.registerPath({
  method: 'get',
  path: v1('/comments/{commentId}/replies'),
  tags: ['Comments'],
  security: secured,
  summary: 'Every reply of a thread, oldest first. Needs viewer.',
  request: { params: commentParams, query: ReplyQuery },
  responses: { 200: { description: 'Replies', ...json(page(CommentSchema)) }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/comments/{commentId}'),
  tags: ['Comments'],
  security: secured,
  summary: 'Edit your own comment.',
  description: 'Newly mentioned people are notified; people already mentioned are not.',
  request: { params: commentParams, body: json(UpdateComment) },
  responses: { 200: { description: 'Updated', ...json(CommentSchema) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/comments/{commentId}'),
  tags: ['Comments'],
  security: secured,
  summary: 'Delete a comment: your own, or any as editor or owner of the board.',
  description:
    'A thread start with replies stays as an empty placeholder (`deletedAt`); anything else ' +
    'is removed.',
  request: { params: commentParams },
  responses: { 204: { description: 'Deleted' }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/comments/{commentId}/resolve'),
  tags: ['Comments'],
  security: secured,
  summary: 'Mark a thread resolved. Needs commenter; only for the first comment of a thread.',
  request: { params: commentParams },
  responses: { 200: { description: 'Resolved', ...json(CommentThread) }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/comments/{commentId}/reopen'),
  tags: ['Comments'],
  security: secured,
  summary: 'Open a resolved thread again. Needs commenter.',
  request: { params: commentParams },
  responses: { 200: { description: 'Reopened', ...json(CommentThread) }, ...errors },
});

// Reviews --------------------------------------------------------------------

const elementParams = z.object({ boardId: Id, elementId: ElementRef });

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/reviews'),
  tags: ['Reviews'],
  security: secured,
  summary: 'Review status of the cards of a board (cards still `none` are left out).',
  description:
    'Needs viewer. For each card, the most recent change among the team’s status and the ' +
    'decisions of guests of every link, with who made it (a withdrawn guest decision does ' +
    'not count). Open boards are told about changes with the stateless collab message ' +
    '`{"type":"review"}`.',
  request: { params: idParam('boardId') },
  responses: { 200: { description: 'Reviews', ...json(BoardReviews) }, ...errors },
});
registry.registerPath({
  method: 'put',
  path: v1('/boards/{boardId}/elements/{elementId}/review'),
  tags: ['Reviews'],
  security: secured,
  summary: 'Set the team’s review status of a card. Needs commenter.',
  description:
    'Every change is kept in the history. It replaces the team’s status only: decisions of ' +
    'guests stay in the history and on their link, and a more recent change wins on each ' +
    'link. The creator of the card and whoever asked for the ' +
    'review are notified. The card must exist in the stored board document.' +
    ' Open boards are told with the stateless collab message `{"type":"review"}`.',
  request: { params: elementParams, body: json(SetElementReview) },
  responses: { 200: { description: 'Set', ...json(ElementReview) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/elements/{elementId}/review/history'),
  tags: ['Reviews'],
  security: secured,
  summary: 'Every change of the review status of a card, newest first. Needs viewer.',
  description: 'Changes of the team’s status and of the decisions of every link.',
  request: { params: elementParams, query: ReviewHistoryQuery },
  responses: { 200: { description: 'History', ...json(page(ElementReviewEvent)) }, ...errors },
});

// Notifications --------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: v1('/me/notifications'),
  tags: ['Notifications'],
  security: secured,
  summary: 'Notifications of the signed-in person, newest first.',
  description:
    'Notifications about boards the person can no longer open are left out, checked with the ' +
    'same rules as the board itself; a page can therefore be short or empty with a ' +
    '`nextCursor`. They are kept 90 days.',
  request: { query: NotificationQuery },
  responses: {
    200: { description: 'Notifications', ...json(page(Notification)) },
    401: errors[401],
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/me/notifications/unread-count'),
  tags: ['Notifications'],
  security: secured,
  summary: 'Number for the badge. Cheap enough to poll every minute.',
  description: 'Counts only what the list would show: the same access filter applies.',
  responses: { 200: { description: 'Count', ...json(UnreadCount) }, 401: errors[401] },
});
registry.registerPath({
  method: 'post',
  path: v1('/me/notifications/{notificationId}/read'),
  tags: ['Notifications'],
  security: secured,
  request: { params: idParam('notificationId') },
  responses: { 204: { description: 'Marked read' }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/me/notifications/{notificationId}/unread'),
  tags: ['Notifications'],
  security: secured,
  request: { params: idParam('notificationId') },
  responses: { 204: { description: 'Marked unread' }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/me/notifications/read-all'),
  tags: ['Notifications'],
  security: secured,
  request: { body: json(MarkAllRead) },
  responses: { 200: { description: 'Marked read', ...json(UnreadCount) }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/me/notification-preferences'),
  tags: ['Notifications'],
  security: secured,
  responses: {
    200: { description: 'Preferences', ...json(NotificationPreferences) },
    401: errors[401],
  },
});
registry.registerPath({
  method: 'patch',
  path: v1('/me/notification-preferences'),
  tags: ['Notifications'],
  security: secured,
  request: { body: json(UpdateNotificationPreferences) },
  responses: { 200: { description: 'Updated', ...json(NotificationPreferences) }, ...errors },
});

// Share links (managed by editors and owners) ---------------------------------

const linkParams = z.object({ linkId: Id });

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/share-links'),
  tags: ['Share links'],
  security: secured,
  summary: 'Share links of a board, revoked and expired ones included. Needs editor.',
  request: { params: idParam('boardId') },
  responses: {
    200: { description: 'Links', ...json(z.object({ items: z.array(ShareLink) })) },
    ...errors,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/boards/{boardId}/share-links'),
  tags: ['Share links'],
  security: secured,
  summary: 'Create a link for people without an account. Needs editor.',
  description:
    'Each person can create 50 share links an hour. The link acts for its creator: guests see ' +
    'only boards where the creator has at least editor at the time of each request, and the ' +
    'link is `suspended` while the creator lacks it on the board of the link.',
  request: { params: idParam('boardId'), body: json(CreateShareLink) },
  responses: {
    201: { description: 'Created', ...json(ShareLink) },
    ...errors,
    429: { description: 'Too many requests', ...json(ApiError) },
  },
});
registry.registerPath({
  method: 'patch',
  path: v1('/share-links/{linkId}'),
  tags: ['Share links'],
  security: secured,
  summary: 'Change a link. Needs editor on its board; takes effect for open guest pages at once.',
  request: { params: linkParams, body: json(UpdateShareLink) },
  responses: { 200: { description: 'Updated', ...json(ShareLink) }, ...errors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/share-links/{linkId}'),
  tags: ['Share links'],
  security: secured,
  summary: 'Revoke a link. It stops working at once; comments and picks of its guests stay.',
  request: { params: linkParams },
  responses: { 204: { description: 'Revoked' }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/share-links/{linkId}/picks'),
  tags: ['Share links'],
  security: secured,
  summary: 'Proofing results: picks, rejections and stars of every guest of the link.',
  description: 'Needs editor on the board of the link.',
  request: { params: linkParams },
  responses: { 200: { description: 'Picks', ...json(ShareLinkPicks) }, ...errors },
});

// Guests (no account: share link and guest cookie) ------------------------------

const shareTokenParam = z.object({ token: z.string().min(16).max(128) });
const guest: Array<Record<string, string[]>> = [{ guest: [] }];
registry.registerComponent('securitySchemes', 'guest', {
  type: 'apiKey',
  in: 'cookie',
  name: 'inkadra.guest',
  description:
    'Guest session of one share link, set by POST /guest/links/{linkId}/session with ' +
    '`Path=/api/v1/guest/links/{linkId}`, HttpOnly, SameSite=Lax and Max-Age of 30 days, ' +
    'renewed while the guest is active. Over HTTPS its name carries the `__Secure-` prefix. ' +
    'Every write request under /api/v1/guest/, with or without this cookie (opening a ' +
    'session included), must come from the instance itself: `Origin` must equal the origin ' +
    'of PUBLIC_URL or, without `Origin`, `Sec-Fetch-Site` must be `same-origin`; otherwise ' +
    '403.',
});
const guestErrors = {
  400: errors[400],
  401: { description: 'No guest session, or it expired (details: GuestDenied)', ...json(ApiError) },
  403: {
    description:
      'Link expired, revoked or suspended, password changed, role too low, or a cross-site ' +
      'write (GuestDenied)',
    ...json(ApiError),
  },
  404: {
    description: 'Not found, or not visible to guests of this link (hidden cards included)',
    ...json(ApiError),
  },
};
const guestWriteErrors = { ...guestErrors, ...tooMany };
registry.register('GuestDenied', GuestDenied);
const guestBoardParams = z.object({ linkId: Id, boardId: Id });
const guestElementParams = guestBoardParams.extend({ elementId: ElementRef });
const guestCommentParams = z.object({ linkId: Id, commentId: Id });

registry.registerPath({
  method: 'get',
  path: v1('/guest/by-token/{token}'),
  tags: ['Guests'],
  security: [{}],
  summary: 'What a share link is for, shown before entering a name or password. Rate limited.',
  description:
    'Revoked, expired and suspended links answer 403 with GuestDenied only. While a password ' +
    'is needed, the board, the sender, the role and the expiry are left out.',
  request: { params: shareTokenParam },
  responses: {
    200: { description: 'Preview', ...json(ShareLinkPreview) },
    403: { description: 'Link expired, revoked or suspended (GuestDenied)', ...json(ApiError) },
    404: errors[404],
    ...tooMany,
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/guest/links/{linkId}/session'),
  tags: ['Guests'],
  security: [{}, ...guest],
  summary: 'Open the link as a guest: checks the token and password, sets the guest cookie.',
  description:
    'The token is in the body and the path is under the cookie path, so the browser sends ' +
    'back the cookie of an earlier visit: if it belongs to a guest of this link, even with an ' +
    'expired session, that guest is reused (comments and picks stay theirs) and the cookie ' +
    'token is replaced. Otherwise a new guest is created. A token of another link is a 404. ' +
    'Rate limited per link and address: wrong passwords, and new guests without a cookie. ' +
    'Like every guest write, a cross-site request is a 403 even without a cookie, so another ' +
    'site cannot open a session in the visitor’s browser.',
  request: { params: linkParams, body: json(CreateGuestSession) },
  responses: {
    200: { description: 'Guest session', ...json(GuestSession) },
    ...guestWriteErrors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/session'),
  tags: ['Guests'],
  security: guest,
  summary: 'The guest session and the boards it can open.',
  request: { params: linkParams },
  responses: { 200: { description: 'Guest session', ...json(GuestSession) }, ...guestErrors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/guest/links/{linkId}/session'),
  tags: ['Guests'],
  security: guest,
  summary: 'Set the name of the guest.',
  request: { params: linkParams, body: json(UpdateGuestSession) },
  responses: { 200: { description: 'Updated', ...json(GuestSession) }, ...guestWriteErrors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/guest/links/{linkId}/session'),
  tags: ['Guests'],
  security: guest,
  summary: 'Leave: ends the session and clears the guest cookie.',
  request: { params: linkParams },
  responses: { 204: { description: 'Left' }, ...guestErrors },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/boards/{boardId}'),
  tags: ['Guests'],
  security: guest,
  summary: 'Read-only snapshot of a board, filtered for guests.',
  description:
    'Rendered by the server from the stored document: cards hidden from guests and their ' +
    'children are left out, and so are arrows attached to them and board cards of boards ' +
    'outside the link. Reviews, comment counts, picks and files are filtered the same way. ' +
    'Files are listed only as guest URLs. Send `If-None-Match` with the last `version` to ' +
    'poll cheaply (304).',
  request: { params: guestBoardParams },
  responses: {
    200: { description: 'Snapshot', ...json(GuestBoardSnapshot) },
    304: { description: 'Not changed since If-None-Match' },
    ...guestErrors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/assets/{assetId}/variants/{size}'),
  tags: ['Guests'],
  security: guest,
  summary: 'A WebP thumbnail of a file shown on one of the boards of the link.',
  description:
    'Only for files referenced by an element visible to guests on a board of the link, or ' +
    'the cover of such a board; checked on every request. `?animated=1` asks for the moving ' +
    'copy of a GIF or animated WebP, when `GuestAsset.animated` says there is one.',
  request: {
    params: z.object({ linkId: Id, assetId: Id, size: ThumbnailSize }),
    query: VariantQuery,
  },
  responses: {
    200: { description: 'WebP image', content: { 'image/webp': { schema: z.string() } } },
    ...guestErrors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/assets/{assetId}/file'),
  tags: ['Guests'],
  security: guest,
  summary: 'The original file, only when the link allows downloads. Always an attachment.',
  description:
    'Only for files referenced by an element visible to guests on a board of the link (board ' +
    'covers are never served as originals); checked on every request.',
  request: { params: z.object({ linkId: Id, assetId: Id }) },
  responses: {
    200: { description: 'File' },
    206: { description: 'Part of the file' },
    ...guestErrors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/boards/{boardId}/comments'),
  tags: ['Guests'],
  security: guest,
  summary: 'Threads this guest can read. For guest_comment and guest_approve.',
  description:
    '`everyone` threads that are either for every link (written by the team) or for this ' +
    'link, about the board or a card visible to guests; replies written by guests of other ' +
    'links are left out. Same order and cursor as the team list.',
  request: { params: guestBoardParams, query: CommentQuery },
  responses: {
    200: { description: 'Threads', ...json(page(GuestCommentThread)) },
    ...guestErrors,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/guest/links/{linkId}/comments/{commentId}/replies'),
  tags: ['Guests'],
  security: guest,
  summary: 'Every reply of a thread this guest can read, oldest first.',
  request: { params: guestCommentParams, query: ReplyQuery },
  responses: { 200: { description: 'Replies', ...json(page(GuestComment)) }, ...guestErrors },
});
registry.registerPath({
  method: 'post',
  path: v1('/guest/links/{linkId}/boards/{boardId}/comments'),
  tags: ['Guests'],
  security: guest,
  summary: 'Comment as a guest. Needs a name; mentions are not available to guests.',
  description:
    'The thread is `everyone` and belongs to this link: guests of other links never see it. ' +
    'A card hidden from guests, or a reply to a thread this guest cannot read (a `team` ' +
    'thread, or one of another link), is a 404. Rate limited per guest and per link.',
  request: { params: guestBoardParams, body: json(GuestCreateComment) },
  responses: { 201: { description: 'Created', ...json(GuestComment) }, ...guestWriteErrors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/guest/links/{linkId}/comments/{commentId}'),
  tags: ['Guests'],
  security: guest,
  summary: 'Edit a comment this guest wrote, on a board the guest can still open.',
  request: { params: guestCommentParams, body: json(GuestUpdateComment) },
  responses: { 200: { description: 'Updated', ...json(GuestComment) }, ...guestWriteErrors },
});
registry.registerPath({
  method: 'delete',
  path: v1('/guest/links/{linkId}/comments/{commentId}'),
  tags: ['Guests'],
  security: guest,
  summary: 'Delete a comment this guest wrote, on a board the guest can still open.',
  request: { params: guestCommentParams },
  responses: { 204: { description: 'Deleted' }, ...guestWriteErrors },
});
registry.registerPath({
  method: 'put',
  path: v1('/guest/links/{linkId}/boards/{boardId}/elements/{elementId}/review'),
  tags: ['Guests'],
  security: guest,
  summary: 'Approve a card or ask for changes, or withdraw your decision. For guest_approve.',
  description:
    'Needs a name. Sets the decision of this link: guests of other links never see it, and ' +
    'it replaces the decision of any other guest of this link. `in_review` and unknown values ' +
    'are a 400. `none` withdraws a decision and is allowed only when the status this guest ' +
    'sees was set by them, otherwise 403. The answer is what the guest sees afterwards: after ' +
    'a withdrawal, the team’s status (or `none` by this guest when the team never set one). ' +
    'A card hidden from guests is a 404.',
  request: { params: guestElementParams, body: json(GuestSetElementReview) },
  responses: {
    200: { description: 'Set', ...json(GuestElementReview) },
    ...guestWriteErrors,
    403: {
      description:
        'As for every guest request, or `none` sent when the status this guest sees was not ' +
        'set by them',
      ...json(ApiError),
    },
  },
});
registry.registerPath({
  method: 'put',
  path: v1('/guest/links/{linkId}/boards/{boardId}/elements/{elementId}/pick'),
  tags: ['Guests'],
  security: guest,
  summary: 'Pick, reject or star a picture, when the link has proofing. Needs a name.',
  description:
    'Pictures are image cards and storyboard frames with a picture. Any other card is a 400; ' +
    'a card hidden from guests is a 404.',
  request: { params: guestElementParams, body: json(SetPick) },
  responses: { 200: { description: 'Saved', ...json(GuestPick) }, ...guestWriteErrors },
});

// Versions -------------------------------------------------------------------

const versionParams = z.object({ boardId: Id, versionId: Id });
const versionConflict = (what: string) => ({
  409: { description: `${what} (details: BoardVersionConflict)`, ...json(ApiError) },
});
registry.register('BoardVersionConflict', BoardVersionConflict);

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/versions'),
  tags: ['Versions'],
  security: secured,
  summary: 'Saved versions of a board, newest first. Needs editor.',
  request: { params: idParam('boardId'), query: BoardVersionQuery },
  responses: { 200: { description: 'Versions', ...json(page(BoardVersion)) }, ...errors },
});
registry.registerPath({
  method: 'post',
  path: v1('/boards/{boardId}/versions'),
  tags: ['Versions'],
  security: secured,
  summary: 'Save the current state of the board under a name. Needs editor.',
  description:
    'A board keeps at most 100 named versions (409 beyond; delete or let one go first), and ' +
    'each person can save 20 an hour. Open boards are told with the stateless collab ' +
    'message `{"type":"versions","versionId":"0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10"}`.',
  request: { params: idParam('boardId'), body: json(CreateBoardVersion) },
  responses: {
    201: { description: 'Saved', ...json(BoardVersion) },
    ...errors,
    ...versionConflict('The board keeps 100 named versions already (`named_versions_limit`)'),
    ...tooMany,
    ...outcome,
  },
});
registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/versions/{versionId}'),
  tags: ['Versions'],
  security: secured,
  summary: 'One version of a board, e.g. to name the one just restored. Needs editor.',
  request: { params: versionParams },
  responses: { 200: { description: 'Version', ...json(BoardVersion) }, ...errors },
});
registry.registerPath({
  method: 'patch',
  path: v1('/boards/{boardId}/versions/{versionId}'),
  tags: ['Versions'],
  security: secured,
  summary: 'Rename a version, or name an automatic one so it is kept. Needs editor.',
  description:
    'Open boards are told with the stateless collab message `{"type":"versions","versionId":"0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10"}`.',
  request: { params: versionParams, body: json(UpdateBoardVersion) },
  responses: {
    200: { description: 'Updated', ...json(BoardVersion) },
    ...errors,
    ...versionConflict(
      'Naming an automatic version while the board keeps 100 named ones (`named_versions_limit`)',
    ),
  },
});
registry.registerPath({
  method: 'delete',
  path: v1('/boards/{boardId}/versions/{versionId}'),
  tags: ['Versions'],
  security: secured,
  summary: 'Delete a version of any kind. Needs editor.',
  description:
    'Automatic and restore versions also go away by themselves with retention; deleting one ' +
    'only does it sooner. Open boards are told with the stateless collab message ' +
    '`{"type":"versions","versionId":"0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10"}`.',
  request: { params: versionParams },
  responses: { 204: { description: 'Deleted' }, ...errors },
});
registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/versions/{versionId}/state'),
  tags: ['Versions'],
  security: secured,
  summary: 'The version as a Yjs update, to preview it read-only in the editor. Needs editor.',
  description:
    'Migrated to the current document schema. Apply it to an empty Y.Doc; it never syncs with ' +
    'the live board.',
  request: { params: versionParams },
  responses: {
    200: {
      description: 'Yjs update',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...errors,
    ...versionConflict('Saved by a newer Inkadra (`newer_schema`)'),
  },
});
registry.registerPath({
  method: 'post',
  path: v1('/boards/{boardId}/versions/{versionId}/restore'),
  tags: ['Versions'],
  security: secured,
  summary: 'Bring the board back to a version, as a new change. Needs editor.',
  description:
    'The current state is saved first as a `restore` version. The content of the version is ' +
    'then written on top of the live document where it is live, as clips are (decision ' +
    '0014), so open boards follow without a reload ' +
    '(they also get the stateless collab message `{"type":"restored"}`). Comments, reviews ' +
    'and picks are not touched. Cards present both now and in the version keep their current ' +
    '`guestHidden`, so a restore never shows guests a card hidden since.',
  request: { params: versionParams },
  responses: {
    200: { description: 'Restored', ...json(RestoredBoardVersion) },
    ...errors,
    ...versionConflict('Saved by a newer Inkadra (`newer_schema`)'),
    ...tooMany,
    ...outcome,
  },
});

// Clip -----------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: v1('/clip'),
  tags: ['Clip'],
  security: secured,
  summary: 'Save an image, a link or a text to a board, from the clipper or the share sheet.',
  description:
    'JSON for links and texts, a form (`multipart/form-data`) for a file. The form has the ' +
    'fields of ClipRequest as text parts, `tags` repeated once per tag (`tags[]` is also ' +
    'read), and one `file` part. `boardId` must come before `file`: access is checked before ' +
    'the file is stored, and a file sent first, or a second file, is refused with 400. Empty ' +
    'fields count as missing. Each person can clip 30 times a minute. With an image or other file the ' +
    '`note` becomes the caption.',
  request: {
    body: {
      content: {
        'application/json': { schema: ClipRequest },
        'multipart/form-data': {
          schema: z.object({
            boardId: Id.openapi({ description: 'Before `file`.' }),
            columnId: z.string().optional(),
            url: z.url().optional(),
            text: z.string().optional(),
            sourceUrl: z.url().optional(),
            note: z.string().optional(),
            tags: z.array(z.string()).optional().openapi({
              description: 'One `tags` part per tag.',
            }),
            title: z.string().optional(),
            file: z.string().openapi({ format: 'binary' }),
          }),
          encoding: { tags: { style: 'form', explode: true } },
        },
      },
    },
  },
  responses: {
    201: { description: 'Card created', ...json(ClipResult) },
    ...errors,
    413: {
      description: 'File larger than the instance limit (Instance.limits)',
      ...json(ApiError),
    },
    ...tooMany,
    ...outcome,
  },
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
      { name: 'Search' },
      { name: 'Comments' },
      { name: 'Reviews' },
      { name: 'Notifications' },
      { name: 'Share links' },
      { name: 'Guests' },
      { name: 'Versions' },
      { name: 'Clip' },
      { name: 'Schedule' },
    ],
  });
}

registry.registerPath({
  method: 'get',
  path: v1('/projects/{projectId}/board-counts'),
  tags: ['Boards'],
  security: secured,
  summary: 'Element and frame counts of the project boards the caller can open.',
  request: { params: z.object({ projectId: Id }) },
  responses: { 200: { description: 'Board counts', ...json(BoardCounts) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: v1('/boards/{boardId}/preview'),
  tags: ['Boards'],
  security: secured,
  summary: 'Authorized compact preview of the last persisted board; excludes full document data.',
  request: { params: z.object({ boardId: Id }) },
  responses: { 200: { description: 'Board preview', ...json(BoardPreview) }, ...errors },
});
