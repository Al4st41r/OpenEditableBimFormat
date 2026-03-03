# macOS File Watching — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement real-time file watching for the macOS OEBF wrapper so that LLM edits to bundle JSON files are reflected in the 3D view within 1 second.

**Architecture:** FSEventStream watches the `.oebf` bundle directory in Swift. Changed paths are parsed to `EntityRef` structs, debounced per-entity at 500ms, then posted to WKWebView via `evaluateJavaScript`. The web viewer registers `window.__oebfHotReload(type, id)` and `window.__oebfHotReloadAll()` through a `live-reload.js` module. Errors flow back via a `WKScriptMessageHandler`.

**Tech Stack:** Swift 6, FSEventStream (CoreServices), WKWebView (WebKit), UserNotifications, Vitest 2, Three.js 0.170+. Tests: XCTest (Swift), Vitest (JS). Build: `swift test`, `cd viewer && npm test`.

**Design doc:** `docs/plans/2026-03-03-macos-file-watching-design.md`

---

## Task 1: JS live-reload module

**Files:**
- Create: `viewer/src/live-reload.js`
- Create: `viewer/src/live-reload.test.js`

### Step 1: Write failing tests

Create `viewer/src/live-reload.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerLiveReload } from './live-reload.js'

describe('registerLiveReload', () => {
  let store
  beforeEach(() => {
    store = {
      fetchEntity: vi.fn(),
      updateEntity: vi.fn(),
      invalidateGeometry: vi.fn(),
      reloadAll: vi.fn(),
    }
    // Clear any previously registered globals
    delete window.__oebfHotReload
    delete window.__oebfHotReloadAll
  })

  it('registers __oebfHotReload and __oebfHotReloadAll on window', () => {
    registerLiveReload(store)
    expect(typeof window.__oebfHotReload).toBe('function')
    expect(typeof window.__oebfHotReloadAll).toBe('function')
  })

  it('__oebfHotReload calls fetchEntity, updateEntity, invalidateGeometry in order', async () => {
    store.fetchEntity.mockResolvedValue({ id: 'wall-01', type: 'element' })
    registerLiveReload(store)
    await window.__oebfHotReload('element', 'wall-01')
    expect(store.fetchEntity).toHaveBeenCalledWith('element', 'wall-01')
    expect(store.updateEntity).toHaveBeenCalledWith('element', 'wall-01', { id: 'wall-01', type: 'element' })
    expect(store.invalidateGeometry).toHaveBeenCalledWith('element', 'wall-01')
  })

  it('__oebfHotReloadAll calls store.reloadAll', async () => {
    registerLiveReload(store)
    await window.__oebfHotReloadAll()
    expect(store.reloadAll).toHaveBeenCalledOnce()
  })

  it('__oebfHotReload error is silently dropped when no webkit bridge', async () => {
    store.fetchEntity.mockRejectedValue(new Error('parse error'))
    registerLiveReload(store)
    // Must not throw
    await expect(window.__oebfHotReload('element', 'bad-id')).resolves.toBeUndefined()
  })

  it('registerLiveReload is a no-op when store is null', () => {
    expect(() => registerLiveReload(null)).not.toThrow()
  })
})
```

### Step 2: Run tests — verify they fail

```bash
cd viewer && npm test -- --reporter verbose src/live-reload.test.js
```

Expected: FAIL — "Cannot find module './live-reload.js'"

### Step 3: Implement `live-reload.js`

Create `viewer/src/live-reload.js`:

```js
/**
 * live-reload.js
 *
 * Registers window.__oebfHotReload(type, id) and window.__oebfHotReloadAll()
 * for use by the macOS wrapper's FSEventStream → WKWebView bridge.
 *
 * In browser/dev mode (no window.webkit), errors are logged to console only.
 * Call registerLiveReload(entityStore) once after the scene is initialised.
 *
 * See: docs/plans/2026-03-03-macos-file-watching-design.md
 */

/**
 * @param {object|null} entityStore - must expose:
 *   fetchEntity(type, id) → Promise<object>
 *   updateEntity(type, id, data) → Promise<void>
 *   invalidateGeometry(type, id) → void
 *   reloadAll() → Promise<void>
 */
export function registerLiveReload(entityStore) {
  if (!entityStore) return

  window.__oebfHotReload = async function (type, id) {
    try {
      const data = await entityStore.fetchEntity(type, id)
      await entityStore.updateEntity(type, id, data)
      entityStore.invalidateGeometry(type, id)
    } catch (err) {
      const bridge = window.webkit?.messageHandlers?.oebfError
      if (bridge) {
        bridge.postMessage({ type, id, error: err.message })
      } else {
        console.warn('[oebf live-reload] reload failed:', type, id, err.message)
      }
    }
  }

  window.__oebfHotReloadAll = async function () {
    await entityStore.reloadAll()
  }
}
```

### Step 4: Run tests — verify they pass

```bash
cd viewer && npm test -- --reporter verbose src/live-reload.test.js
```

Expected: 5 tests PASS.

### Step 5: Commit

```bash
cd viewer && cd ..
git add viewer/src/live-reload.js viewer/src/live-reload.test.js
git commit -m "feat: JS live-reload module for macOS file watch bridge"
```

---

## Task 2: macOS wrapper SPM scaffold

**Files:**
- Create: `macos-wrapper/Package.swift`
- Create: `macos-wrapper/Sources/OEBFCore/EntityRef.swift`
- Create: `macos-wrapper/Tests/OEBFCoreTests/OEBFCoreTests.swift`

### Step 1: Create directory structure

```bash
mkdir -p macos-wrapper/Sources/OEBFCore
mkdir -p macos-wrapper/Tests/OEBFCoreTests
```

### Step 2: Write `Package.swift`

Create `macos-wrapper/Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OEBFWrapper",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "OEBFCore", targets: ["OEBFCore"]),
    ],
    targets: [
        .target(
            name: "OEBFCore",
            dependencies: [],
            path: "Sources/OEBFCore"
        ),
        .testTarget(
            name: "OEBFCoreTests",
            dependencies: ["OEBFCore"],
            path: "Tests/OEBFCoreTests"
        ),
    ]
)
```

### Step 3: Write `EntityRef.swift`

Create `macos-wrapper/Sources/OEBFCore/EntityRef.swift`:

```swift
/// Identifies a single entity within an OEBF bundle.
public struct EntityRef: Equatable, Hashable, Sendable {
    public let entityType: String
    public let entityID: String

    public init(entityType: String, entityID: String) {
        self.entityType = entityType
        self.entityID = entityID
    }
}

/// Stable dictionary key for debounce map.
extension EntityRef {
    var debounceKey: String { "\(entityType)/\(entityID)" }
}
```

### Step 4: Write placeholder test

Create `macos-wrapper/Tests/OEBFCoreTests/OEBFCoreTests.swift`:

```swift
import XCTest
@testable import OEBFCore

final class OEBFCoreTests: XCTestCase {
    func testEntityRefEquality() {
        let a = EntityRef(entityType: "element", entityID: "wall-01")
        let b = EntityRef(entityType: "element", entityID: "wall-01")
        XCTAssertEqual(a, b)
    }
}
```

### Step 5: Build and run

```bash
cd macos-wrapper && swift test
```

Expected: 1 test PASS.

### Step 6: Commit

```bash
cd ..
git add macos-wrapper/
git commit -m "feat: macos-wrapper SPM scaffold with EntityRef"
```

---

## Task 3: Entity ref path parsing

**Files:**
- Create: `macos-wrapper/Sources/OEBFCore/ParseEntityRef.swift`
- Modify: `macos-wrapper/Tests/OEBFCoreTests/OEBFCoreTests.swift`

Entity type directory mapping (matches bundle structure from design doc):

| Directory | `entityType` |
|---|---|
| `elements` | `element` |
| `paths` | `path` |
| `profiles` | `profile` |
| `junctions` | `junction` |
| `arrays` | `array` |
| `symbols` | `symbol` |
| `groups` | `group` |

Full-reload paths: `model.json`, `manifest.json`, `materials/library.json`.

### Step 1: Write failing tests

Add to `macos-wrapper/Tests/OEBFCoreTests/OEBFCoreTests.swift`:

```swift
import XCTest
@testable import OEBFCore

final class ParseEntityRefTests: XCTestCase {
    let bundleRoot = URL(fileURLWithPath: "/project/terraced-house.oebf")

    func testElementPath() {
        let path = "/project/terraced-house.oebf/elements/wall-01.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertEqual(result, .entity(EntityRef(entityType: "element", entityID: "wall-01")))
    }

    func testPathEntity() {
        let path = "/project/terraced-house.oebf/paths/spine-01.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertEqual(result, .entity(EntityRef(entityType: "path", entityID: "spine-01")))
    }

    func testModelJson() {
        let path = "/project/terraced-house.oebf/model.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertEqual(result, .fullReload)
    }

    func testManifestJson() {
        let path = "/project/terraced-house.oebf/manifest.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertEqual(result, .fullReload)
    }

    func testMaterialsLibrary() {
        let path = "/project/terraced-house.oebf/materials/library.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertEqual(result, .fullReload)
    }

    func testUnknownDirectory() {
        let path = "/project/terraced-house.oebf/ifc/export.ifc"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertNil(result)
    }

    func testOutsideBundle() {
        let path = "/project/other-file.json"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertNil(result)
    }

    func testNonJsonFile() {
        let path = "/project/terraced-house.oebf/elements/wall-01.svg"
        let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
        XCTAssertNil(result)
    }

    func testAllKnownEntityTypes() {
        let types: [(dir: String, type: String)] = [
            ("elements", "element"), ("paths", "path"), ("profiles", "profile"),
            ("junctions", "junction"), ("arrays", "array"), ("symbols", "symbol"),
            ("groups", "group"),
        ]
        for (dir, entityType) in types {
            let path = "/project/terraced-house.oebf/\(dir)/test-id.json"
            let result = parseEntityRef(path: path, bundleRoot: bundleRoot)
            XCTAssertEqual(result, .entity(EntityRef(entityType: entityType, entityID: "test-id")),
                           "Failed for directory: \(dir)")
        }
    }
}
```

### Step 2: Run tests — verify they fail

```bash
cd macos-wrapper && swift test --filter ParseEntityRefTests
```

Expected: compile error — `parseEntityRef` not found.

### Step 3: Implement `ParseEntityRef.swift`

Create `macos-wrapper/Sources/OEBFCore/ParseEntityRef.swift`:

```swift
import Foundation

/// Result of parsing a file path within an OEBF bundle.
public enum EntityRefResult: Equatable {
    case entity(EntityRef)
    case fullReload
}

private let entityTypeMap: [String: String] = [
    "elements":  "element",
    "paths":     "path",
    "profiles":  "profile",
    "junctions": "junction",
    "arrays":    "array",
    "symbols":   "symbol",
    "groups":    "group",
]

private let fullReloadPaths: Set<String> = [
    "model.json",
    "manifest.json",
    "materials/library.json",
]

/// Parse a file system path into an EntityRefResult, or nil if the path
/// is not a recognised OEBF entity file (e.g. a non-JSON file, a directory
/// outside the bundle, or an unknown subdirectory).
///
/// - Parameters:
///   - path: Absolute file system path of the changed file.
///   - bundleRoot: Absolute URL of the `.oebf` bundle directory.
/// - Returns: `.entity` for a single entity file, `.fullReload` for manifest/
///   model/materials changes, `nil` for unrecognised paths.
public func parseEntityRef(path: String, bundleRoot: URL) -> EntityRefResult? {
    let bundlePath = bundleRoot.path
    guard path.hasPrefix(bundlePath + "/") else { return nil }

    let relative = String(path.dropFirst(bundlePath.count + 1))
    guard relative.hasSuffix(".json") else { return nil }

    // Full-reload paths
    if fullReloadPaths.contains(relative) { return .fullReload }

    // Entity paths: <directory>/<id>.json
    let components = relative.split(separator: "/", maxSplits: 2)
    guard components.count == 2 else { return nil }

    let directory = String(components[0])
    let filename  = String(components[1])
    guard let entityType = entityTypeMap[directory] else { return nil }

    let entityID = String(filename.dropLast(5)) // strip .json
    guard !entityID.isEmpty else { return nil }

    return .entity(EntityRef(entityType: entityType, entityID: entityID))
}
```

### Step 4: Run tests — verify they pass

```bash
cd macos-wrapper && swift test --filter ParseEntityRefTests
```

Expected: 9 tests PASS.

### Step 5: Commit

```bash
cd ..
git add macos-wrapper/Sources/OEBFCore/ParseEntityRef.swift \
        macos-wrapper/Tests/OEBFCoreTests/OEBFCoreTests.swift
git commit -m "feat: parseEntityRef — map bundle paths to EntityRef or fullReload"
```

---

## Task 4: Debouncer

**Files:**
- Create: `macos-wrapper/Sources/OEBFCore/OEBFDebouncer.swift`
- Create: `macos-wrapper/Tests/OEBFCoreTests/OEBFDebouncerTests.swift`

The debouncer cancels and reschedules a work item on each call. A `fullReload` key cancels all pending entity keys.

### Step 1: Write failing tests

Create `macos-wrapper/Tests/OEBFCoreTests/OEBFDebouncerTests.swift`:

```swift
import XCTest
@testable import OEBFCore

final class OEBFDebouncerTests: XCTestCase {

    func testCallbackFiredAfterDelay() {
        let expectation = expectation(description: "callback fired")
        let debouncer = OEBFDebouncer(delay: 0.05)
        debouncer.schedule(key: "element/wall-01") {
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func testRapidCallsCancelEarlier() {
        var callCount = 0
        let expectation = expectation(description: "exactly one call")
        let debouncer = OEBFDebouncer(delay: 0.05)
        for _ in 0..<5 {
            debouncer.schedule(key: "element/wall-01") {
                callCount += 1
            }
        }
        // After delay, add final callback that fulfils
        debouncer.schedule(key: "element/wall-01") {
            callCount += 1
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
        XCTAssertEqual(callCount, 1)
    }

    func testCancelAll() {
        var called = false
        let notExpected = expectation(description: "must not be called")
        notExpected.isInverted = true
        let debouncer = OEBFDebouncer(delay: 0.1)
        debouncer.schedule(key: "element/wall-01") {
            called = true
            notExpected.fulfill()
        }
        debouncer.cancelAll()
        waitForExpectations(timeout: 0.3)
        XCTAssertFalse(called)
    }

    func testDifferentKeysFireIndependently() {
        let exp1 = expectation(description: "wall-01 fired")
        let exp2 = expectation(description: "wall-02 fired")
        let debouncer = OEBFDebouncer(delay: 0.05)
        debouncer.schedule(key: "element/wall-01") { exp1.fulfill() }
        debouncer.schedule(key: "element/wall-02") { exp2.fulfill() }
        waitForExpectations(timeout: 1)
    }
}
```

### Step 2: Run tests — verify they fail

```bash
cd macos-wrapper && swift test --filter OEBFDebouncerTests
```

Expected: compile error — `OEBFDebouncer` not found.

### Step 3: Implement `OEBFDebouncer.swift`

Create `macos-wrapper/Sources/OEBFCore/OEBFDebouncer.swift`:

```swift
import Foundation

/// Debounces closures keyed by string. Rapid successive calls for the same
/// key cancel earlier work items; only the most recent fires after `delay`.
///
/// Thread-safe: all state mutations are serialised on a dedicated queue.
public final class OEBFDebouncer: @unchecked Sendable {
    private let delay: TimeInterval
    private var pending: [String: DispatchWorkItem] = [:]
    private let queue = DispatchQueue(label: "net.drawingtable.oebf.debouncer")

    public init(delay: TimeInterval = 0.5) {
        self.delay = delay
    }

    /// Schedule `block` to run after `delay` seconds under `key`.
    /// Any previously scheduled block for the same key is cancelled.
    public func schedule(key: String, block: @escaping () -> Void) {
        queue.async { [self] in
            pending[key]?.cancel()
            let item = DispatchWorkItem(block: block)
            pending[key] = item
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
        }
    }

    /// Cancel all pending work items.
    public func cancelAll() {
        queue.async { [self] in
            pending.values.forEach { $0.cancel() }
            pending.removeAll()
        }
    }
}
```

### Step 4: Run tests — verify they pass

```bash
cd macos-wrapper && swift test --filter OEBFDebouncerTests
```

Expected: 4 tests PASS.

### Step 5: Commit

```bash
cd ..
git add macos-wrapper/Sources/OEBFCore/OEBFDebouncer.swift \
        macos-wrapper/Tests/OEBFCoreTests/OEBFDebouncerTests.swift
git commit -m "feat: OEBFDebouncer — per-key cancellable dispatch work items"
```

---

## Task 5: OEBFFileWatcher

**Files:**
- Create: `macos-wrapper/Sources/OEBFCore/OEBFFileWatcher.swift`
- Create: `macos-wrapper/Tests/OEBFCoreTests/OEBFFileWatcherTests.swift`

### Step 1: Write failing tests

Create `macos-wrapper/Tests/OEBFCoreTests/OEBFFileWatcherTests.swift`:

```swift
import XCTest
@testable import OEBFCore

final class OEBFFileWatcherTests: XCTestCase {

    var bundleURL: URL!
    var elementsDir: URL!

    override func setUpWithError() throws {
        bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("test.oebf", isDirectory: true)
        elementsDir = bundleURL.appendingPathComponent("elements", isDirectory: true)
        try FileManager.default.createDirectory(at: elementsDir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: bundleURL)
    }

    func testEntityReloadFiredOnFileWrite() throws {
        let exp = expectation(description: "entity reload")
        var receivedRef: EntityRef?

        let watcher = OEBFFileWatcher(bundleURL: bundleURL, debounceDelay: 0.05)
        watcher.onEntityReload = { ref in
            receivedRef = ref
            exp.fulfill()
        }
        try watcher.start()

        // Write a file that matches an entity path
        let file = elementsDir.appendingPathComponent("wall-01.json")
        try "{\"id\":\"wall-01\"}".write(to: file, atomically: true, encoding: .utf8)

        waitForExpectations(timeout: 2)
        XCTAssertEqual(receivedRef, EntityRef(entityType: "element", entityID: "wall-01"))
        watcher.stop()
    }

    func testFullReloadFiredForModelJson() throws {
        let exp = expectation(description: "full reload")

        let watcher = OEBFFileWatcher(bundleURL: bundleURL, debounceDelay: 0.05)
        watcher.onFullReload = { exp.fulfill() }
        try watcher.start()

        let file = bundleURL.appendingPathComponent("model.json")
        try "{\"type\":\"model\"}".write(to: file, atomically: true, encoding: .utf8)

        waitForExpectations(timeout: 2)
        watcher.stop()
    }

    func testRapidWritesDebounced() throws {
        var callCount = 0
        let exp = expectation(description: "debounced to one call")
        let watcher = OEBFFileWatcher(bundleURL: bundleURL, debounceDelay: 0.1)
        watcher.onEntityReload = { _ in
            callCount += 1
            if callCount == 1 { exp.fulfill() }
        }
        try watcher.start()

        let file = elementsDir.appendingPathComponent("wall-01.json")
        for _ in 0..<5 {
            try "{\"id\":\"wall-01\"}".write(to: file, atomically: true, encoding: .utf8)
        }

        waitForExpectations(timeout: 2)
        // Wait an extra beat; if debounce failed more calls would arrive
        Thread.sleep(forTimeInterval: 0.4)
        XCTAssertEqual(callCount, 1)
        watcher.stop()
    }
}
```

### Step 2: Run tests — verify they fail

```bash
cd macos-wrapper && swift test --filter OEBFFileWatcherTests
```

Expected: compile error — `OEBFFileWatcher` not found.

### Step 3: Implement `OEBFFileWatcher.swift`

Create `macos-wrapper/Sources/OEBFCore/OEBFFileWatcher.swift`:

```swift
import Foundation
import CoreServices

/// Watches an OEBF bundle directory for JSON file changes using FSEventStream.
/// Debounces per-entity at a configurable delay (default 500ms).
///
/// Usage:
/// ```swift
/// let watcher = OEBFFileWatcher(bundleURL: url)
/// watcher.onEntityReload = { ref in … }
/// watcher.onFullReload   = { … }
/// watcher.onError        = { msg in … }
/// try watcher.start()
/// // later:
/// watcher.stop()
/// ```
public final class OEBFFileWatcher: @unchecked Sendable {
    public var onEntityReload: ((EntityRef) -> Void)?
    public var onFullReload:   (() -> Void)?
    public var onError:        ((String) -> Void)?

    private let bundleURL: URL
    private let debouncer: OEBFDebouncer
    private var stream: FSEventStreamRef?
    private let callbackQueue = DispatchQueue(label: "net.drawingtable.oebf.fsevents")

    public init(bundleURL: URL, debounceDelay: TimeInterval = 0.5) {
        self.bundleURL = bundleURL
        self.debouncer = OEBFDebouncer(delay: debounceDelay)
    }

    /// Start watching. Throws if the stream cannot be created.
    public func start() throws {
        let pathsToWatch = [bundleURL.path] as CFArray
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passRetained(self).toOpaque(),
            retain: nil,
            release: { ptr in
                guard let ptr else { return }
                Unmanaged<OEBFFileWatcher>.fromOpaque(ptr).release()
            },
            copyDescription: nil
        )

        guard let s = FSEventStreamCreate(
            nil,
            fileWatcherCallback,
            &context,
            pathsToWatch,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1,  // coalesce events over 100ms before delivering
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagFileEvents |
                kFSEventStreamCreateFlagUseCFTypes
            )
        ) else {
            throw OEBFFileWatcherError.streamCreationFailed
        }

        stream = s
        FSEventStreamSetDispatchQueue(s, callbackQueue)
        FSEventStreamStart(s)
    }

    /// Stop watching and invalidate the stream.
    public func stop() {
        guard let s = stream else { return }
        FSEventStreamStop(s)
        FSEventStreamInvalidate(s)
        FSEventStreamRelease(s)
        stream = nil
        debouncer.cancelAll()
    }

    fileprivate func handle(path: String, flags: FSEventStreamEventFlags) {
        // Ignore directory-only events and flag combinations that indicate
        // structural changes requiring a rescan.
        if flags & UInt32(kFSEventStreamEventFlagItemIsDir) != 0 { return }

        if flags & UInt32(kFSEventStreamEventFlagMustScanSubDirs) != 0 ||
           flags & UInt32(kFSEventStreamEventFlagRootChanged) != 0 {
            onError?("Bundle directory changed significantly. Consider reopening.")
            stop()
            return
        }

        guard let result = parseEntityRef(path: path, bundleRoot: bundleURL) else { return }

        switch result {
        case .fullReload:
            debouncer.cancelAll()
            debouncer.schedule(key: "__fullReload__") { [weak self] in
                self?.onFullReload?()
            }
        case .entity(let ref):
            debouncer.schedule(key: ref.debounceKey) { [weak self] in
                self?.onEntityReload?(ref)
            }
        }
    }
}

public enum OEBFFileWatcherError: Error {
    case streamCreationFailed
}

// FSEventStream C callback — bridges to the Swift instance.
private let fileWatcherCallback: FSEventStreamCallback = { _, info, numEvents, eventPaths, eventFlags, _ in
    guard let info else { return }
    let watcher = Unmanaged<OEBFFileWatcher>.fromOpaque(info).takeUnretainedValue()
    guard let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] else { return }
    for (index, path) in paths.enumerated() {
        watcher.handle(path: path, flags: eventFlags[index])
    }
}
```

### Step 4: Run tests — verify they pass

```bash
cd macos-wrapper && swift test --filter OEBFFileWatcherTests
```

Expected: 3 tests PASS.

### Step 5: Commit

```bash
cd ..
git add macos-wrapper/Sources/OEBFCore/OEBFFileWatcher.swift \
        macos-wrapper/Tests/OEBFCoreTests/OEBFFileWatcherTests.swift
git commit -m "feat: OEBFFileWatcher — FSEventStream with per-entity debounce"
```

---

## Task 6: OEBFJSBridge — string sanitisation and JS dispatch

**Files:**
- Create: `macos-wrapper/Sources/OEBFCore/OEBFJSBridge.swift`
- Create: `macos-wrapper/Tests/OEBFCoreTests/OEBFJSBridgeTests.swift`

The bridge sanitises `type` and `id` before interpolating into JS. It uses a protocol so WKWebView can be mocked in tests.

### Step 1: Write failing tests

Create `macos-wrapper/Tests/OEBFCoreTests/OEBFJSBridgeTests.swift`:

```swift
import XCTest
@testable import OEBFCore

final class MockJSEvaluator: JSEvaluating {
    var lastScript: String?
    func evaluate(javaScript: String) {
        lastScript = javaScript
    }
}

final class OEBFJSBridgeTests: XCTestCase {

    func testEntityReloadScript() {
        let evaluator = MockJSEvaluator()
        let bridge = OEBFJSBridge(evaluator: evaluator)
        let ref = EntityRef(entityType: "element", entityID: "wall-01")
        bridge.postEntityReload(ref)
        XCTAssertEqual(evaluator.lastScript,
                       "window.__oebfHotReload('element','wall-01')")
    }

    func testFullReloadScript() {
        let evaluator = MockJSEvaluator()
        let bridge = OEBFJSBridge(evaluator: evaluator)
        bridge.postFullReload()
        XCTAssertEqual(evaluator.lastScript, "window.__oebfHotReloadAll()")
    }

    func testSanitisesTypeWithInvalidChars() {
        let evaluator = MockJSEvaluator()
        let bridge = OEBFJSBridge(evaluator: evaluator)
        // Type contains invalid chars — should be stripped
        let ref = EntityRef(entityType: "ele'ment", entityID: "wall-01")
        bridge.postEntityReload(ref)
        XCTAssertEqual(evaluator.lastScript,
                       "window.__oebfHotReload('element','wall-01')")
    }

    func testSanitisesIDWithInvalidChars() {
        let evaluator = MockJSEvaluator()
        let bridge = OEBFJSBridge(evaluator: evaluator)
        let ref = EntityRef(entityType: "element", entityID: "wall\"; alert(1);//")
        bridge.postEntityReload(ref)
        // All non-alphanumeric-or-hyphen chars stripped
        XCTAssertEqual(evaluator.lastScript,
                       "window.__oebfHotReload('element','wall-alert1-')")
    }
}
```

### Step 2: Run tests — verify they fail

```bash
cd macos-wrapper && swift test --filter OEBFJSBridgeTests
```

Expected: compile error — `OEBFJSBridge` not found.

### Step 3: Implement `OEBFJSBridge.swift`

Create `macos-wrapper/Sources/OEBFCore/OEBFJSBridge.swift`:

```swift
import Foundation

/// Abstracts `WKWebView.evaluateJavaScript` for testability.
public protocol JSEvaluating: AnyObject {
    func evaluate(javaScript: String)
}

/// Posts OEBF hot-reload messages to the WKWebView via evaluateJavaScript.
///
/// `type` and `id` are sanitised to `[a-z0-9-]` before JS interpolation to
/// prevent injection. OEBF IDs should already match this pattern per the spec,
/// so sanitisation is a safety net only.
public final class OEBFJSBridge {
    private weak var evaluator: (any JSEvaluating)?

    public init(evaluator: any JSEvaluating) {
        self.evaluator = evaluator
    }

    public func postEntityReload(_ ref: EntityRef) {
        let safeType = sanitise(ref.entityType)
        let safeID   = sanitise(ref.entityID)
        evaluator?.evaluate(javaScript: "window.__oebfHotReload('\(safeType)','\(safeID)')")
    }

    public func postFullReload() {
        evaluator?.evaluate(javaScript: "window.__oebfHotReloadAll()")
    }

    /// Strip all characters that are not lowercase letters, digits, or hyphens.
    private func sanitise(_ input: String) -> String {
        input.unicodeScalars
            .filter { c in
                (c >= "a" && c <= "z") ||
                (c >= "0" && c <= "9") ||
                c == "-"
            }
            .map(String.init)
            .joined()
    }
}
```

### Step 4: Run tests — verify they pass

```bash
cd macos-wrapper && swift test --filter OEBFJSBridgeTests
```

Expected: 4 tests PASS.

### Step 5: Run the full Swift test suite

```bash
cd macos-wrapper && swift test
```

Expected: all tests PASS.

### Step 6: Commit

```bash
cd ..
git add macos-wrapper/Sources/OEBFCore/OEBFJSBridge.swift \
        macos-wrapper/Tests/OEBFCoreTests/OEBFJSBridgeTests.swift
git commit -m "feat: OEBFJSBridge — sanitised evaluateJavaScript dispatch"
```

---

## Task 7: OEBFViewController wiring

**Files:**
- Create: `macos-wrapper/Sources/OEBFCore/OEBFViewController.swift`

This file provides a reference implementation for wiring `OEBFFileWatcher`, `OEBFJSBridge`, `WKWebView`, and `UserNotifications` together. It is not unit-tested here (WKWebView and UserNotifications require a running app); it serves as the integration point.

### Step 1: Add WKWebView JSEvaluating conformance

Append to `macos-wrapper/Sources/OEBFCore/OEBFJSBridge.swift`:

```swift
#if canImport(WebKit)
import WebKit

extension WKWebView: JSEvaluating {
    public func evaluate(javaScript: String) {
        DispatchQueue.main.async { [weak self] in
            self?.evaluateJavaScript(javaScript) { _, error in
                if let error {
                    // Error is surfaced via oebfError WKScriptMessageHandler
                    // in the app layer; log here for diagnostics.
                    print("[OEBFJSBridge] JS error:", error.localizedDescription)
                }
            }
        }
    }
}
#endif
```

### Step 2: Write `OEBFViewController.swift`

Create `macos-wrapper/Sources/OEBFCore/OEBFViewController.swift`:

```swift
#if canImport(WebKit) && canImport(UserNotifications)
import Foundation
import WebKit
import UserNotifications

/// Reference implementation for the macOS OEBF file watching integration.
///
/// Intended for use in a SwiftUI `NSViewControllerRepresentable` or AppKit
/// `NSViewController`. The WKWebView must already have the viewer loaded
/// before `openBundle(_:)` is called.
///
/// Error feedback from JS is received via the `oebfError` WKScriptMessageHandler,
/// which must be registered on the WKWebView's configuration:
///
///   configuration.userContentController
///       .add(viewController, name: "oebfError")
public final class OEBFViewController: NSObject, WKScriptMessageHandler {
    private var watcher: OEBFFileWatcher?
    private var bridge: OEBFJSBridge?

    public func openBundle(_ url: URL, webView: WKWebView) {
        stopWatching()

        let watcher = OEBFFileWatcher(bundleURL: url)
        let bridge  = OEBFJSBridge(evaluator: webView)
        self.watcher = watcher
        self.bridge  = bridge

        watcher.onEntityReload = { [weak bridge] ref in
            bridge?.postEntityReload(ref)
        }
        watcher.onFullReload = { [weak bridge] in
            bridge?.postFullReload()
        }
        watcher.onError = { message in
            Self.notify(title: "OEBF File Watch Error", body: message)
        }

        do {
            try watcher.start()
        } catch {
            Self.notify(title: "OEBF", body: "Could not start file watcher: \(error.localizedDescription)")
        }
    }

    public func stopWatching() {
        watcher?.stop()
        watcher = nil
        bridge  = nil
    }

    // MARK: - WKScriptMessageHandler (receives oebfError from JS)

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "oebfError",
              let body = message.body as? [String: String] else { return }
        let type  = body["type"]  ?? "?"
        let id    = body["id"]    ?? "?"
        let error = body["error"] ?? "unknown error"
        Self.notify(
            title: "OEBF reload error",
            body:  "[\(type)/\(id)] \(error)"
        )
    }

    // MARK: - Notifications

    private static func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body  = body
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
#endif
```

### Step 3: Build — verify it compiles

```bash
cd macos-wrapper && swift build
```

Expected: Build succeeds with no errors.

### Step 4: Run the full test suite

```bash
cd macos-wrapper && swift test
```

Expected: all tests PASS.

### Step 5: Run the JS test suite

```bash
cd viewer && npm test
```

Expected: all tests PASS (including the new `live-reload.test.js`).

### Step 6: Commit

```bash
cd ..
git add macos-wrapper/Sources/OEBFCore/OEBFViewController.swift \
        macos-wrapper/Sources/OEBFCore/OEBFJSBridge.swift
git commit -m "feat: OEBFViewController — wire file watcher to WKWebView with error notifications"
```

---

## Task 8: README and final push

**Files:**
- Create: `macos-wrapper/README.md`

### Step 1: Write README

Create `macos-wrapper/README.md`:

```markdown
# OEBFCore — macOS Wrapper Library

Swift 6 library providing file-watching and WKWebView bridge for the OEBF macOS viewer.

## Components

| File | Purpose |
|---|---|
| `EntityRef.swift` | Value type identifying one entity |
| `ParseEntityRef.swift` | Map bundle file paths to `EntityRef` or `fullReload` |
| `OEBFDebouncer.swift` | Per-key debounce using `DispatchWorkItem` |
| `OEBFFileWatcher.swift` | `FSEventStream` wrapper; emits entity/full-reload events |
| `OEBFJSBridge.swift` | Sanitised `evaluateJavaScript` dispatch; `WKWebView` conformance |
| `OEBFViewController.swift` | Integration wiring; handles JS error messages via `WKScriptMessageHandler` |

## Tests

```bash
swift test
```

## Integration

In your SwiftUI app, register the `oebfError` message handler and call `openBundle(_:webView:)`:

```swift
let vc = OEBFViewController()
configuration.userContentController.add(vc, name: "oebfError")
// after webView loads viewer:
vc.openBundle(bundleURL, webView: webView)
```

## Behaviour

- File changes debounced per entity at 500ms.
- `model.json`, `manifest.json`, `materials/library.json` trigger full reload.
- FSEvent errors and JS errors surface as `UNUserNotificationCenter` alerts.
- IDs sanitised to `[a-z0-9-]` before JS interpolation.
```

### Step 2: Run all tests one final time

```bash
cd macos-wrapper && swift test && cd ../viewer && npm test
```

Expected: all tests PASS.

### Step 3: Commit and push

```bash
cd ..
git add macos-wrapper/README.md
git commit -m "docs: macos-wrapper README"
git push
```

---

## Acceptance Criteria Verification

| Criterion | Covered by |
|---|---|
| LLM editing a wall JSON updates view within 1s | `OEBFFileWatcherTests.testRapidWritesDebounced` (500ms debounce + FSEvent latency) |
| `model.json` triggers full hierarchy reload | `OEBFFileWatcherTests.testFullReloadFiredForModelJson` |
| File watch errors surfaced as notifications, not crashes | `OEBFFileWatcher` error handling + `OEBFViewController.notify` |
| Rapid successive changes debounced | `OEBFDebouncerTests.testRapidCallsCancelEarlier` |
| JS error feedback loop | `OEBFViewController` WKScriptMessageHandler |
