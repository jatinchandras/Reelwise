# ReelWise (Slate)

Production management Tool for the direction department, from first draft to call sheet.

Write the script, break it down scene by scene, cast it, schedule the shoot, and tell
the cast and crew when and where to turn up. "Slate" is a working name;.

## What it does

| Stage | What ReelWise does |
| --- | --- |
| **Script** | `web/editor/` is the Sluglines screenplay editor (scene headings, action, dialogue, autocomplete, title page, export). Save as `.sluglines`. |
| **Breakdown** | Parses scene headings (INT/EXT, location, time of day) and pulls out characters, props, vehicles, animals, effects, crowds and an estimated page-eighths length per scene. Rolls requirements up per location. |
| **Casting** | Maps characters to actors. Auto-cast uses the roles each actor lists; manual override per character. Flags uncast roles. |
| **Scheduling** | Auto-scheduler groups scenes by location, keeps day and night apart, caps page-eighths per day, skips non-shoot weekdays and blackout dates, avoids actor unavailability, and honours scene dependencies. Manual mode pins a scene to a date; pinned scenes survive rescheduling. Conflicts are reported, not hidden. |
| **Call sheets** | One call sheet per shoot day: scenes, cast, crew, location requirements. |
| **Notifications** | Per-person messages (new call, reminder, schedule change) through pluggable channels: file outbox (default), console, webhook. |

The dashboard shows the schedule as a **stripboard**: colour-coded strips (white = INT day,
yellow = EXT day, blue = INT night, green = EXT night) under black day bars, the way
film crews already read a schedule.

## Run it

Requires Node 18 or newer. No dependencies to install.

```bash
npm start          # http://localhost:3000  (dashboard)  and  /editor/  (script editor)
npm test           # unit tests for the core modules
npm run demo       # whole pipeline on the sample script, printed to the terminal
```

Typical flow: write in the editor, **Export > Save project file**, then **Import script file**
in the dashboard. Or click **Load sample script** to try it with `data/sample.sluglines`.

## Layout

```
src/core/parser.js         script -> scenes
src/core/breakdown.js      scenes -> characters, props, locations, requirements
src/core/casting.js        character <-> actor assignment
src/core/scheduler.js      auto and manual scheduling, conflict detection
src/core/callsheet.js      call sheet builder
src/core/notifications.js  messages and delivery channels
src/core/store.js          JSON file persistence (data/db.json)
src/server.js              REST API + static files
web/index.html             dashboard (stripboard)
web/editor/index.html      Sluglines script editor
```

## API

All JSON. Every write returns the full recalculated project.

```
GET    /api/project                     full state: script, breakdown, schedule, conflicts
PUT    /api/script                      body: a .sluglines document
GET    /api/sample                      the bundled sample script
POST   /api/actors   | DELETE /api/actors/:id
POST   /api/crew     | DELETE /api/crew/:id
POST   /api/casting/auto                assign actors from their listed roles
PUT    /api/casting                     { character, actorId | null }
POST   /api/schedule/move               { scene, date }   pin a scene (manual scheduling)
POST   /api/schedule/unpin              { scene }
PUT    /api/schedule/options            { startDate, maxEighthsPerDay, shootWeekdays, blackoutDates, ... }
GET    /api/callsheet/:date[?format=text]
POST   /api/notify                      { date, reason: scheduled|reminder|changed, channel: file|console }
```

## Connecting real email or SMS

A channel is `{ name, send({ to, subject, body }) }`. See `webhookChannel` in
`src/core/notifications.js`, then pass it to `notifyDay`. By default messages are written
to `data/outbox/` so nothing is sent by accident.

## Known limits (rough first version)

- **Breakdown is heuristic.** Props are ALL-CAPS words in action lines, which is the screenplay
  convention but will miss lowercase props and occasionally catch something that is not one.
  Treat it as a first pass to correct, not the final word.
- **The scheduler is greedy, not optimal.** It produces a valid schedule that respects the
  constraints above, but it can split a location across days when an actor is away, and it
  does not minimise the number of shoot days.
- **No accounts or permissions.** Anyone who can reach the server can change the schedule.
  Add authentication before exposing it beyond your machine.
- **JSON file storage** and a single project. Fine for one production; swap `store.js` for a
  database when you need more.
- The editor and dashboard are separate apps linked by the `.sluglines` file. Live sync
  between them is the obvious next step.

## Ideas for next steps

- Cast availability calendar and conflict-aware auto-casting by gender, age range and look
- Drag-and-drop stripboard reordering
- Budget, shot lists and per-scene notes
- Scheduled reminders ("shooting tomorrow") using `upcomingDays`
- Call sheet PDF export and weather for outdoor days

## License

MIT
