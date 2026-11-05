# 0073 — More languages, English fallback, catalogues on demand

Inkadra spoke Italian and English, and anyone else got Italian. It now also speaks Spanish, German,
French and Brazilian Portuguese, the first languages chosen to reach people outside Italy. The code
stays `pt`, with no regional variants, since each app takes only the first two letters of a language
tag.

- **English is the fallback**, for missing texts and for browsers in another language. It is the
  language a stranger to Italian is most likely to read. Italian stays the reference language the
  catalogues are compared with.
- **Catalogues load on demand.** `en.json` stays in the main bundle, so there is always something
  to show; each other language is a chunk loaded through a small i18next backend, with no new
  dependency. The app renders after the first language is ready, so nobody sees English flash by.
  A failed or stalled download (10 seconds) is treated as a failed load, and the app carries on in
  English until the next page load.
- **Offline.** The service worker precaches every script of the build, so all the language chunks
  are downloaded when the worker installs. Worker users lose some of the saving, and gain a language
  switch that works offline; the first paint of everyone else still carries one language less.
- **Settings search** looks in the languages already loaded (the interface one and English), not in
  all of them, since that would mean downloading every catalogue for one search.
- **Plurals.** Spanish, French, Portuguese and Italian have a CLDR `many` form (1 000 000) that
  i18next would look for and not find, falling back to English. The backend fills `_many` from
  `_other` when a catalogue does not write its own, so translators need only `_one` and `_other`.
- **Release notes** stay written in Italian and English (`<version>.<lang>.md`): the release email
  of another language has translated surroundings and English highlights.
- **Accounts with no language.** Nothing sets `user.locale` at sign-up, so an account that never
  opened the language setting has none, and its emails are in English like any unknown language.
  The web app saves the language in use the next time such an account opens it, so people who come
  back get emails in their own language. Until then, and for those who never come back, existing
  Italian accounts that used to get Italian emails get English ones.
