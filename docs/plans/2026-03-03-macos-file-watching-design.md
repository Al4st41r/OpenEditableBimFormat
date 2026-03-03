# macOS Wrapper — File Watching Design

**Date:** 2026-03-03
**Status:** Approved
**Relates to:** GitHub issue #15 (macOS file watching)

---

## Problem

The primary live-editing use case is an LLM (or any text editor) modifying OEBF JSON files on disk while the macOS wrapper reflects changes in real time. The wrapper must detect file changes, identify which entity changed, and reload only that entity's geometry — not the entire model.

---

## Requirements

1. Watch all JSON files in the open `.oebf` bundle directory.
2. On file change, identify the changed entity type and ID from the file path.
3. Reload only the changed entity and re-render affected geometry.
4. Do not reload the entire model except when `model.json`, `manifest.json`, or `materials/library.json` changes.
5. Debounce rapid successive changes at 500ms.
6. Surface file watch errors (locked files, parse errors) as user notifications, not crashes.

**Acceptance criteria:**
- An LLM editing a wall element JSON causes the 3D view to update within 1 second.
- Edits to `model.json` trigger a full hierarchy reload.
- File watch errors are surfaced as notifications, not crashes.

---

## Approach

### Chosen: FSEventStream → evaluateJavaScript bridge (Approach 1)

Swift registers an `FSEventStream` on the bundle directory. On events it parses paths to extract entity type and ID, debounces per-entity at 500ms, then calls `webView.evaluateJavaScript` to notify the JS viewer. The JS viewer registers global reload functions that delegate to its entity store.

**Rejected: WKURLSchemeHandler polling (Approach 2)**
Polling at short intervals is noisy and unreliable near 1s requirement. Adds cache management complexity for no benefit.

**Rejected: FSEventStream + local WebSocket server (Approach 3)**
More complex port and lifecycle management. No advantage over direct bridge in a macOS-only context.

---

## Architecture

```
OEBFFileWatcher          ViewController / ContentView      WKWebView
     │                           │                              │
FSEventStream ──paths──► parseEntityRef()                       │
     │                   debounce(500ms)                         │
     │                           │──evaluateJavaScript──────────►│
     │                           │  __oebfHotReload(type, id)    │
     │                           │  __oebfHotReloadAll()          │──► live-reload.js
     │                           │                               │       │
     │                           │                               │  entityStore.reload()
```

---

## Components

### Swift: `macos-wrapper/Sources/OEBFFileWatcher.swift`

Wraps `FSEventStreamCreate` / `FSEventStreamStart` / `FSEventStreamStop`.

- Takes a bundle URL and a callback `(EntityRef) -> Void` / `() -> Void` (full reload).
- On each `FSEventStreamCallback` invocation, iterates event paths and calls `parseEntityRef(path:bundleRoot:)`.
- Debounces using `[String: DispatchWorkItem]` keyed by `"\(type)/\(id)"`. Each incoming event for an entity cancels the existing work item and schedules a new one 500ms out.
- A full-reload trigger (`model.json`, `manifest.json`, `materials/library.json`) cancels all pending entity debounces and schedules a single full-reload work item at 500ms.
- On stream flags `kFSEventStreamEventFlagMustScanSubDirs` or `kFSEventStreamEventFlagRootChanged`: post a user notification and stop watching. The UI offers a "Reopen" action.

### Swift: `macos-wrapper/Sources/OEBFJSBridge.swift`

Single method: `func postReload(_ ref: EntityRef, webView: WKWebView)`

- Validates `type` and `id` against `^[a-z][a-z0-9-]*$` before interpolating into JS.
- Always dispatches to `DispatchQueue.main`.
- For entity reload: `"window.__oebfHotReload('\(type)', '\(id)')"`
- For full reload: `"window.__oebfHotReloadAll()"`
- Completion handler catches JS exceptions; on error, posts notification with entity path and error string.

### JavaScript: `viewer/src/live-reload.js`

Exports `registerLiveReload(entityStore)`, called from `main.js` after the scene is initialised.

Attaches:

```js
window.__oebfHotReload = async function(type, id) {
  try {
    const data = await entityStore.fetchEntity(type, id)
    await entityStore.updateEntity(type, id, data)
    entityStore.invalidateGeometry(type, id)
  } catch (err) {
    // post error back to Swift via window.webkit.messageHandlers.oebfError.postMessage
    window.webkit.messageHandlers.oebfError.postMessage({ type, id, error: err.message })
  }
}

window.__oebfHotReloadAll = async function() {
  await entityStore.reloadAll()
}
```

In web/browser mode (no `window.webkit`), `registerLiveReload` is a no-op stub — the functions are attached but the error feedback channel silently drops messages.

---

## Path → Entity Mapping

| File path (relative to bundle root) | Action |
|---|---|
| `elements/<id>.json` | `hotReload("element", id)` |
| `paths/<id>.json` | `hotReload("path", id)` |
| `profiles/<id>.json` | `hotReload("profile", id)` |
| `junctions/<id>.json` | `hotReload("junction", id)` |
| `arrays/<id>.json` | `hotReload("array", id)` |
| `symbols/<id>.json` | `hotReload("symbol", id)` |
| `groups/<id>.json` | `hotReload("group", id)` |
| `materials/library.json` | `hotReloadAll()` |
| `model.json` | `hotReloadAll()` |
| `manifest.json` | `hotReloadAll()` |
| Anything else | Ignore silently |

---

## Error Handling

| Condition | Behaviour |
|---|---|
| JSON parse error (reported from JS) | `UNUserNotificationCenter` alert with entity path and parse error |
| File read error (locked / deleted) | Retry once after 100ms; on second failure, notify |
| Stream `MustScanSubDirs` | Notify, stop watching, offer Reopen |
| Stream `RootChanged` | Notify "Bundle moved or renamed", stop watching |
| Unknown entity type in path | `os_log` debug, no user notification, no crash |
| JS exception in `evaluateJavaScript` | Notify with entity ref and error string |

---

## WKWebView Message Handler (error feedback)

The macOS app registers a `WKScriptMessageHandler` named `oebfError`. The JS `live-reload.js` sends errors back via `window.webkit.messageHandlers.oebfError.postMessage(...)`. The Swift handler translates these into `UNUserNotificationCenter` notifications.

---

## Debounce Detail

```
t=0ms    FSEvent fires for wall-01.json     → schedule DispatchWorkItem("element/wall-01", delay=500ms)
t=200ms  FSEvent fires for wall-01.json     → cancel previous, reschedule at t+500ms
t=700ms  FSEvent fires for wall-01.json     → cancel previous, reschedule at t+500ms
t=1200ms No further events                  → work item fires: evaluateJavaScript called
```

This handles LLM tools that write files in multiple small flushes. The 500ms debounce means worst-case latency is ~600ms from last write, well within the 1-second acceptance criterion.

---

## Files Affected

| File | Action |
|---|---|
| `macos-wrapper/Sources/OEBFFileWatcher.swift` | Create |
| `macos-wrapper/Sources/OEBFJSBridge.swift` | Create |
| `macos-wrapper/Sources/OEBFViewController.swift` | Modify: wire watcher to webView |
| `viewer/src/live-reload.js` | Create |
| `viewer/src/main.js` | Modify: call `registerLiveReload(entityStore)` |
| `docs/plans/2026-03-03-macos-file-watching-design.md` | This file |
