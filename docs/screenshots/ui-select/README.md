# Select review captures

Captured from the real app with installed Chrome on the workstation. Regenerate with
`SELECT_SCREENSHOTS=1` while running `storyboard.spec.ts` and `pdf-export.spec.ts`
after `first-run.spec.ts` on a fresh e2e instance.

- `storyboard-scene-header.png`: quiet triggers in the scene header.
- `quiet-open-desktop-dark.png`: open quiet selector.
- `shot-list-cell.png`: dense shot list cells.
- `export-dialog.png`: default triggers inside a dialog.
- `default-open-desktop-dark.png`: desktop popover, dark.
- `default-open-desktop-light.png`: desktop popover, light.
- `phone-bottom-sheet.png`: 390 px phone, 44 px option rows.

The screenshot hooks are opt-in; normal e2e runs do not overwrite these files.
