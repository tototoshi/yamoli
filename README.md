# Yamoli

An outline editor. Write rows, nest them with indentation, and organize them by folding and zooming.

The interface is in English or Japanese, following the browser's language; switch it from the **⋯** menu.

## Getting started

Requires Node.js 22.12+ (or 20.19+).

```sh
npm install
npm run dev        # http://localhost:5173
```

On first launch the outline comes with a usage-guide slide deck and a sample project showing scheduling, written in the interface language. Both can be added again at any time from the **⋯** menu at the top right.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (saves to the data file) |
| `npm run build` | Type check and production build (`dist/`) |
| `npm run preview` | Serve the build, with the data file |
| `npm test` | Tests (Vitest) |

## Where data is saved

- Under `npm run dev` or `npm run preview`, the outline is saved to **`~/yamoli/data.json`**. Set `YAMOLI_DATA` to use another path.
- Before the first write of each day, the previous contents are kept in `backups/` (30 days).
- If the file changes in another tab or outside the app, you choose whether to reload it or overwrite it with yours.
- When `dist/` is served statically with no server, the outline is saved in the browser (localStorage).
- The ⋯ menu exports the outline:
  - **YAML**: for reading, or for handing to other tools.
  - **Backup (JSON)**: the full outline, which can be loaded back to restore it.

A `~/outliner/data.json` from the app's earlier name (Outliner) is moved to `~/yamoli/` on start.

## Writing

### Rows and fields

- **Enter** starts a new row, **Tab / Shift+Tab** indents and outdents. Click a ● to zoom into that item.
- Select several rows with **Shift+↑↓** at a row's ends, **Shift+click** or by dragging across them. Tab / Shift+Tab, Backspace, ⌘C / ⌘X and ⌘Enter then act on all of them, and dragging one's ● moves them together.
- Typing `name: ` at the start of a row makes it a **field**. Backspace at the start of the value turns it back into an ordinary row.
- A field without a value can hold nested rows: fields below it make an object, ordinary rows a list.
- A **block** (Alt+D) is a field with a multi-line value: Markdown, CSV, code or plain text. In YAML it is written as `note: !markdown |`.
- Pasted YAML comes in as fields, nesting and blocks.
- `[[` inserts a link to another item.
- While typing a field's name or value, the names and values already in use are offered below it: **↓** picks one, **Enter** takes it.
- **⌘P** (Ctrl+P outside macOS) jumps to an item by part of its name.
- Formatting (`**bold**`, `` `code` ``, `[text](https://…)`) is styled as you type, its markup dimmed. With the caret on a link, a bubble shows where it goes; **⌘K** adds or edits a link, and pasting a URL over selected text links it.
- The **Fields** setting in the view bar shows field rows, folds each row's fields into a one-line summary (click it to open them), or hides them.

The **?** at the top right lists the keyboard shortcuts.

### Seen as YAML

Once you use fields, editing the outline is close to editing YAML. The app reads the fields and changes what it does: with dates it draws a Gantt chart, with `layout` it shows slides.

```
Outline                           YAML view
・Project                         text: Project
  ・start: 2026-11-09             start: 2026-11-09
  ・Requirements                  children:
    ・duration: 3d                  - id: 1a2b3c4d5e6f
  ・Design                            text: Requirements
    ・duration: 2d                    duration: 3d
    ・after: Requirements           - text: Design
                                      duration: 2d
                                      after: "[[1a2b3c4d5e6f]]"
```

Because of `after`, Design is scheduled to start on the working day after Requirements ends.

### Fields with a meaning

**Scheduling** (also shown on the Gantt chart)

| Field | Example | Meaning |
| --- | --- | --- |
| `duration` | `3d` / `2w` / `10cd` / `0d` | Length in working days / weeks / calendar days. `0d` is a milestone |
| `start` | `2026-11-10` | Don't start before this date. Inherited by children |
| `after` | `[[Requirements]], [[API design]]` | Dependencies: starts once they have all finished. A parent's dependencies apply to its children. `^` is the item just above |
| `sequential` | `true` | On a parent: each child starts after the one above it, unless it has its own `after` |
| `due` | `2026-11-20` | Deadline; finishing later is shown as late |
| `completed` | `2026-11-09` | Set to the day an item is completed (⌘Enter); removed when it is reopened |
| `workdays` | `mon-fri` | Working days of the week (default `mon-fri`). Inherited by children |
| `holidays` | `jp`, `2026-12-29..2027-01-03` | Days off. `jp` adds Japanese public holidays |

An item with children spans the dates of its children. ★ marks the critical path (work whose delay delays the whole project).

**Slides**

| Field | On | Meaning |
| --- | --- | --- |
| `subtitle` | deck, slide | Subtitle |
| `theme` | deck | `dark` for a dark theme |
| `layout` | slide | `center` / `two-column` / `title` |
| `notes` | slide | Speaker notes (N to show) |
| `image` | slide | Image URL |
| `embed` | slide | Embed the Gantt chart of `[[item]]` |

The zoomed item is the deck, and each row under it is one slide. Rows under a slide are its bullets, and its blocks are its content. ← → page through, F goes full screen.

### Search

Search (⌘F) finds the rows matching all the terms you write.

| Term | Matches |
| --- | --- |
| `word` / `"two words"` | Text, field name or value contains it |
| `status:active` | Field `status` whose value contains `active` |
| `budget.amount:1200` | A nested field |
| `due:` | Has a field `due` |
| `is:done` | Completed rows |
| `is:ready` / `is:blocked` | Ready to start / waiting on a dependency |
| `is:late` / `is:critical` / `is:milestone` | Late / on the critical path / milestones |
| `is:cycle` | On a dependency cycle |
| `-term` | Negation |

`is:` terms also have Japanese names (`is:完了`, `is:着手可`, `is:待ち`, `is:遅延`, …). Matching ignores case and full-/half-width differences.

## Views

Switch with the view bar; each item remembers the view last used for it.

- **Outline**: where all editing happens.
- **Gantt**: the schedule as a chart, with dependency arrows, due-date lines and adjustable day width.
- **Slides**: see above.
- **Text**: the rows as a plain Markdown list, ready to paste elsewhere. Links show the linked item's name; the Completed and Fields toggles apply.
- **YAML / JSON**: the zoomed item as data (read-only, with a copy button). Items that something links to carry their `id`.

## Code layout

```
src/
  model.ts        Outline data (a flat table of nodes), fields and blocks
  controller.ts   Editing operations, keys, undo, view state
  App.tsx         The UI (Preact)
  storage.ts      Saving (file / localStorage), initial data
  fields.ts       Reading YAML-like text (paste)
  serialize.ts    Writing YAML / JSON / Markdown lists
  schedule.ts     Scheduling          calendar.ts  Working days, durations
  deps.ts         Dependencies        gantt.ts / GanttView.tsx
  slides.ts / SlidesView.tsx          search.ts    links.ts
  i18n.ts         The interface language: t('日本語', 'English')
  formats.ts      Showing blocks (Markdown, CSV, code, text)
server/
  dataFile.ts     /api/data (reading and writing the data file), used by a Vite plugin
```

Built with Vite 8, TypeScript and Preact. Markdown is rendered with marked and sanitized with DOMPurify before display.
