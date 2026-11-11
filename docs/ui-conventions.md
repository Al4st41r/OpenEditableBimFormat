# Editor UI Conventions

The 3D editor (`editor.html`), the profile editor (`profile-editor.html`) and the detail editor (`detail-editor.html`) follow these conventions. Agreed in #136 (2026-11-11).

## Toolbar order

Left to right, with a separator between groups:

1. Project name.
2. File: New, Open (the detail editor gathers open, import, export and publish in one File menu), Save, Undo, Redo, and the unsaved marker (●).
3. The document being edited: its picker and the actions on it (Duplicate, Rename, Delete; New detail, Plan or Section).
4. Tools: Select first, then drawing tools, then snapping.
5. View: Fit, render or view modes, units, and Help (?) last.

Buttons carry words, with an icon where one exists. A separator that wraps to the start or end of a row is hidden (`viewer/src/ui/toolbar.js`).

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
