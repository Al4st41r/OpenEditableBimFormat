# Live copy, examples, Save to folder and the detail review button

Three ways to keep working on a bundle in the 3D editor without losing changes, and one way to look at its details.

## The live copy on the Pi (private)

`https://architools.drawingtable.net/oebf/editor.html?live` opens a private copy of the terraced house that is kept on the Pi. Every change is stored as you make it: there is nothing to save or download. The browser asks for a password the first time (user `oebf`; the password is in `~/.oebf-live-password` on the Pi).

| Part | Where |
|---|---|
| The bundle | `live/terraced-house.oebf/` (not in git) |
| The server | `live-server/live_server.py`, Python standard library only, tests in `live-server/tests/` (`cd live-server && uv run pytest`) |
| Service | `oebf-live.service`, port 5080 on 127.0.0.1 only |
| nginx | `location /oebf-live/` in `architools.conf`: password from `/etc/nginx/.htpasswd-oebf-live`, then to port 5080 |
| Editor | `ServerAdapter` in `viewer/src/editor/storageAdapter.js`, opened by `?live` |

The server reads, writes, deletes and lists files inside the bundle folder and nowhere else. It refuses JSON that does not parse and writes each file whole: through a temporary file of its own, renamed into place under a lock for that path, so two tabs writing at once neither lose a request nor mix their bodies. Pages on other sites cannot write to it: a PUT or DELETE from another origin needs a CORS preflight, which the server never answers. Every response carries `X-Content-Type-Options: nosniff` and a sandbox Content-Security-Policy, so a stored SVG opened directly cannot run script, and nginx rate-limits the location (zone `oebf_live`) to slow password guessing.

**Limit:** the live copy shares its origin with every other app on architools.drawingtable.net. A script injected into any of them could use the password the browser has cached. Keep it to a private working copy; moving it to its own subdomain is #150.

The profile and detail editors opened from the live copy hand their saves back to the 3D editor, which writes them to the server.

**Start again from the example:** `rm -r live/terraced-house.oebf && cp -r example/terraced-house.oebf live/`.
**Change the password:** `sudo htpasswd -B /etc/nginx/.htpasswd-oebf-live oebf`, then update `~/.oebf-live-password`.

There is no history on the server beyond the editor's undo. Copy the folder before a large change.

## Save to folder

A bundle held in memory (the demo, or an opened `.oebfz`) shows a Save to folder button next to Save, in Chromium browsers (Chrome, Edge). Pick a folder: the editor makes a new `<name>.oebf` folder inside it (`<name>-2.oebf` and so on if that is taken), writes the bundle there and carries on there, so from then on every change is written to the folder as you make it. Next time, open that folder with Open.

## Starting from an example

The examples on the editor's welcome screen open as your own copy:

- **Chrome and Edge:** choose a folder, for example Documents. The editor makes a new `terraced-house.oebf` folder in it (`terraced-house-2.oebf` if that name is taken, so it never writes into an existing folder), copies the example in and opens it. Every change is saved there as you make it. Next time, open that folder with Open.
- **Firefox and Safari:** the example downloads as `terraced-house.oebfz` and opens. Changes are held in memory: Save writes the updated `.oebfz` (a file picker where the browser has one, a download elsewhere), which opens again with Open → Open .oebfz or .zip file. A `.oebf.zip` saved by an earlier version still opens.

A `?demo` link (`editor.html?demo`, `?demo=nmb-two-storey`) still opens the example straight in memory, with nothing saved until you press Save.

## Detail review button

Each row in the scene tree's Details list has a cube button. It opens the detail review page (`detail-axo.html`) on the bundle the editor has open, with that detail selected. A folder is handed over as its folder, so Edit detail there saves to it. The live copy is read from the server. A bundle in memory is handed over as a copy, so edits made from the review page stay in that page (Download edit keeps them).
