# Yamoli

An outline editor. Write rows, nest them with indentation, and organize them by folding and zooming.

The interface is in English or Japanese, following the browser's language; switch it from the **⋯** menu.

## Getting started

Requires Node.js 22.12+ (or 20.19+).

```sh
npm install
npm run dev        # http://localhost:5173
```

On first launch the outline comes with a usage-guide slide deck, a sample project showing scheduling and a sample system architecture for the Diagram view, written in the interface language. Both can be added again at any time from the **⋯** menu at the top right.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (saves to the data file) |
| `npm run build` | Type check and production build (`dist/`) |
| `npm run preview` | Serve the build, with the data file |
| `npm test` | Tests (Vitest) |
| `npm run format` | Format the code (Prettier); `format:check` only checks |

## Where data is saved

- Under `npm run dev` or `npm run preview`, the outline is saved to **`~/yamoli/data.json`**. Set `YAMOLI_DATA` to use another path.
- Before the first write of each day, the previous contents are kept in `backups/` (30 days). So are the contents before any write that removes 10 or more rows at once (the last 20 such copies, named with the time).
- Images and files pasted or dropped into rows are kept in `files/` next to it, named by their contents (up to 50 MB each), and never changed once kept. Images (PNG, JPEG, GIF, WebP, told by their bytes) are shown; anything else is only ever downloaded. **Clean up unused files** in the ⋯ menu removes those that neither the outline nor any backup uses, after a week.
- If the file changes in another tab or outside the app, you choose whether to reload it or overwrite it with yours.
- Only the computer running the server can read or write the file. With `--host` (to open the app from a phone, say) other devices save in their own browser instead; set `YAMOLI_ALLOW_REMOTE=1` to let them use the file too, on a network you trust, since anyone who can reach the server can then read and overwrite the outline.
- When `dist/` is served statically with no server, the outline is saved in the browser (localStorage).
- The ⋯ menu exports the outline:
  - **YAML**: for reading, or for handing to other tools.
  - **Backup (JSON)**: the full outline, which can be loaded back to restore it.
  - **Backup (ZIP)**: the outline file with the images and files it uses (when saving to a file); loading it puts them back.

A `~/outliner/data.json` from the app's earlier name (Outliner) is moved to `~/yamoli/` on start.

## Using it

The usage guide is in [docs/guide.en.md](docs/guide.en.md) (日本語: [docs/guide.ja.md](docs/guide.ja.md)), and in the app from the **?** menu at the top right (`#/docs`), in the interface language. It covers rows, fields and blocks, tasks, copying and pasting, scheduling and the Gantt chart, diagrams, slides, search and the views.

## Code layout

```
src/
  model.ts        Outline data (a flat table of nodes), fields and blocks
  viewState.ts    What is edited and shown: zoom, view, undo, search, rows on screen, rendering
  editing.ts      Editing operations (extends ViewState): typing, fields, link picker, tasks, menus
  controller.ts   The Controller the UI uses (extends Editing): keys, copying and pasting rows
  focus.ts / keys.ts  Focus by key (fText …), shortcut helpers (IS_MAC, arrowOf)
  App.tsx         The UI (Preact): the outline and its rows
  TopBar.tsx      The top bar, its menus and the view bar
  Popups.tsx      Link picker, completions, ⌘P jump, item menu, toasts
  Badges.tsx      Dependency and schedule marks beside rows
  storage.ts      Saving (file / localStorage), initial data
  fields.ts       Reading YAML-like text (paste)
  serialize.ts    Writing YAML / JSON / Markdown lists
  schedule.ts     Scheduling          calendar.ts  Working days, durations
  deps.ts         Dependencies        gantt.ts / GanttView.tsx
  ganttEdit.ts    Editing the schedule from the Gantt chart (drags and typed dates → fields)
  slides.ts / SlidesView.tsx          search.ts    links.ts
  diagram.ts / DiagramView.tsx        Diagrams
  i18n.ts         The interface language: t('日本語', 'English')
  formats.ts      Showing blocks (Markdown, CSV, code, text, images, files)
  files.ts        Adding images and files (upload) and their URLs
  views.ts        Which views an item can be shown in (`views` field)
  DocsView.tsx    The usage guide (docs/guide.*.md) at #/docs
server/
  dataFile.ts     /api/data (reading and writing the data file), used by a Vite plugin
  files.ts        /api/files (images and files kept next to it), /api/backup.zip
  zip.ts          Writing and reading ZIP archives
```

Built with Vite 8, TypeScript and Preact. Markdown is rendered with marked and sanitized with DOMPurify before display.
