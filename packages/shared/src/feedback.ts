// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';

export const FEEDBACK_RETENTION_DAYS = 90;
export const FEEDBACK_FILE_BYTES = 25 * 1024 * 1024;
export const FEEDBACK_VIDEO_BYTES = 100 * 1024 * 1024;
export const FeedbackSettingsInput = z
  .object({
    destination: z.enum(['off', 'inbox', 'github']),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/)
      .nullable(),
    guests: z.boolean(),
  })
  .strict()
  .openapi('FeedbackSettingsInput');
export type FeedbackSettingsInput = z.infer<typeof FeedbackSettingsInput>;
export const FeedbackSettings = FeedbackSettingsInput.extend({
  tokenConfigured: z.boolean(),
  retentionDays: z.literal(90),
}).openapi('FeedbackSettings');
export type FeedbackSettings = z.infer<typeof FeedbackSettings>;
export const FeedbackStatus = z
  .object({ enabled: z.boolean(), guest: z.boolean() })
  .openapi('FeedbackStatus');
export const FeedbackAttachment = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['screenshot', 'video', 'file']),
    name: z.string().min(1).max(180),
    bytes: z.int().min(1).max(FEEDBACK_VIDEO_BYTES),
    mime: z.string().max(100),
  })
  .strict()
  .openapi('FeedbackAttachment');
export type FeedbackAttachment = z.infer<typeof FeedbackAttachment>;
export const FeedbackDiagnostics = z
  .object({
    environment: z.string().max(4000).optional(),
    page: z.string().max(1000).optional(),
    console: z.string().max(16000).optional(),
    network: z.string().max(8000).optional(),
    sync: z.string().max(1000).optional(),
    flags: z.string().max(1000).optional(),
  })
  .strict();
export const CreateFeedback = z
  .object({
    requestId: z.uuid(),
    type: z.enum(['bug', 'idea', 'question']),
    area: z.enum(['home', 'board', 'settings', 'guest', 'other']),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(12000),
    diagnostics: FeedbackDiagnostics,
    attachments: z.array(FeedbackAttachment).max(7),
  })
  .strict()
  .openapi('CreateFeedback');
export type CreateFeedback = z.infer<typeof CreateFeedback>;
export const FeedbackReceipt = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    issueUrl: z.url().nullable(),
    delivery: z.enum(['inbox', 'pending', 'delivered', 'uncertain']),
  })
  .openapi('FeedbackReceipt');
export type FeedbackReceipt = z.infer<typeof FeedbackReceipt>;
export const FeedbackReport = FeedbackReceipt.extend({
  report: CreateFeedback,
  reporter: z.string(),
  createdAt: z.iso.datetime(),
}).openapi('FeedbackReport');
export type FeedbackReport = z.infer<typeof FeedbackReport>;
