import { sql } from 'drizzle-orm';
import { loadTestRun, user } from '../db/schema.ts';

/**
 * Rows of `user` that are not the account of a load test (#908): while it exists it stays out
 * of the members list (and its count), member pickers and member changes. Its own module, so
 * the routes do not load the generator.
 */
export const notTestAccount = sql`not exists (select 1 from ${loadTestRun} where ${loadTestRun.testUserId} = ${user.id})`;
