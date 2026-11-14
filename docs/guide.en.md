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
- A **block** (Alt+D) is a field with a multi-line value: Markdown, CSV, code, plain text, an image or a file. In YAML it is written as `note: !markdown |`.
- **Paste** or **drop images and files** on a row and its item gets a block for each: an image is shown (`image: !image files/….png`; lines after the first are its caption), and any other file (a PDF, say) becomes a link with its name and size (`file: !file`) that downloads it under its own name. Both are kept in the `files/` folder next to the data file, and Markdown can refer to them too: `![caption](files/….png)`, `[minutes](files/….pdf)`. This works when saving to a file (`npm run dev` / `preview`).
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

The Gantt chart is there for items with `views: gantt` (see Views). It reads these fields.

| Field | Example | Meaning |
| --- | --- | --- |
| `views` | `gantt` | Turns the Gantt chart on (see Views) |
| `duration` | `3d` / `2w` / `10cd` / `0d` | Length in working days / weeks / calendar days. `0d` is a milestone |
| `start` | `2026-11-10` | Don't start before this date. Inherited by children |
| `end` | `2026-11-14` | Instead of `duration`: the last day, the bar running from `start` to here (calendar days, so weekends count). Dependencies that end later move it whole |
| `after` | `[[Requirements]], [[API design]]` | Dependencies: starts once they have all finished. A parent's dependencies apply to its children |
| `due` | `2026-11-20` | Deadline; finishing later is shown as late |
| `completed` | `2026-11-09` | Set to the day an item is completed (⌘Shift+Enter); removed when it is reopened |
| `workdays` | `mon-fri` | Working days of the week (default `mon-fri`). Inherited by children |
| `holidays` | `jp`, `2026-12-29..2027-01-03` | Days off. `jp` adds Japanese public holidays |

An item with children spans the dates of its children. ★ marks the critical path (work whose delay delays the whole project). The Gantt chart draws dependency arrows and due-date lines; − / + change the width of a day, down to years and months for a long project, and **Fit** picks the widest that shows the whole schedule. **Dates** shows each row's start, end and working days in columns beside its name. The buttons above the chart save it, names, dates and legend included, as an SVG or PNG file, or copy it as an image.

The schedule can be edited on the chart too. Changes are written as fields, so they are the same as editing the outline.

- **Drag a bar** to move its start (it gets a `start`; an item given an `end` has that moved along). It can't go before what it depends on: it stops just after that finishes.
- **Drag a bar's right end** to move its end. This rewrites `duration` in working days (calendar days for an item like `10cd`; an item given an `end` gets a new `end`).
- **Click a name, start, end or days** to type in it. Dates can be just month/day, like `12/3` (this year). `0` days makes a milestone. Giving an unscheduled item a start or a number of days schedules it. Enter keeps the change, Esc drops it.
- **Add a dependency**: point at a bar and a small dot appears after it. Drag from the dot to the row that should start after it, and the dependency goes into that row's `after`. A dependency that would make a cycle, or one between an item and something inside it, isn't added.
- **Remove a dependency**: click an arrow to select it, then press Delete (or click the × on it). It comes out of the row's `after`.
- **›** beside a name zooms into that item.

Items whose dates come from their children (summary bars) can't be edited here. While dragging, Esc puts the bar back.

## Diagrams

For items with `views: diagram`, the Diagram view draws the zoomed item from its rows, for example a system's architecture:

```
・Production
  ・views: diagram
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
| `shape: container` | A box with boxes inside: like a frame, the rows under it are boxes, but it looks like a box |
| `[[link]]` in a field | An arrow, labelled with the words after the link (or the field's name, except `to`). `after` arrows run from the dependency |
| `shape` | `box` / `actor` / `db` / `queue` / `external` |
| `color` | `red` / `orange` / `yellow` / `green` / `blue` / `purple` / `gray` or `#hex` |
| `icon` | Before the name: `server`, `database`, `storage`, `cloud`, `globe`, `user`, `users`, `mobile`, `desktop`, `browser`, `code`, `function`, `queue`, `bolt`, `lock`, `key`, `shield`, `mail`, `bell`, `chart`, `gear`, `container`, `file`, `search`, `cpu`, or an emoji. On an actor it replaces the figure |
| `note` / `description` | Text under the name of a box or a frame, wrapped; a long one makes the box wider, then taller. A `note` block works too |
| Other fields | Small `key: value` lines in the box |
| `layout` (on a frame, or the zoomed item) | Lines up the boxes in it in outline order, whatever their arrows: `row` / `横` across, `column` / `縦` down, `grid` / `格子` in rows (`grid 3` for three columns; without a number, about as many columns as rows). Arrows between them are still drawn, but don't move them |
| `direction` (on the zoomed item) | `LR` (left to right, default) / `TB` (top to bottom) |
| `diagram` (on the zoomed item) | `flow`: boxes follow the arrows (default when there are arrows or frames); `tree`: a mind map |

A line's look comes from the field it is written in: `async:` is dashed, `both:` has arrows at both ends, `link:` has none, and any other (`to:`) is a plain arrow. A `lines` field on the zoomed item sets more, one field per name: `calls: dotted red`, `sync: both` (`solid` / `dashed` / `dotted`, `arrow` / `both` / `none`, a colour).

An arrow to or from a row listed in a box is drawn to the box; a mind map (`diagram: tree`) draws every row, frames or not. Lines that would cross a box go around it. The buttons above the diagram save it as an SVG or PNG file, or copy it as an image to paste into documents.

You can edit the diagram where it is drawn. Each edit changes the outline's rows and fields, so the diagram and the outline always match.

- **Names**: double-click a box (or select it and press Enter) to rename it.
- **Description**: "Edit the description" in the right-click menu (Shift+Enter for a new line). It is written to `note`, as a text block when it has several lines, or to the `description` (or other) field the box already has.
- **Shape and colour**: right-click a box and pick them from the menu (they become the `shape` and `color` fields). The same menu adds a box inside (a plain box becomes a container) or after the box, opens the row in the outline, or deletes it.
- **New boxes**: **+ Add a box** at the top left of the diagram.
- **Arrows**: hover over a box and drag from the dot that appears to another box (this adds `to: [[box]]`). Click an arrow and press × or Delete to remove it. Right-click an arrow to pick its kind of line (arrow, dashed, both ends, line only, or a name set in `lines`): the link moves to the field of that name, `to` / `async` / `both` / `link` or yours (`after` dependencies stay). Drag a dot at either end of a selected arrow to another box to join it there instead (moving the head changes where the link points; moving the tail moves the field holding the link to that box. `after` dependencies work the same, but not into a loop).
- **Moving**: drag a box onto another frame to move it inside. Dropped on the middle of a plain box, it goes inside and that box becomes a container (`shape: container`); dropped on its edge, it goes before it. A container left empty is a plain box again. In a frame with a `layout`, where you drop it sets its place in the order. Press Esc during a drag to cancel.
- Delete removes the selected box (⌘Z brings it back).

## Slides

For items with `views: slides`: the zoomed item is the deck, and each row under it is one slide. Rows under a slide are its bullets, and its blocks are its content. ← → page through, F goes full screen, N shows the speaker notes.

| Field | On | Meaning |
| --- | --- | --- |
| `subtitle` | deck, slide | Subtitle |
| `theme` | deck | `dark` for a dark theme |
| `layout` | slide | `center` / `two-column` / `title` |
| `notes` | slide | Speaker notes |
| `image` | slide | Image: a URL, or a pasted image's `files/….png` |
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

Outline, Text, YAML and JSON work for any item. Gantt, Diagram and Slides only make sense for rows written for them, so they are turned on per item: pick one from the **+** in the view bar and the item gets a `views` field, which turns it on for the item and every row under it. Writing `views: gantt, slides` yourself does the same (`gantt` / `diagram` / `slides`, or `ガント` / `図` / `スライド`).

- **Outline**: where every kind of editing can be done.
- **Gantt**: the schedule as a chart (see Scheduling). Turned on with `views: gantt`.
- **Diagram**: the rows drawn as boxes and arrows (see Diagrams). Turned on with `views: diagram`.
- **Slides**: the rows as a slide deck (see Slides). Turned on with `views: slides`.
- **Text**: the rows as a plain Markdown list, ready to paste elsewhere. Links show the linked item's name, tasks are checklist items; the Tasks only, Completed and Fields toggles apply.
- **YAML / JSON**: the zoomed item as data, coloured, read-only, with a copy button. Items that something links to carry their `id`.

## Saving

The outline saves itself as you type (the top bar shows when it has). If it changes in another tab or outside the app, you choose whether to reload it or overwrite it with yours.

When saving to a file, the contents before each day's first save, and before any save that removes 10 or more rows at once, are kept in the `backups/` folder next to the data file (30 days of daily copies, and the last 20 copies from before removing rows, named with the time). Pasted images and files are in the `files/` folder; once kept, one is never changed. The browser keeps a copy of each data file too: if the file goes missing, it is made again from that file's copy (or the sample, without one; never from another data file).

The **⋯** menu exports the outline as **YAML**, for reading or for other tools, or as a **backup (JSON)** that can be loaded back to restore it (without the images and files). When saving to a file it also exports a **backup (ZIP)** of the outline with the images and files it uses; **Restore from a backup** takes either (a ZIP's images and files go back into `files/`).

**Clean up unused files** deletes images and files that neither the outline nor any backup in `backups/` uses, added over a week ago. It says how many and how large before it does. It also adds the usage-guide slides and the samples (a scheduled project, a system architecture) again.
