# 0067 · Remove project and board templates

**Date:** 2026-11-02

**Context.** QA 0.8 found that the Shot list template created a storyboard board and opened
its default Storyboard view. The Moodboard template was also confusing next to the Moodboard
view. The maintainer chose to remove templates for now.

**Decision.** New projects use the former blank flow. New boards are empty, without template
choices on Home, in dialogs, in the Canvas menu, in the command palette or on empty boards.
Remove unused layouts and sample-content seeds. Screenplay import remains available from a
board or storyboard. The existing Add storyboard action creates an empty storyboard; its
header still offers Storyboard, Shot list, Schedule and Review.

**Consequences.** Existing boards and projects are unchanged. No API, database or board-document
schema changes. This supersedes the template behavior in decisions 0012, 0021, 0024 and 0033,
and the template-specific project setup in decision 0040.
