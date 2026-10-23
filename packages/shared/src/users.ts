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
