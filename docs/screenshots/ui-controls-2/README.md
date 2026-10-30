# Choice controls and tooltip review captures

Captured from the real app with installed Chrome by `e2e/tests/ui-controls.spec.ts`, which runs
after `first-run.spec.ts` and checks the roles it shows. Desktop is 1440 × 900, phone 390 × 844.

- `{desktop,phone}-{light,dark}-segmented.png`: the theme choice in Preferences, a `Segmented`.
- `{desktop,phone}-{light,dark}-switch.png`: the nightly backup `Switch` in a settings row.
- `{desktop,phone}-{light,dark}-export.png`: export dialog with `Segmented` and `Checkbox`
  (only where the board menu is reachable).
- `desktop-{light,dark}-tooltip.png`: the dark tooltip chip on the zoom controls after hover.
- `{desktop,phone}-{light,dark}-new-project.png`: New project dialog; project type pills and
  template cards are radios without a visible circle, selected with the selection ring; the role
  uses the shared `Select`.
