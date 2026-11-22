import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

// The records whose numbers were given twice before this check; cited by number and slug
// (docs/decisions/README.md). Every other number belongs to one record only.
const SHARED = {
  '0025': ['0025-classification-catalogs.md', '0025-instance-administration.md'],
  '0054': ['0054-design-previews.md', '0054-todo-assignments.md'],
  '0069': ['0069-in-app-feedback.md', '0069-richer-character-sheet.md'],
  '0071': ['0071-simpler-set-plan.md', '0071-storyboard-catalogs.md'],
  '0077': ['0077-moodboard-groups.md', '0077-removed-assignees-are-corrected.md'],
  '0104': ['0104-hand-checked-strokes.md', '0104-set-plan-v2.md'],
  '0124': ['0124-home-inbox-projects.md', '0124-settings-redesign.md'],
};

test('a new decision takes a number no other decision has', () => {
  const byNumber = {};
  for (const name of readdirSync(new URL('../docs/decisions/', import.meta.url)).sort()) {
    if (!/^\d{4}-.+\.md$/.test(name)) continue;
    const number = name.slice(0, 4);
    byNumber[number] = [...(byNumber[number] ?? []), name];
  }
  const shared = Object.fromEntries(
    Object.entries(byNumber).filter(([, files]) => files.length > 1),
  );
  assert.deepEqual(shared, SHARED);
});
