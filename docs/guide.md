# A tour of Inkadra

What the main tools do and where to find them. The pictures come from the sample project that
`pnpm --filter @inkadra/e2e screenshots` builds on an empty instance: every name and image in them
is invented.

## Tutorials

The first time you sign in, Inkadra offers a one-minute tour of the interface. Each feature has a
tour of three steps, offered by a small pill the first time you open it; skip it and it waits in
**Settings → Tutorial**, where you can replay any tour, see which ones are new, turn the pills off
or start over. Guests of a review link get two steps, and **?** in their header plays them again.

## The board

A board is an infinite canvas. The **dock** at the bottom always holds Select, Hand and Arrow, then
notes, pictures, links and to-do lists. **⋯** (More) lists the other tools (columns, section titles,
colours, tables, voice notes, maps, characters, places, frames and set plans), each with
**Put in the bar**; columns and section titles start there. **Canvas** at the end of the dock creates
boards: a board, a moodboard or a storyboard, each shown with a small preview, or one made from a
screenplay. **Settings → Toolbar** chooses the same. Panels never cover the dock: it moves over when
one opens. On a phone it shows the first few tools above the navigation bar, and the rest are under
**More**.

Select a card and a **toolbar** appears above it, with what that card can do: a note's text style,
lists, links and colours while you type, a section's size and colour, a link's info and preview, or
Draw on a picture. **Done**, `Esc` or a click elsewhere closes it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/toolbar-dark.png">
  <img src="screenshots/guide/toolbar-light.png" alt="A moodboard with a note being edited: the toolbar above the note offers text style, bold, italic, underline, strikethrough, link and colour, and the dock runs along the bottom of the window">
</picture>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/phone-dark.png">
    <img src="screenshots/guide/phone-light.png" alt="A board on a phone: a video playing in its card, the dock with the first few tools, and the navigation bar below it" width="280">
  </picture>
</p>

## Kinds of board and their views

A project starts with one board. **Add storyboard** and **Add moodboard** in the project's ⋯ menu,
and the cards of **Canvas** in the dock, add more, as many as you need. Each kind has its own views:

| Kind       | Always            | Can be turned on                     |
| ---------- | ----------------- | ------------------------------------ |
| Board      | the canvas        | Moodboard and Review                 |
| Moodboard  | the moodboard     | nothing                              |
| Storyboard | scenes and frames | Shot list, Schedule, Crew and Review |

The header shows the views of the open board only, and **Views of this board** in its ⋯ menu turns
them on and off: a view that is off leaves the header and the sidebar, and its data stays. In the
sidebar every board is a row with the icon of its kind, with its views under it when it has more
than one. A storyboard has no canvas: one made before it had other cards keeps them, and
**Cards outside the storyboard** in its ⋯ menu opens them.

A board placed on another board is a card that previews it: its name in a pill of its kind, a
count, and the view you look at, such as the first frames of a storyboard, the first rows of its
shot list, how far the client's review has got, or the pictures and colours of a moodboard. When the
board has more than one view, small tabs on the card switch between them; the card remembers your
choice on this device, and opening it opens that view. The card shows only what you could see by
opening the board. Cards made before the preview stay small: **Show preview** in the card's bar
makes one larger, and **Compact** puts it back to its name only. Guests of a share link and exports
show the board's name, as before.

## Modules

**Settings → Modules** turns off the parts of Inkadra you do not use, for you alone: Storyboard,
Production, Moodboard, Client review and Set plan. The board itself (notes, images, links, files,
to-dos, columns and comments) is always on. A module that is off leaves your menus, the dock, its
settings, notifications, tutorials and export options; nothing is deleted. What exists stays
visible and opens: a storyboard made by a colleague shows one line under its title, "Storyboard
module off: you can read this board", with **Turn on**. In **Canvas**, a kind of board of a module
that is off stays, dimmed, with **Turn on**. A screenplay dropped on a board while Storyboard is off
brings its scenes as cards, and once a short notice says what Storyboard would do with them.

## Videos in their card

An uploaded video plays inside its card: press play and it runs there, with its controls, without
opening anything. One plays at a time. Video links from YouTube and Vimeo play in their card as well.
With the [standard image](self-hosting/README.md#the-image), formats that browsers cannot play get a
playable copy, and a video gets a poster and its details.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/video-card-dark.png">
  <img src="screenshots/guide/video-card-light.png" alt="A video card on a board, paused halfway with its controls, with the name of the file, its size, codec and resolution below">
</picture>

## Storyboards, frames and Draw

A storyboard is made of scenes and frames, and its other views show the same data: the shot list,
the schedule and the review, when they are on. Double-click a frame to open its panel: action, shot size, angle, movement,
lens, cast and status. The panel follows your selection, and closes when you pick
something else.

Drag a picture from the board onto a frame and it becomes the frame's picture and leaves the board,
with an Undo. A card that holds strokes, a crop, a rotation or a caption stays, because a frame has
no place for those. A still from a video comes from the original file on the server when the
standard image is there, at full quality.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/frame-panel-dark.png">
  <img src="screenshots/guide/frame-panel-light.png" alt="A storyboard on the canvas, two scenes of frames, with the first frame selected and its panel open: picture, Draw, number, action, shot size, angle, movement and lens">
</picture>

**Draw** opens the frame full screen, with one floating bar: pens, eraser, shapes, text, colour and
size. The arrows `←` `→` go to the other frames. Ink starts red on a photo and dark on a blank
frame. Move around with space and drag, the wheel or two fingers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/draw-dark.png">
  <img src="screenshots/guide/draw-light.png" alt="Draw, full screen: a frame with a red arrow on it and a floating bar of drawing tools at the bottom">
</picture>

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="screenshots/readme/storyboard-dark.png">
        <img src="screenshots/readme/storyboard-light.png" alt="The Storyboard view: scenes with their frames, shot sizes and status">
      </picture>
      <p align="center"><sub>Storyboard</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="screenshots/readme/shotlist-dark.png">
        <img src="screenshots/readme/shotlist-light.png" alt="The Shot list view: the same frames as a table, with filters and CSV and PDF export">
      </picture>
      <p align="center"><sub>Shot list</sub></p>
    </td>
  </tr>
</table>

## Set plans

A set plan is a card with a drawing of the location. Double-click it to open the editor, which
takes the whole screen: the library on the left, the drawing in the middle with its tools at the
bottom, and a panel on the right with **Properties**, **Elements** and **Kit**. Nothing floats over
the drawing.

- **Starting**: an empty plan opens with a choice: reuse the walls, doors and furniture of
  another plan of the same location (lights, cameras and actors stay behind), draw the walls,
  trace an image, or a ready room (rectangle, L, U, a studio's three walls, an exterior) at the
  width and depth you type. **Start empty** closes it; the plan's menu offers it again while the
  plan is empty.
- **Walls** (`W`): click corner by corner; the side being drawn shows its length and angle, turns
  by 90°, 45° or freely, and takes a length typed on the keyboard with `Enter`. Click the first
  corner to close the room; `Esc` or **Done with walls** ends. Pick a wall to drag its corners,
  change its thickness (10, 15 or 20 cm) or delete it; its sides show their lengths.
- **Openings** (`D`): a door, double door, sliding door, window or plain opening goes where you
  click on a wall, with its width and its distance from the corners. Pick it to type its width,
  flip its side or swing, or drag it along its wall.
- **Background**: a floor plan or a photo of the survey under the drawing. Move and scale it, then
  it stays locked under everything; set its opacity, show it in greys, hide it or remove it from
  the **Background** button or the Set layer in **Elements**. It shows on the card too.
- **Library**: 163 types in six categories on the rail (lights; modifiers and grip; camera and
  movement; people; set and props; sound and video); arrows, texts and measures are in the
  toolbar and the search. Search finds names, the
  other names crews use and categories; `Enter` places the first result in the middle. Click a
  type and then the plan, or drag it there; hold `Shift` to keep placing. The star keeps a type
  among your favourites, next to the recent ones and the **project kit**: the lights and cameras
  already set up in the plans of every board of the project you can open, with their make,
  power, modifiers and stand. Offline it shows the kit of the open board only, and says so.
- **Snapping**: drop a person on a chair, sofa or bed, a modifier on the front of a light, a
  light or a camera on a stand or support, a dolly on a track: the target lights up and the icon
  attaches. Moving or turning the base takes what is on it along; pull an icon away to detach it.
  Hold `Alt` while dropping to place it free (on a phone, turn off **Snap** in the header).
- **Properties** shows what is selected: a light's role, fixture, watts, make, modifiers, gel,
  stand, colour temperature, intensity, beam, height, tilt and circuit; a camera's lens, sensor,
  support, height, angle, view length and positions; a person's pose, seat and movement; a prop's
  width and depth. With several items selected: align, layer, colour and group. **Bring forward**
  and **Send back** are in the selection's menu (right click, or `]` and `[`). **Lock** keeps
  the selected items where they are: a locked item can still be picked, to unlock it, but it is
  not moved, turned, resized, edited or deleted, and nothing new snaps onto it.
- **Elements** lists the plan by group (Lights, Camera, Actors, Grip and crew, Set, Notes),
  filtered by group or by the colours in use, with a lock on each locked item. Identical items
  share a row ("Table lamp ×3", a click selects them all), a stand or a dolly is listed with what
  it carries, and the Set is one line of counts that opens on a click. A layer's eye and lock hide and
  lock the layer; those of Grip and crew hide its flags, stands and crew for you and lock each
  of them. **Kit** counts the kit of the setup and its power per circuit at 120 or 230 V:
  a circuit turns orange above 80 % of its breaker and red above it. The sun, the moon, fire,
  candles, screens, neon, headlights and street lights are in the legend but not in the kit or the
  power. The circuits and the mains voltage belong to the first setup and serve every setup; the
  pencil on a circuit edits it. **Copy list** copies it; the call sheet prints the kit of the
  plans of its scenes.
- **Setups** are the tabs at the top; **+** copies the current one. Double-click a tab (or `F2`)
  to rename it, the first one too. The title of the plan is the same on every setup. Under the
  tabs a setup says what changed from the first one, which can be shown faintly behind it.
- **Scale** sets the metres from a line of known length; a number written on a measure is a
  label, and on a plan without a scale Inkadra offers to use that line as the scale.

On a phone the plan is on top, the selection in a sheet under it and the tools at the bottom; the
library, Elements and Kit open as sheets, and **Export** is in the setup menu. In the schedule,
**Group by: Setup** lists the shots of each scene and day under their setups. People who cannot edit a plan, guests first, can open it
to look and zoom.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/set-plan-dark.png">
  <img src="screenshots/guide/set-plan-light.png" alt="The set plan editor: the library of icons on the left, a room with a counter, lamps, actors and a camera in the middle with the tools along the bottom, and on the right the properties of the selected camera: name, lens, sensor, support, height, angle and view length">
</picture>

## Character sheets

A character card opens a panel of collapsible sections: identity, appearance with reference pictures,
story (what they want, what they fear, how they change), relations to other characters, costume and
makeup, scenes, and team-only notes. Scenes are worked out from the frames whose cast names the
character, and you can add others by hand. Guests see all of it except Contact and Notes. A location
card has the same kind of panel, with fewer fields.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/character-dark.png">
  <img src="screenshots/guide/character-light.png" alt="A casting board with two character cards and a location. The panel of the first character is open on its identity and appearance sections">
</picture>

## Comments

**Comments** at the top right opens one column with the whole conversation of the board. **Show on
board** puts bubbles next to the cards with open threads, and **Mentions and replies** narrows the
list to what concerns you.

Every comment has a visible audience: **Team** (people with a role on the board) or **Also guests**
(guests of a share link that can read comments). It goes back to Team after you send and on every
draft, so a comment reaches a guest only when you choose so each time.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/comments-dark.png">
  <img src="screenshots/guide/comments-light.png" alt="The comments panel: Show on board, the filters Open, Mentions and replies and Resolved, and two threads, one with a reply">
</picture>

## Classifications

Administrators set the instance's lists in **Settings → Classifications**: project types, tags, and
for storyboards shot size, angle and movement. They apply to every project. Rename a value and it
changes on every frame that uses it. Archive one and it leaves the menus but stays on the frames that
have it. **Other…** in a frame's menu still takes free text, and **Reactivate default values** brings
back the archived defaults of the three storyboard lists. A default keeps its translation until it is
renamed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/classifications-dark.png">
  <img src="screenshots/guide/classifications-light.png" alt="Settings, Classifications: one page of sections, with project types and tags under Projects, and shot size, angle and movement under Storyboard">
</picture>

## Reporting a problem

The icon next to the notifications, `Ctrl/⌘+Shift+B` or **Settings → About** opens the report: a bug,
an idea or a question, with a screenshot of the page that you can draw on or blur, a recording up to
60 seconds, or files. **Preview** shows exactly what leaves, and you choose what to keep.

The automatic screenshot leaves out the sidebar, the account, the breadcrumbs, your tasks, and project
and people names in activity. The rest of the page leaves as it is: cover it by hand if needed. A
shared tab or an image you choose leaves whole.

Where it goes is up to whoever runs the instance. Unless they chose otherwise, it goes to the Inkadra
developers: [What leaves your server](self-hosting/README.md#what-leaves-your-server) says what that
means and how to turn it off. The dialog also says where the report is going.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/guide/report-dialog-dark.png">
  <img src="screenshots/guide/report-dialog-light.png" alt="The report dialog: bug, idea or question, title, description, a screenshot with Draw and Blur, and a list of what is sent, each item with its checkbox">
</picture>
