# Editor UI Conventions

The 3D editor (`editor.html`), the profile editor (`profile-editor.html`) and the detail editor (`detail-editor.html`) follow these conventions. Agreed in #136 (2026-11-11).

## Toolbar order

Every toolbar, and the viewer's, starts with an icon-only home link (`<a class="home-link">`, with a title and an `aria-label`) back to the applications page, `launch.html`. Then, left to right, with a separator between groups:

1. Project name.
2. File: New, Open (the detail editor gathers open, import, export and publish in one File menu), Save, Undo, Redo, and the unsaved marker (●).
3. The document being edited: its picker and the actions on it (Duplicate, Rename, Delete; New detail, Plan or Section).
4. Tools: Select first, then drawing tools, then snapping.
5. View: Fit, render or view modes, units, and Help (?) last.

Buttons carry words, with an icon where one exists. Undo, Redo and Help are icon-only (with a tooltip and an accessible name), as they are everywhere else. A separator that wraps to the start or end of a row is hidden (`viewer/src/ui/toolbar.js`).

## Icons

- Generic commands use [Lucide](https://lucide.dev) (ISC licence), pinned to an exact version in `viewer/package.json` because icon names change between majors. They are drawn inline from `viewer/src/ui/icons.js`: write `<i data-icon="save"></i>` in the HTML (the page calls `renderIcons()`), or `icon('trash')` in script. Icons take the button's text colour, so disabled and active states need no extra artwork. `src/ui/icons.test.js` fails if a page names an icon that is not registered.
- Building-specific icons stay our own drawings in `viewer/public/icons/` (sources in `docs/assets/`): the layer functions (structure, insulation, membrane, service, finish), the vertical and horizontal planes (3D and Plan), storey, the logo and the favicon. The arc mark tool is our own drawing kept in Lucide's form inside `icons.js`, so it takes the button colour like the rest.
- Every toolbar command has an icon, on all four editing pages (3D editor, profile editor, detail editor, detail review). The label sits in `<span class="lbl">`; script that changes a label changes that span, so the icon stays.
- Below 1600 px wide, secondary commands (class `short`: view toggles, Fit, Thin, Library, IFC, the render modes) show only their icon, with an `aria-label` and tooltip, so each toolbar fits one row at 1400 px. Primary commands (file, undo, the drawing tools, Snap) keep their words.
- The detail editor's Marks menu holds the mark tools (Line, Arc, Circle, Dim, Note) and, below a rule, Trim and Extend, which edit lines, arcs and circles; the menu keeps the toolbar to one row.
- Commands that need a point on the canvas (the base point for rotate and mirror, the two points of a move) pick it with the next click, snapped, and accept a typed point; Esc cancels. They live in the panel beside the typed fields, not on the toolbar.
- The launch page has no script, so its card icons are inline Lucide SVG markup.

| Role | Name | Lucide | Role | Name | Lucide |
|---|---|---|---|---|---|
| New | `new` | file-plus | Floor | `floor` | square-dashed |
| Open | `open` | folder-open | Grid | `grid` | grid-3x3 |
| Open archive | `open-archive` | package-open | Guide | `guide` | ruler |
| Save | `save` | save | Snap | `snap` | magnet |
| Undo, Redo | `undo`, `redo` | undo-2, redo-2 | Fit | `fit` | scan |
| Select | `select` | mouse-pointer-2 | Measure | `measure` | ruler-dimension-line |
| Edit path | `edit-path` | spline-pointer | Rectangle, Polygon | `rect`, `polygon` | square, pentagon |
| Wall | `wall` | brick-wall | Add, Delete | `add`, `delete` | plus, trash |
| Library | `library` | library | Help | `help` | circle-question-mark |
| Layers | `layers` | layers | Move up, down | `chevron-up`, `chevron-down` | chevron-up, chevron-down |
| Show panel | `panel-left`, `panel-right` | panel-left, panel-right | Example | `example` | book-open |
| File menu | `file` | file | Objects | `objects` | package |
| Import, Export | `import`, `export` | import, file-output | Download, Publish | `download`, `publish` | download, upload |
| Duplicate, Rename | `copy`, `rename` | copy, pencil-line | Original | `history` | history |
| Save image | `image` | image-down | Edit detail | `edit` | pencil-ruler |
| Plan / Section | `switch` | arrow-left-right | 2D beside 3D | `split` | columns-2 |
| Thin lines | `thin` | feather | Regions | `regions` | shapes |
| Clip | `clip` | crop | Edges | `edges` | frame |
| Solid | `solid` | cuboid | Line drawing | `drawing` | pen-line |
| Grid planes | `planes` | grid-2x2 | H, V guide | `h-guide`, `v-guide` | separator-horizontal, separator-vertical |
| Marks | `marks` | pen-tool | Line, Circle | `line`, `circle` | minus, circle |
| Arc | `arc` | (our own) | Dimension, Note | `dimension`, `note` | move-horizontal, message-square-text |
| 3D model | `model` | box | Save to folder | `save-folder` | folder-down |
| Trim | `trim` | scissors | Extend | `extend` | arrow-right-to-line |
| Home | `home` | house | | | |

## Controls

Every app page links `viewer/src/ui/ui.css` after `fonts/barlow.css`. It gives buttons, selects and inputs the page font (Barlow, not the system sans-serif) and gives a button the page has not styled the plain dark look, with a wider padding in dialogs. Its rules sit in `:where()`, so a page's own rules always win.

Barlow's space is narrow (0.20 em, against Arial's 0.28 em), so 'Grid spacing (mm' or 'Hardwood Timber (Sawn)' read as one word. `ui.css` therefore adds `word-spacing: 0.1em` to the body and makes controls inherit it; inline SVG (the 2D drawings) keeps the font's own spacing, so the screen matches the exported drawing. This is the one rule for spacing in labels, options and names: do not add spaces or spacing per page. Where script builds a name followed by a measurement (scene tree rows such as 'Ground Floor (0 mm)'), the measurement also goes in a dimmed span (`treeItemMeta` in `viewer/src/editor/treeMenu.js`), which sets it apart by colour as well as space.

Form controls in a panel use the dark look: `background: #333; color: #ddd; border: 1px solid #555; border-radius: 3px`, with `color-scheme: dark` so number spinners and option lists are dark too. No app shows a white browser control. `src/ui/pages.test.js` checks that each app links it and has the home link, that the launch page has a card for each app, and that every page in `viewer/` is a Vite input.

## Names

| Action | Label | Shortcut |
|---|---|---|
| Save | Save | Ctrl+S |
| Undo | Undo | Ctrl+Z |
| Redo | Redo | Ctrl+Shift+Z or Ctrl+Y |
| Help | ? | ? |

## Dialogs

Use `viewer/src/ui/dialog.js`, never `window.prompt`, `alert` or `confirm`:

- `askForm` and `ask` for input. Fields are checked as you type, and OK stays disabled until every field is valid.
- `confirmDialog` for a yes or no question. A destructive action names its verb (Remove, Delete, Discard) and uses `danger: true`.
- `notify` for a message that needs acknowledging.

## Feedback

- Information goes in the status bar.
- Errors also go in a banner that stays until dismissed (`showError` in `viewer/src/ui/notice.js`).
- A slow load shows a veil with a spinner over the pane (`showBusy`).
- Every editor warns before leaving with unsaved work.

## Accessibility

- Secondary text uses a solid colour (`#aaa` on the dark panels), not opacity, and is at least 12 px.
- Lists in the sidebar work from the keyboard (`viewer/src/ui/treeKeys.js`): arrows, Home and End, Enter, F2 to edit, Delete, and Shift+F10 for the menu.
