# 0071 — Shot size, angle and movement as instance catalogs

The three storyboard lists were constants with translated names. Administrators can now change
them in Settings → Classifications, next to project types and tags.

- **Frames are not rewritten.** A frame field still holds an id or free text, and the board document
  schema does not change. The defaults keep their codes as ids; a new value gets a UUID, like a project type.
  Readers resolve the name at display time, so a rename or an archive reaches every frame.
- **No text binding.** Tags bind a value to its original text. Doing that here would capture a
  frame's free text when an administrator adds the same name, and a later rename would change it.
- **Values are archived, never removed.** An archived value leaves the menus but stays readable and
  selected on the frames that use it. Counting uses would mean reading every board document.
- **Translation.** A default stays translated while its stored label equals the default label;
  renaming it fixes one name for every language. Restore brings back archived defaults that were
  not renamed, and leaves everything else alone.
- **Guests** cannot read `/instance/classifications`. The guest session carries the three lists,
  without the tags. No guest screen shows these fields today.
- **Other instances.** A UUID means nothing elsewhere, so `classifications.json` in an archive lists
  the custom values used, and the import turns unknown ids into free text. Renamed defaults
  arrive under their code and read as the default on the other instance.
- **Search** indexes the stored value, as it did: a preset name is not searchable, typed text is.

Clients older than this change show the UUID of a new value as free text until they update.
