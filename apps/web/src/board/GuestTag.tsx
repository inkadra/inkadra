// SPDX-License-Identifier: AGPL-3.0-only
import type { Author } from '@inkadra/shared';
import { useTranslation } from 'react-i18next';
import { guestTag } from './review-model.ts';

/** Tag beside a guest author, naming their share link when the server sends its label. */
export function GuestTag({ author }: { author: Author }) {
  const { t } = useTranslation();
  const text = guestTag(author, t);
  if (!text) return null;
  return (
    <span className="review-tag review-tag--truncate" title={text}>
      {text}
    </span>
  );
}
