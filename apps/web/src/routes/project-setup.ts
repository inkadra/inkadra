import type { Project } from '@inkadra/shared';

/**
 * The guided setup's title, shared by the page and the header breadcrumb: only a user without
 * projects gets the welcome one, and none while the projects are loading.
 */
export const onboardingTitle = (projects: readonly Project[] | null | undefined) =>
  projects ? (projects.length === 0 ? 'onboarding.firstTitle' : 'onboarding.title') : null;
