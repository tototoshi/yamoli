# Using Yamoli

Yamoli is an outline editor whose rows can carry fields, like YAML. Write rows, nest them with indentation, and organize them by folding and zooming; give them fields and the same outline becomes a Gantt chart, a diagram or a slide deck.

The interface is in English or Japanese, following the browser's language; switch it from the **⋯** menu. The **?** at the top right lists the keyboard shortcuts and opens this guide.

## Writing

### Rows

- **Enter** starts a new row (splitting the row at the caret), **⌘Enter** a new row below wherever the caret is (after the rows under it). **Tab / Shift+Tab** indents and outdents. Click a ● to zoom into that item; the breadcrumbs at the top zoom back out.
- Formatting (`**bold**`, `` `code` ``, `[text](https://…)`) is styled as you type, its markup dimmed. With the caret on a link, a bubble shows where it goes; **⌘K** (Ctrl+K outside macOS) adds or edits a link, and pasting a URL over selected text links it.
- `[[` inserts a link to another item. **⌘P** (Ctrl+P outside macOS) jumps to an item by part of its name.
- On macOS, **Ctrl+K** deletes to the end of the line and **Ctrl+Y** puts it back; at the end of a row, Ctrl+K (like Ctrl+D) joins the next row.

### Selecting, copying and pasting

- Select several rows with **Shift+↑↓** at a row's ends, **Shift+click** or by dragging across them. Tab / Shift+Tab, Backspace, ⌘C / ⌘X and ⌘Shift+Enter then act on all of them, and dragging one's ● moves them together.
- **Copy tree** in a row's menu (right-click its ●) copies the item with everything under it, folded and hidden rows too.
- Rows copied in Yamoli paste back as they were: fields, blocks, multi-line text, done or not. Elsewhere they paste as a Markdown list.
- Pasted text with several lines becomes rows. A Markdown list keeps its nesting (`- name: value` becoming a field of the row above); YAML comes in as fields, nesting and blocks; a checklist (`- [ ]` / `- [x]`) as tasks.

### Tasks

**Tasks** are rows that are something to do, rather than notes. A row's **Task** button (or **⌘L**) makes it one, after which the button completes it (✓, ⌘Shift+Enter) and reopens it (↺). Completed rows, and rows with `duration`, `end` or `due`, count as tasks too.

**Tasks only** in the view bar shows just them, with the rows they sit under dimmed; search with `is:task` / `is:todo`. The Text view writes tasks as `- [ ]` / `- [x]`.

### Fields and blocks

- Typing `name: ` at the start of a row makes it a **field**. Backspace at the start of the value turns it back into an ordinary row.
- A field without a value can hold nested rows: fields below it make an object, ordinary rows a list.
- A **block** (Alt+D) is a field with a multi-line value: Markdown, CSV, code or plain text. In YAML it is written as `note: !markdown |`.
- While typing a field's name or value, the names and values already in use are offered below it: **↓** picks one, **Enter** takes it.
- The **Fields** setting in the view bar shows field rows, folds each row's fields into a one-line summary (click it to open them), or hides them.

### Seen as YAML

Once you use fields, editing the outline is close to editing YAML. The app reads the fields and changes what it does: with dates it draws a Gantt chart, with `layout` it shows slides.

In the outline:

```
・Project
  ・start: 2026-11-09
  ・Requirements
    ・duration: 3d
  ・Design
    ・duration: 2d
    ・after: Requirements
```

In the YAML view:

```yaml
text: Project
start: 2026-11-09
children:
  - id: 1a2b3c4d5e6f
    text: Requirements
    duration: 3d
  - text: Design
    duration: 2d
    after: "[[1a2b3c4d5e6f]]"
```

Because of `after`, Design is scheduled to start on the working day after Requirements ends.

## Scheduling

These fields are read for the Gantt chart.

| Field | Example | Meaning |
| --- | --- | --- |
| `duration` | `3d` / `2w` / `10cd` / `0d` | Length in working days / weeks / calendar days. `0d` is a milestone |
| `start` | `2026-11-10` | Don't start before this date. Inherited by children |
| `end` | `2026-11-14` | Instead of `duration`: the last day, the bar running from `start` to here (calendar days, so weekends count). Dependencies that end later move it whole |
| `after` | `[[Requirements]], [[API design]]` | Dependencies: starts once they have all finished. A parent's dependencies apply to its children. `^` is the item just above |
| `sequential` | `true` | On a parent: each child starts after the one above it, unless it has its own `after` |
| `due` | `2026-11-20` | Deadline; finishing later is shown as late |
| `completed` | `2026-11-09` | Set to the day an item is completed (⌘Shift+Enter); removed when it is reopened |
| `workdays` | `mon-fri` | Working days of the week (default `mon-fri`). Inherited by children |
| `holidays` | `jp`, `2026-12-29..2027-01-03` | Days off. `jp` adds Japanese public holidays |

An item with children spans the dates of its children. ★ marks the critical path (work whose delay delays the whole project). The Gantt chart draws dependency arrows and due-date lines; − / + change the width of a day, down to years and months for a long project, and **Fit** picks the widest that shows the whole schedule. **Dates** shows each row's start, end and working days in columns beside its name. The buttons above the chart save it, names, dates and legend included, as an SVG or PNG file, or copy it as an image.

## Diagrams

The Diagram view draws the zoomed item from its rows, for example a system's architecture:

```
・Production
  ・User
    ・shape: actor
    ・to: [[Web]] HTTPS
  ・VPC
    ・shape: frame
    ・Private
      ・shape: frame
      ・Web
        ・to: [[API]] gRPC
      ・API
        ・to: [[DB]]
      ・DB
        ・shape: db
```

is drawn as:

```
      ┌ VPC ─────────────────────────┐
      │ ┌ Private ─────────────────┐ │
☺ ──▶ │ │ Web ─gRPC─▶ API ──▶ (DB) │ │
      │ └──────────────────────────┘ │
      └──────────────────────────────┘
```

| Written | Drawn as |
| --- | --- |
| A row | A box, listing the rows under it (`• …`) |
| `shape: frame` | A frame around the rows under it, drawn as boxes; `frame solid` / `frame none` for its border (dashed by default) |
| `[[link]]` in a field | An arrow, labelled with the words after the link (or the field's name, except `to`). `after` arrows run from the dependency |
| `shape` | `box` / `actor` / `db` / `queue` / `external` |
| `color` | `red` / `orange` / `yellow` / `green` / `blue` / `purple` / `gray` or `#hex` |
| `icon` | Before the name: `server`, `database`, `storage`, `cloud`, `globe`, `user`, `users`, `mobile`, `desktop`, `browser`, `code`, `function`, `queue`, `bolt`, `lock`, `key`, `shield`, `mail`, `bell`, `chart`, `gear`, `container`, `file`, `search`, `cpu`, or an emoji. On an actor it replaces the figure |
| `note` / `description` | Text under the name of a box or a frame, wrapped; a long one makes the box wider, then taller. A `note` block works too |
| Other fields | Small `key: value` lines in the box |
| `direction` (on the zoomed item) | `LR` (left to right, default) / `TB` (top to bottom) |
| `diagram` (on the zoomed item) | `flow`: boxes follow the arrows (default when there are arrows or frames); `tree`: a mind map |

A line's look comes from the field it is written in: `async:` is dashed, `both:` has arrows at both ends, `link:` has none, and any other (`to:`) is a plain arrow. A `lines` field on the zoomed item sets more, one field per name: `calls: dotted red`, `sync: both` (`solid` / `dashed` / `dotted`, `arrow` / `both` / `none`, a colour).

An arrow to or from a row listed in a box is drawn to the box; a mind map (`diagram: tree`) draws every row, frames or not. Lines that would cross a box go around it. Clicking a box edits its row. The buttons above the diagram save it as an SVG or PNG file, or copy it as an image to paste into documents.

## Slides

The zoomed item is the deck, and each row under it is one slide. Rows under a slide are its bullets, and its blocks are its content. ← → page through, F goes full screen, N shows the speaker notes.

| Field | On | Meaning |
| --- | --- | --- |
| `subtitle` | deck, slide | Subtitle |
| `theme` | deck | `dark` for a dark theme |
| `layout` | slide | `center` / `two-column` / `title` |
| `notes` | slide | Speaker notes |
| `image` | slide | Image URL |
| `embed` | slide | Embed the Gantt chart of `[[item]]` (`[[item]] diagram`: its diagram) |

## Search

Search (⌘F) finds the rows matching all the terms you write; Esc clears it.

| Term | Matches |
| --- | --- |
| `word` / `"two words"` | Text, field name or value contains it |
| `status:active` | Field `status` whose value contains `active` |
| `budget.amount:1200` | A nested field |
| `due:` | Has a field `due` |
| `is:done` | Completed rows |
| `is:task` / `is:todo` | Tasks / tasks not yet done |
| `is:ready` / `is:blocked` | Ready to start / waiting on a dependency |
| `is:late` / `is:critical` / `is:milestone` | Late / on the critical path / milestones |
| `is:cycle` | On a dependency cycle |
| `-term` | Negation |

`is:` terms also have Japanese names (`is:完了`, `is:タスク`, `is:未完了`, `is:着手可`, `is:待ち`, `is:遅延`, …). Matching ignores case and full-/half-width differences.

## Views

Switch with the view bar; each item remembers the view last used for it.

- **Outline**: where all editing happens.
- **Gantt**: the schedule as a chart (see Scheduling).
- **Diagram**: the rows drawn as boxes and arrows (see Diagrams).
- **Slides**: the rows as a slide deck (see Slides).
- **Text**: the rows as a plain Markdown list, ready to paste elsewhere. Links show the linked item's name, tasks are checklist items; the Tasks only, Completed and Fields toggles apply.
- **YAML / JSON**: the zoomed item as data, coloured, read-only, with a copy button. Items that something links to carry their `id`.

## Saving

The outline saves itself as you type (the top bar shows when it has). If it changes in another tab or outside the app, you choose whether to reload it or overwrite it with yours.

When saving to a file, the contents before each day's first save, and before any save that removes 10 or more rows at once, are kept in the `backups/` folder next to the data file (30 days of daily copies, and the last 20 copies from before removing rows, named with the time).

The **⋯** menu exports the outline as **YAML**, for reading or for other tools, or as a **backup (JSON)** that can be loaded back to restore it. It also adds the usage-guide slides and the samples (a scheduled project, a system architecture) again.
