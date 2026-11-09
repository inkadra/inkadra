# The demo projects

_Last Train_ is the short film behind every picture of Inkadra: the README and the tour
screenshots, the store listings, the demo and the website mockup. _Low Tide_, a photo shoot, sits
next to it in the demo and on the website's page for photographers ([below](#low-tide-the-photo-shoot)).
Neither exists; this page is their story bible, the one place their names, scenes, colours and
dates are written down. Anything that shows a project follows this page, and a change to a
project starts here.

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

## Low Tide, the photo shoot

_Low Tide_ is the second project of the demo and the sample of the website's page for
photographers. It is built by [`e2e/scripts/low-tide.ts`](../e2e/scripts/low-tide.ts) on the
instance of Last Train, with its pictures drawn in the same file as Last Train's. The website
shows the moodboard before the shoot; the project is two days after it, with the selects at the
client.

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| Title    | Low Tide                                                            |
| Format   | Editorial photo shoot, three looks on the coast in one morning      |
| Client   | Studio Maree (invented), a label of coats and knitwear              |
| Shoot    | One day, two days before the project is built (see below)           |
| Look     | Cold light, wet sand, one red coat; overcast, then fog from the sea |
| Delivery | Retouched picks only, chosen by the client through photo proofing   |

**The brief.** Editorial for Studio Maree. Three looks on the coast in one day: the sea wall, dawn,
the dunes. Cold light, wet sand, one red coat.

### People

| Who         | Does                      | Account            | In the project |
| ----------- | ------------------------- | ------------------ | -------------- |
| Lia Moretti | Photographer              | `lia@example.com`  | Owner          |
| Nora Conti  | Stylist, hair and make-up | `nora@example.com` | Editor         |
| Mara        | Model, all three looks    | none               | In the frames  |
| Ivo         | Model, looks 2 and 3      | none               | In the frames  |
| Irene Galli | Studio Maree, the client  | none, a share link | Guest          |

The project is opened by Giulia Bianchi, the first account of the instance, who invites Lia and
Nora (registration is by invitation); nothing in it is hers. The models have no account: they are
the cast of the frames, by first name. All names are invented; Ivo the model is not Ivo Santoro of
Last Train.

### The looks and the shot list

| Look | Title    | Where                  | Light                     | Outfit                                  | Set-ups |
| ---- | -------- | ---------------------- | ------------------------- | --------------------------------------- | ------- |
| 1    | Sea wall | Sea wall, Punta Grigia | Overcast morning          | Mara: the red coat (the only sample)    | 1A–1E   |
| 2    | Dawn     | The beach at low water | First sun on the wet sand | Mara: cream knit; Ivo: slate shirt      | 2A–2D   |
| 3    | Dunes    | The dunes behind it    | Grey, the fog coming in   | Mara: pale linen dress; Ivo: same shirt | 3A–3E   |

Punta Grigia and its beach are invented.

| Set-up | Picture   | What                                       | Size   | Lens  | Models    |
| ------ | --------- | ------------------------------------------ | ------ | ----- | --------- |
| 1A     | `LT_0405` | Mara walks the wall into the wind.         | Full   | 35mm  | Mara      |
| 1B     | `LT_0412` | Turned to the sea, the coat open.          | Medium | 50mm  | Mara      |
| 1C     | `LT_0518` | Profile, hair blown back, the red scarf.   | MCU    | 85mm  | Mara      |
| 1D     | `LT_0421` | Small on the wall, all sky.                | Wide   | 24mm  | Mara      |
| 1E     | `LT_0511` | Closer: the scarf, the wind in her hair.   | CU     | 100mm | Mara      |
| 2A     | `LT_0431` | Two figures on the wet sand.               | EWS    | 24mm  | Mara, Ivo |
| 2B     | `LT_0436` | Ivo at the edge of the water.              | Wide   | 35mm  | Ivo       |
| 2C     | `LT_0497` | Mara among the rock pools.                 | Medium | 50mm  | Mara      |
| 2D     | `LT_0427` | Mara walks out along the low-water line.   | Full   | 50mm  | Mara      |
| 3A     | `LT_0457` | Through the tall grass, the pale dress.    | Full   | 50mm  | Mara, Ivo |
| 3B     | `LT_0451` | Mara in the grass, the wind in it.         | Medium | 85mm  | Mara      |
| 3C     | `LT_0526` | The old pier posts in the fog.             | Wide   | 35mm  |           |
| 3D     | `LT_0468` | Mara turns back to the sea.                | Full   | 50mm  | Mara      |
| 3E     | `LT_0472` | The fog over the dunes, two figures in it. | EWS    | 24mm  | Mara, Ivo |

Every set-up is shot. Each look has its wardrobe list, and look 2 the beach kit (reflector,
wellies, towels): all ticked.

### The day

Call 06:00 at Punta Grigia, wrap 12:30. The van and the reflector; hair and make-up for Mara at
6:30; look 1 on the sea wall at 7:15; look 2 on the wet sand at low water (7:42); coffee and a
change; the walk to the dunes and look 3; pick-ups at the shore when the fog comes in.

Sunrise is at 7:05. The pictures are numbered in the order they were shot, so the pick-ups of
the rock pools, the portrait and the pier come after the dunes. The shoot is two days before the
day the project is built, and stays two days in the past in the demo.

### Palette

| Swatch    | Hex       |
| --------- | --------- |
| Sea glass | `#8FA9A3` |
| Wet sand  | `#B49A7A` |
| Red coat  | `#6E2A2A` |
| Fog       | `#D9DCD6` |
| Slate sea | `#3E4E5E` |

### The boards

| Board     | What is on it                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| Low Tide  | The moodboard (root): the brief, the boards, two lists, look 1, the tides link, Looks, Palette |
| Shot list | The looks and their 14 set-ups, what each look needs, the day of the shoot, a version          |
| Selects   | Lia's note and the 24 pictures, six to a row, shared with Studio Maree with photo proofing on  |

The moodboard groups its pictures by look: _Look 1 · Sea wall_ (`LT_0412`, `LT_0518`), _Look 2 ·
Dawn_ (`LT_0503`, `LT_0431`), _Look 3 · Dunes_ (`LT_0457`, `LT_0526`), and the _Palette_. In the
Looks column the pictures are tagged `dawn`, `dunes` and `fog`. The tides link points at
`https://example.com/tides`. The lists: _Before the shoot_ (beach permit, Mara's call at 6:30, the
tide times, hair and make-up in the van, spare batteries and towels: all done) and _After the
shoot_ (proofing link sent; retouch the picks and deliver the finals, Lia's; return the coat,
Nora's).

### The team and the client

- **Comments.** On the brief Nora writes that the coat is Studio Maree's only sample: no salt water
  on it. Lia answers that look 1 stays on the wall. Nora puts ❤️ on the sea wall picture.
- **Versions.** The shot list has a version named _Sent to Studio Maree_.
- **Proofing.** The Selects board is shared with Studio Maree: comments, photo proofing, a
  password, 14 days, downloads off. Irene Galli has picked 9 pictures, rejected 4 and starred 20,
  4.1 stars on average; 11 have no choice yet. On `LT_0412` she wrote: "This is the cover. Can the
  retouch keep the coat exactly this red?"

| Picture | Choice | Stars |     | Picture | Choice | Stars |     | Picture | Choice | Stars |
| ------- | ------ | ----- | --- | ------- | ------ | ----- | --- | ------- | ------ | ----- |
| LT_0405 |        | 5     |     | LT_0446 | Pick   | 4     |     | LT_0507 |        | 4     |
| LT_0409 | Pick   | 5     |     | LT_0451 | Pick   | 5     |     | LT_0511 | Pick   | 5     |
| LT_0412 | Pick   | 5     |     | LT_0457 | Reject | 2     |     | LT_0515 |        | 5     |
| LT_0418 |        | 4     |     | LT_0462 | Reject |       |     | LT_0518 | Pick   | 4     |
| LT_0421 | Reject |       |     | LT_0468 |        | 5     |     | LT_0522 |        | 4     |
| LT_0427 | Pick   | 5     |     | LT_0472 |        | 4     |     | LT_0526 | Reject | 1     |
| LT_0431 | Pick   | 4     |     | LT_0497 | Pick   | 4     |     | LT_0530 |        |       |
| LT_0436 |        |       |     | LT_0503 |        | 3     |     |         |        |       |
| LT_0440 |        | 4     |     |         |        |       |     |         |        |       |

Share links and picks stay on the instance that made them: a project archive does not carry them
(decision 0037). In the demo the Selects board has the pictures, Lia's note and Irene's comment,
under her name, but not the proofing.

### Pictures

The 24 pictures are drawn at 1600 × 900 like Last Train's and named as the photographer's files.
Six are the pictures of the website, with the same numbers: `LT_0412` the sea wall, `LT_0431`
dawn, `LT_0457` the dunes, `LT_0503` the rock pools, `LT_0518` the portrait and `LT_0526` the
pier; the others are frames around them from the same set-ups. No trains or signal boxes: those
are Last Train's.
