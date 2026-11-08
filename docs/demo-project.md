# Last Train, the demo project

_Last Train_ is the short film behind every picture of Inkadra: the README and the tour
screenshots, the store listings, the demo and the website mockup. The film does not exist; this
page is its story bible, the one place its names, scenes, colours and dates are written down.
Anything that shows the project follows this page, and a change to the project starts here.

The project itself is built by [`e2e/scripts/sample-project.ts`](../e2e/scripts/sample-project.ts)
on an empty instance, with pictures drawn in
[`e2e/scripts/sample-stills.ts`](../e2e/scripts/sample-stills.ts): no third-party images or fonts.
The video, the voice note and the script are made by the seed too (the video with ffmpeg).

## The film

|            |                                                                     |
| ---------- | ------------------------------------------------------------------- |
| Title      | Last Train                                                          |
| Format     | Short fiction, about 14 minutes, 16:9, shot on digital at 24 fps    |
| Production | Lanterna Film (invented)                                            |
| Shoot      | Three days over four, from the day the project is built (see below) |
| Look       | Sodium orange against wet blue; long lenses, little camera movement |

**Logline.** A sound editor back in her home town for one night misses the last train out, and
waits for the morning in the station diner with the signalman who is about to close the line for
good.

**Synopsis.** Anna runs across the station forecourt in the rain and reaches platform 4 as the
doors of the last train close. She watches it go into the tunnel. Sandro, the guard, should lock
the gates; he lets her stay.

In Rosa's diner, the only light still on in the station, a big man in a railway jacket sits down
at the counter: Leo, the night signalman. "Missed it too?" Two coffees, a ticket for a train that
has gone, and six hours to fill. Leo tells her it is his last night: from tomorrow the line runs
itself.

At dawn Leo climbs to the signal box and pulls the lever for the first train of the day. The
home signal turns green over the field behind the station. Anna is on the train as it runs along
the sea.

## Characters

| Character | Age | Role in the story | Played by    | In scenes |
| --------- | --- | ----------------- | ------------ | --------- |
| Anna      | 29  | Lead              | Marta Neri   | 1, 2, 3   |
| Leo       | 52  | Supporting        | Paolo Verdi  | 2, 3      |
| Rosa      | 64  | Supporting        | Lucia Amato  | 2         |
| Sandro    | 41  | Small part        | Davide Russo | 1         |

- **Anna** ("Annie"). Sound editor, from a town at the end of the line. Tired, quick to laugh, a
  grey wool coat one size too big and a red scarf: the only warm colour she carries. Wants to get
  home before morning; fears that nobody is waiting there. From running away to staying until
  dawn.
- **Leo**. Night-shift signalman for thirty years, born two streets from the station. Big hands,
  slow voice, navy work jacket with the railway badge, cap pushed back. Tonight is his last
  shift. From closing the line to letting someone else go.
- **Rosa**. Owner of the station diner; keeps it open for the night staff and knows every order.
  Cream apron over a burgundy cardigan.
- **Sandro**. Station guard. Closes the gates after the last train, and lets Anna stay.

Relations: Anna and Leo, strangers at the counter; Leo and Rosa, thirty years of night coffee;
Sandro lets Anna stay. Actors are represented by Agenzia Lumen (invented,
`lumen@example.com`).

## Locations

| Location        | Setting | Where                         | Light                                         | Available                       | Scenes |
| --------------- | ------- | ----------------------------- | --------------------------------------------- | ------------------------------- | ------ |
| Central station | EXT     | Piazza della Stazione 1       | Sodium lamps on the canopy, blue hour at 6:40 | After the last train, 0:30–5:00 | 1      |
| Rosa's diner    | INT     | Station hall, under the clock | Three pendants and a neon cup; blue window    | Closed to the public 23:00–6:00 | 2      |
| Signal box      | INT     | End of platform 4             | One practical over the lever frame            | With a railway escort only      | 3      |
| Coast line      | EXT     | Sea wall at Capo Bianco       | Sunrise 6:58; the first train passes at 5:52  | Drone permit, day 3 morning     | 3      |

The town and the addresses are invented.

## Scenes and shots

| Scene | Heading                                 | Title           | Shots |
| ----- | --------------------------------------- | --------------- | ----- |
| 1     | EXT. CENTRAL STATION – NIGHT            | The last train  | 1A–1E |
| 2     | INT. ROSA'S DINER – NIGHT               | The diner       | 2A–2C |
| 3     | INT./EXT. SIGNAL BOX, COAST LINE – DAWN | The first train | 3A–3C |

| Shot | Picture     | Action                                              | Size   | Angle | Movement | Lens  | Status   | Cast            |
| ---- | ----------- | --------------------------------------------------- | ------ | ----- | -------- | ----- | -------- | --------------- |
| 1A   | `platform`  | Platform 4 at 1:52. The lamps hum; nobody is left.  | EWS    | Eye   | Static   | 24mm  | Shot     |                 |
| 1B   | `rain`      | Anna crosses the forecourt in the rain, running.    | Full   | Eye   | Handheld | 50mm  | Shot     | Anna            |
| 1C   | `train`     | The doors close in front of her.                    | Medium | Eye   | Static   | 35mm  | Ready    | Anna            |
| 1D   | `window`    | Over her shoulder: the carriages pull away.         | MCU    | OTS   | Static   | 85mm  | Ready    | Anna            |
| 1E   | `tunnel`    | The tail lights shrink into the tunnel.             | Wide   | Eye   | Static   | 135mm | To shoot |                 |
| 2A   | `diner`     | Two strangers, one counter. Rosa pours.             | Wide   | Eye   | Dolly    | 32mm  | Ready    | Anna, Leo, Rosa |
| 2B   | `cups`      | Two coffees and a ticket for a train that has gone. | Insert | High  | Static   | 100mm | To shoot |                 |
| 2C   | `dawn`      | Dawn through the glass. Leo puts his cap on.        | Wide   | Eye   | Static   | 35mm  | Draft    | Leo             |
| 3A   | `signalbox` | Leo pulls the lever for the first train.            | Medium | Low   | Static   | 35mm  | Draft    | Leo             |
| 3B   | `field`     | The home signal turns green over the field.         | Wide   | Eye   | Static   | 50mm  | Draft    |                 |
| 3C   | `sea`       | The first train runs along the sea.                 | EWS    | High  | Drone    | 24mm  | Draft    | Anna            |

The only line of dialogue on the boards, in 2A: _LEO: Missed it too? / ANNA: By about a minute. /
LEO: Then you have six hours._

## Palette

| Swatch    | Hex       | Where                                   |
| --------- | --------- | --------------------------------------- |
| Sodium    | `#E07A3F` | The lamps, the haze, the diner          |
| Wet night | `#1E3A4C` | Sky, rain, the window of the diner      |
| Lamp      | `#F2C76E` | Practicals and lit windows              |
| Scarf     | `#B4302A` | Anna's scarf, the stripe on the train   |
| Shadow    | `#0A0F14` | Silhouettes and the blacks of the grade |
| Dawn      | `#F3D3A8` | Scene 3 only: the sky and the sea       |

Scenes 1 and 2 never show daylight; the warm colours are the lamps, Rosa's diner and the scarf.
The grade lifts to dawn only in scene 3.

## Crew and shoot

| Role              | Name           | Account               | In the project       |
| ----------------- | -------------- | --------------------- | -------------------- |
| Director          | Giulia Bianchi | `giulia@example.com`  | Owner, administrator |
| Producer          | Chiara Fontana | `chiara@example.com`  | Owner                |
| Cinematographer   | Tommaso Riva   | `tommaso@example.com` | Editor               |
| First AD          | Marco Gallo    | `marco@example.com`   | Editor               |
| Sound             | Ivo Santoro    | `ivo@example.com`     | Editor               |
| Production design | Sara Leone     | `sara@example.com`    | Commenter            |
| Costume           | Nadia Greco    | `nadia@example.com`   | Viewer               |

Giulia Bianchi is also the account the screenshots are taken with. Every account has the
password `correct-horse-battery`; the others join through an invitation link to the project. All
names are invented.

The client is **Fondazione Cinema Costa** (invented), the film's co-funder. Its reviewer, Elena
Marino, has no account: she opens a share link of the project that lets guests approve.

The shoot is three days: two nights back to back, a rest day, then the dawn. The sample puts
day 1 on the day it is built, so Home always shows "shooting today"; day 3 is three days later.

| Day | Location               | Call  | Wrap  | Shoots                     |
| --- | ---------------------- | ----- | ----- | -------------------------- |
| 1   | Central station        | 18:30 | 04:00 | 1B, then 1A, 1C, 1D, 1E    |
| 2   | Rosa's diner           | 19:00 | 05:30 | 2A, 2B, 2C at 4:40         |
| 3   | Signal box, coast line | 03:30 | 09:00 | 3A, 3C (train at 5:52), 3B |

## The boards

| Board      | What is on it                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Last Train | The moodboard (root): the idea, the boards, a to-do list, the stills in groups, a link, Light, Palette |
| Storyboard | The scenes and shots above, what each scene needs, the shooting days, a saved version                  |
| Casting    | The four characters and the four locations, with arrows: who is what to whom and where they wait       |
| Set plan   | Rosa's diner from above: counter, stools, practicals, the sodium light, two cameras                    |
| Rushes     | Take 3 of 1A (video), a frame grabbed from it, Ivo's voice note of the hum, the teaser link            |
| Production | Crew and budget tables, maps of the station and of Capo Bianco, the shooting script (PDF)              |

The Production board is hidden from guests: contacts and money stay with the team.

Moodboard groups: _Night_ (platform, rain, window, tunnel, train and the link), _Rosa's diner_
(diner, cups), _Dawn_ (signal box, dawn, sea, field) and _Palette_. The dawn pictures in the Light
column are tagged `dawn`, the sea also `drone`.

Arrows on the casting board: Sandro _lets her stay_ (Anna); Anna and Leo, _strangers_; Leo and
Rosa, _old friends_; Anna _waits here_ (Central station); Rosa, _her diner_.

Budget: camera and lenses €2,400, six sodium lamps €660, rain and haze machines €850, the diner
for two nights €1,200, railway escort and drone permit €540, catering €1,350; total €7,000.

The teaser link points at `https://www.youtube.com/watch?v=LastTrain24`, an id that is not a
real video; its picture is the `tunnel` still.

## The team at work

- **Comments.** On the moodboard's first note Tommaso asks whether the sodium orange is too much
  in the grade; Giulia answers to keep it. On the board Chiara confirms the lamps and asks
  Giulia (a mention, so it reaches her inbox) to tick the diner. On 2A Sara pins a comment on the
  neon cup and asks Tommaso; he answers. On 1C Marco asks Ivo for the door chime; Ivo answers,
  Marco resolves the thread, Giulia reacts ✅. Chiara and Sara put ❤️ on the diner still.
- **To-dos.** Giulia has the diner (due today) and the lamps (tomorrow); Marco the rain test
  (today); Chiara got the night permit.
- **Review.** The team approved 1A and 1B and sent 1C, 1D and 2A to review. Elena approved 1C,
  asked for changes on 2A ("We would like to see Rosa's face when she pours.") and commented on it;
  1D waits for her.
- **Versions.** The storyboard has a version named _Locked for the shoot_.

## Lanterna Film's next project

_Salt Road_, a documentary in development: the last salt pans along the coast line, worked by
hand for one more summer. Its board holds the idea, a development to-do list, the `field` and
`dawn` stills and a palette (Dawn `#F3D3A8`, Salt `#E9E4D8`, Sea `#5E8CA6`). Chiara is its
other owner.

On Home, Giulia keeps two groups: _In production_ (Last Train, also pinned) and _In
development_ (Salt Road).

## Pictures

Each still is drawn as SVG at 1600 × 900 (portraits at 1200 × 1200) and named as in the shot
table. Besides the shots: `anna`, `leo`, `rosa` and `sandro` are the casting portraits, backlit
profiles in the light of each character's place. `map-station` and `map-coast` are the maps of
the Production board, flat street maps of the invented town at 1024 × 560, the size of the map
pictures the server makes; the cards carry no coordinates, so nothing is fetched from a map
server.
