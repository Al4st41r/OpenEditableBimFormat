# AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-powered command palette to the OEBF editor that reads and writes bundle entities on the user's behalf, with diff preview and schema validation before any changes are committed.

**Architecture:** A keyboard-triggered modal (Ctrl+K) sends the user's natural-language request to Claude Sonnet 4.6 together with OEBF-GUIDE.md and the bundle manifest as context. Claude calls tools (`read_entity`, `write_entity`, `list_entities`) to inspect and modify JSON files in the open bundle; the UI shows a diff of proposed changes and requires explicit confirmation before writes are applied. All API calls go directly from the browser to the Anthropic API using the user's own key stored in `localStorage` — no backend is required.

**Tech Stack:** `@anthropic-ai/sdk` (browser build, `dangerouslyAllowBrowser: true`), Anthropic Claude Sonnet 4.6, Vitest (unit tests), existing `storageAdapter` pattern, `ajv` (schema validation already present in viewer)

---

## Research context: OpenPencil comparison

OpenPencil (Phase 5, complete) integrates AI via:

- **No-backend LLM access** — direct browser → OpenRouter (CORS-friendly); user supplies key via a stronghold UI; key stored in browser storage.
- **87-tool library** split across domain files (node manipulation, boolean ops, variable CRUD, viewport control). Each tool maps exactly to one editor action.
- **MCP server** (`@open-pencil/mcp`) exposing the same tools over stdio and HTTP for external agents.
- **AI tab** in the properties panel (alongside Design and Code tabs); keyboard shortcut ⌘J toggles the chat panel.
- **JSX renderer** (`sceneNodeToJsx()`) gives the LLM a compact, human-readable representation of the scene graph — analogous to OEBF's OEBF-GUIDE.md + JSON entities.
- **Streaming** with mock transport in Playwright tests.

**OEBF equivalent choices:**

| OpenPencil | OEBF |
|---|---|
| OpenRouter (model-agnostic) | Anthropic SDK direct (Claude only, simpler) |
| `sceneNodeToJsx()` scene representation | OEBF-GUIDE.md + manifest + entity list |
| 87 granular tools | ~8 tools covering OEBF entity CRUD |
| ⌘J chat panel | Ctrl+K command palette (lower surface area) |
| Properties panel AI tab | Scene tree "Ask AI…" right-click (Phase 4) |
| `@open-pencil/mcp` package | `oebf-mcp` package (Phase 4) |

The palette-first approach is preferred over a persistent chat panel for v0.5 because it keeps the surface area small and does not require a sidebar redesign. The pattern can evolve to a full chat panel in a later phase once the tool library and context pipeline are proven.

---

## OEBF-GUIDE.md as LLM context (foundation)

Every bundle already contains `OEBF-GUIDE.md` at its root (generated from `spec/OEBF-GUIDE-template.md`). This document teaches an LLM:

- Entity types, required fields, and file paths
- Bundle layout
- ID conventions (lowercase kebab-case, prefixed)
- Schema declaration (`$schema` as first field)
- Coordinate system (metres, Z-up)
- Registration rules in `model.json`
- Worked examples (add wall, add door)

At ~2,000 tokens the guide fits comfortably alongside the manifest (~200 tokens) and an entity list (~300 tokens for a 30-entity bundle). Total system prompt: ~2,500 tokens, leaving >190,000 tokens for tool call results in Claude's context window.

The context builder (`aiContext.js`) assembles this into a system prompt at request time so the LLM always has current entity IDs rather than stale cached data.

---

## File structure

```
viewer/src/editor/ai/
  aiContext.js          — assemble system prompt from OEBF-GUIDE.md + manifest + entity list
  aiTools.js            — Claude tool definitions (read_entity, write_entity, list_entities, …)
  aiAdapter.js          — Anthropic SDK wrapper: streaming, tool dispatch, error handling
  aiAgent.js            — agent loop: call LLM → dispatch tools → accumulate patches → return
  commandPalette.js     — modal UI: input, streaming response, diff view, confirm/reject
  commandPalette.css    — palette styles
  keyManager.js         — API key read/write in localStorage; key settings modal

viewer/src/editor/ai/__tests__/
  aiContext.test.js     — context assembly: correct token order, guide present, entity IDs match
  aiTools.test.js       — tool schema: correct names, required params, no unknown fields
  aiAgent.test.js       — agent loop with mock adapter: tool calls dispatched, patches accumulated
  commandPalette.test.js — UI: opens on Ctrl+K, accepts text, shows diff, confirm writes entities

viewer/editor.html      — add keyManager settings button; Ctrl+K handler
viewer/src/editor/editor.js — wire commandPalette init with adapter + _modelState access
```

**Files modified** (not created):

- `viewer/editor.html` — add key settings button in toolbar; add `<div id="ai-palette-root">`
- `viewer/src/editor/editor.js` — import and init `CommandPalette` after bundle load; pass `adapter`
- `viewer/package.json` — add `@anthropic-ai/sdk`

---

## Phase 1 — Foundation: context builder and tool library

### Task 1: Install Anthropic SDK

**Files:**
- Modify: `viewer/package.json`

- [ ] **Step 1: Install SDK**

```bash
cd viewer && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Verify install**

```bash
cd viewer && node -e "import('@anthropic-ai/sdk').then(m => console.log('ok', Object.keys(m)))"
```

Expected: prints `ok` followed by exported names.

- [ ] **Step 3: Commit**

```bash
git add viewer/package.json viewer/package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

### Task 2: AI context builder

**Files:**
- Create: `viewer/src/editor/ai/aiContext.js`
- Create: `viewer/src/editor/ai/__tests__/aiContext.test.js`

The context builder reads OEBF-GUIDE.md and the bundle manifest from the storage adapter, then produces a string suitable for use as an LLM system prompt.

- [ ] **Step 1: Write the failing test**

```javascript
// viewer/src/editor/ai/__tests__/aiContext.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSystemPrompt } from '../aiContext.js';

const fakeAdapter = {
  async readJson(path) {
    if (path === 'manifest.json') {
      return { project_name: 'Test House', format_version: '0.1.0', units: 'mm' };
    }
    if (path === 'model.json') {
      return {
        elements: ['element-wall-01', 'element-wall-02'],
        junctions: ['junction-j01'],
        arrays: [],
      };
    }
    throw new Error(`unexpected path: ${path}`);
  },
  async readText(path) {
    if (path === 'OEBF-GUIDE.md') return '# OEBF Guide\n\nTest content.';
    throw new Error(`unexpected path: ${path}`);
  },
};

describe('buildSystemPrompt', () => {
  it('includes guide content', async () => {
    const prompt = await buildSystemPrompt(fakeAdapter);
    expect(prompt).toContain('# OEBF Guide');
  });

  it('includes project name from manifest', async () => {
    const prompt = await buildSystemPrompt(fakeAdapter);
    expect(prompt).toContain('Test House');
  });

  it('includes entity IDs', async () => {
    const prompt = await buildSystemPrompt(fakeAdapter);
    expect(prompt).toContain('element-wall-01');
    expect(prompt).toContain('junction-j01');
  });

  it('returns a string', async () => {
    const prompt = await buildSystemPrompt(fakeAdapter);
    expect(typeof prompt).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- aiContext
```

Expected: FAIL — `aiContext.js` not found.

- [ ] **Step 3: Implement aiContext.js**

```javascript
// viewer/src/editor/ai/aiContext.js

/**
 * Assemble the system prompt for an AI agent editing an OEBF bundle.
 * @param {object} adapter — storage adapter (FsaAdapter or MemoryAdapter)
 * @returns {Promise<string>} system prompt string
 */
export async function buildSystemPrompt(adapter) {
  const [guide, manifest, model] = await Promise.all([
    adapter.readText('OEBF-GUIDE.md'),
    adapter.readJson('manifest.json'),
    adapter.readJson('model.json'),
  ]);

  const entitySummary = _summariseEntities(model);

  return [
    guide,
    '',
    '---',
    '',
    `## Current project: ${manifest.project_name}`,
    `Format version: ${manifest.format_version}`,
    `Units: ${manifest.units ?? 'mm'}`,
    '',
    '## Entities in this bundle',
    entitySummary,
    '',
    '---',
    '',
    'When editing this bundle:',
    '- Always call read_entity before writing an entity you have not yet read.',
    '- Never invent IDs. Use list_entities to discover existing IDs.',
    '- Include $schema as the first field of every entity you write.',
    '- After writing, add the entity ID to model.json using write_entity if registration is required.',
    '- Do not modify manifest.json or OEBF-GUIDE.md.',
  ].join('\n');
}

function _summariseEntities(model) {
  const sections = [];
  const types = ['elements', 'slabs', 'junctions', 'arrays', 'grids', 'objects', 'openings', 'groups'];
  for (const t of types) {
    const ids = model[t];
    if (ids?.length) sections.push(`${t}: ${ids.join(', ')}`);
  }
  return sections.length ? sections.join('\n') : '(empty bundle)';
}
```

Note: `readText` is not yet on all adapters. It will be added in Task 3.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd viewer && npm test -- aiContext
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/aiContext.js viewer/src/editor/ai/__tests__/aiContext.test.js
git commit -m "feat(ai): context builder — assemble system prompt from OEBF-GUIDE.md + manifest"
```

---

### Task 3: Add `readText` to storage adapters

**Files:**
- Modify: `viewer/src/editor/storageAdapter.js`
- Modify: `viewer/src/editor/ai/__tests__/aiContext.test.js` (update to use real adapter shape)

The existing adapters expose `readJson` but not `readText`. OEBF-GUIDE.md is a markdown file, not JSON.

- [ ] **Step 1: Read storageAdapter.js**

Read `viewer/src/editor/storageAdapter.js` to understand the existing interface before editing.

- [ ] **Step 2: Add `readText` to FsaAdapter**

In `storageAdapter.js`, add `readText(path)` to `FsaAdapter`:

```javascript
async readText(path) {
  const parts = path.split('/');
  let handle = this._root;
  for (const part of parts.slice(0, -1)) {
    handle = await handle.getDirectoryHandle(part, { create: false });
  }
  const fileHandle = await handle.getFileHandle(parts.at(-1), { create: false });
  const file = await fileHandle.getFile();
  return file.text();
}
```

- [ ] **Step 3: Add `readText` to MemoryAdapter**

In `storageAdapter.js`, add `readText(path)` to `MemoryAdapter`:

```javascript
async readText(path) {
  const value = this._map.get(path);
  if (value === undefined) throw new Error(`readText: not found: ${path}`);
  return value;
}
```

- [ ] **Step 4: Run aiContext tests to verify they still pass**

```bash
cd viewer && npm test -- aiContext
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd viewer && npm test
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add viewer/src/editor/storageAdapter.js
git commit -m "feat(storage): add readText() to FsaAdapter and MemoryAdapter"
```

---

### Task 4: AI tool definitions

**Files:**
- Create: `viewer/src/editor/ai/aiTools.js`
- Create: `viewer/src/editor/ai/__tests__/aiTools.test.js`

Define the Claude tools the LLM can call when editing a bundle. Tools mirror the storage adapter interface.

- [ ] **Step 1: Write the failing tests**

```javascript
// viewer/src/editor/ai/__tests__/aiTools.test.js
import { describe, it, expect } from 'vitest';
import { AI_TOOLS, executeTool } from '../aiTools.js';

describe('AI_TOOLS schema', () => {
  it('has the required tool names', () => {
    const names = AI_TOOLS.map(t => t.name);
    expect(names).toContain('read_entity');
    expect(names).toContain('write_entity');
    expect(names).toContain('list_entities');
    expect(names).toContain('read_model_json');
    expect(names).toContain('write_model_json');
  });

  it('each tool has name, description, input_schema', () => {
    for (const tool of AI_TOOLS) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
      expect(tool.input_schema).toHaveProperty('type', 'object');
      expect(tool.input_schema).toHaveProperty('properties');
    }
  });

  it('read_entity requires path', () => {
    const t = AI_TOOLS.find(t => t.name === 'read_entity');
    expect(t.input_schema.required).toContain('path');
  });

  it('write_entity requires path and content', () => {
    const t = AI_TOOLS.find(t => t.name === 'write_entity');
    expect(t.input_schema.required).toContain('path');
    expect(t.input_schema.required).toContain('content');
  });
});

describe('executeTool', () => {
  const fakeAdapter = {
    async readJson(path) {
      if (path === 'elements/element-wall-01.json')
        return { $schema: 'oebf://schema/0.1/element', id: 'element-wall-01' };
      if (path === 'model.json') return { elements: ['element-wall-01'] };
      throw new Error(`not found: ${path}`);
    },
    async writeJson(path, data) { /* no-op */ },
    async listDir(path) {
      if (path === 'elements') return ['element-wall-01.json'];
      return [];
    },
  };

  it('read_entity returns JSON string', async () => {
    const result = await executeTool('read_entity', { path: 'elements/element-wall-01.json' }, fakeAdapter);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('element-wall-01');
  });

  it('list_entities returns filenames', async () => {
    const result = await executeTool('list_entities', { directory: 'elements' }, fakeAdapter);
    expect(result).toContain('element-wall-01.json');
  });

  it('read_model_json returns model', async () => {
    const result = await executeTool('read_model_json', {}, fakeAdapter);
    const parsed = JSON.parse(result);
    expect(parsed.elements).toContain('element-wall-01');
  });

  it('throws on unknown tool', async () => {
    await expect(executeTool('unknown_tool', {}, fakeAdapter)).rejects.toThrow('Unknown tool');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- aiTools
```

Expected: FAIL — `aiTools.js` not found.

- [ ] **Step 3: Implement aiTools.js**

```javascript
// viewer/src/editor/ai/aiTools.js

/**
 * Claude tool definitions for OEBF bundle editing.
 * Tool schemas use the Anthropic tool_use format.
 */
export const AI_TOOLS = [
  {
    name: 'read_entity',
    description: 'Read a single entity JSON file from the bundle. Returns the file content as a JSON string. Call this before writing an entity you have not yet inspected.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Bundle-relative path, e.g. "elements/element-wall-01.json"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_entity',
    description: 'Write a single entity JSON file to the bundle. The content must be valid JSON and must include "$schema" as the first field. Always read the entity first if it already exists.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Bundle-relative path, e.g. "elements/element-wall-01.json"',
        },
        content: {
          type: 'string',
          description: 'Full JSON content for the entity file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_entities',
    description: 'List the files in a bundle directory. Use to discover existing entity IDs before reading or referencing them.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Bundle-relative directory name, e.g. "elements", "paths", "profiles", "materials"',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'read_model_json',
    description: 'Read model.json — the entity registry and spatial hierarchy. Call this to understand which entities are registered before adding new ones.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'write_model_json',
    description: 'Write the full updated model.json. Always call read_model_json first, then modify only the fields you need to change, then write back the full object.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full JSON content for model.json.',
        },
      },
      required: ['content'],
    },
  },
];

/**
 * Execute a tool call from the LLM.
 * @param {string} name — tool name
 * @param {object} input — tool inputs
 * @param {object} adapter — storage adapter
 * @returns {Promise<string>} tool result as a string
 */
export async function executeTool(name, input, adapter) {
  switch (name) {
    case 'read_entity': {
      const data = await adapter.readJson(input.path);
      return JSON.stringify(data, null, 2);
    }
    case 'write_entity': {
      const data = JSON.parse(input.content);
      await adapter.writeJson(input.path, data);
      return `Written: ${input.path}`;
    }
    case 'list_entities': {
      const files = await adapter.listDir(input.directory);
      return files.join('\n');
    }
    case 'read_model_json': {
      const data = await adapter.readJson('model.json');
      return JSON.stringify(data, null, 2);
    }
    case 'write_model_json': {
      const data = JSON.parse(input.content);
      await adapter.writeJson('model.json', data);
      return 'Written: model.json';
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- aiTools
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/aiTools.js viewer/src/editor/ai/__tests__/aiTools.test.js
git commit -m "feat(ai): tool definitions and executor for OEBF bundle editing"
```

---

## Phase 2 — SDK adapter and agent loop

### Task 5: Anthropic SDK adapter

**Files:**
- Create: `viewer/src/editor/ai/aiAdapter.js`
- Create: `viewer/src/editor/ai/__tests__/aiAdapter.test.js`

Wraps `@anthropic-ai/sdk` to send messages with tool use and collect the agent's final text response and all tool calls made.

- [ ] **Step 1: Write the failing tests**

```javascript
// viewer/src/editor/ai/__tests__/aiAdapter.test.js
import { describe, it, expect, vi } from 'vitest';
import { AiAdapter } from '../aiAdapter.js';

// Minimal mock of Anthropic client
function makeMockClient(responses) {
  let callIndex = 0;
  return {
    messages: {
      async create(params) {
        const resp = responses[callIndex++];
        if (!resp) throw new Error('No more mock responses');
        return resp;
      },
    },
  };
}

describe('AiAdapter', () => {
  it('returns text reply when no tool use', async () => {
    const client = makeMockClient([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done, I updated the wall.' }],
      },
    ]);
    const adapter = new AiAdapter({ client });
    const result = await adapter.sendMessage('update the south wall', 'sys prompt', []);
    expect(result.text).toBe('Done, I updated the wall.');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('accumulates tool calls across turns', async () => {
    const client = makeMockClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me read the element.' },
          { type: 'tool_use', id: 'tu_1', name: 'read_entity', input: { path: 'elements/e.json' } },
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done.' }],
      },
    ]);
    const toolExecutor = vi.fn().mockResolvedValue('{"id":"e"}');
    const adapter = new AiAdapter({ client, toolExecutor });
    const result = await adapter.sendMessage('read the element', 'sys', []);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_entity');
    expect(toolExecutor).toHaveBeenCalledWith('read_entity', { path: 'elements/e.json' });
    expect(result.text).toBe('Done.');
  });

  it('throws after max tool call iterations', async () => {
    // Returns tool_use indefinitely
    const client = {
      messages: {
        async create() {
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tu_x', name: 'list_entities', input: { directory: 'elements' } }],
          };
        },
      },
    };
    const toolExecutor = vi.fn().mockResolvedValue('element-1.json');
    const adapter = new AiAdapter({ client, toolExecutor, maxIterations: 3 });
    await expect(adapter.sendMessage('loop', 'sys', [])).rejects.toThrow('max iterations');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- aiAdapter
```

Expected: FAIL — `aiAdapter.js` not found.

- [ ] **Step 3: Implement aiAdapter.js**

```javascript
// viewer/src/editor/ai/aiAdapter.js
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Wraps the Anthropic SDK to run a single agent turn.
 * Collects tool calls, dispatches them to toolExecutor, and returns
 * the final text reply together with a log of all tool calls.
 */
export class AiAdapter {
  /**
   * @param {object} opts
   * @param {object} [opts.client] — Anthropic client (for testing injection)
   * @param {string} [opts.apiKey]
   * @param {string} [opts.model]
   * @param {Function} [opts.toolExecutor] — async (name, input) => string
   * @param {number} [opts.maxIterations]
   */
  constructor({ client, apiKey, model, toolExecutor, maxIterations } = {}) {
    this._client = client ?? new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this._model = model ?? DEFAULT_MODEL;
    this._toolExecutor = toolExecutor ?? (() => Promise.resolve(''));
    this._maxIterations = maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }

  /**
   * Send a user message and run the agent loop until end_turn or max iterations.
   * @param {string} userMessage
   * @param {string} systemPrompt
   * @param {Array} tools — Claude tool definitions (AI_TOOLS array)
   * @returns {Promise<{ text: string, toolCalls: Array }>}
   */
  async sendMessage(userMessage, systemPrompt, tools) {
    const messages = [{ role: 'user', content: userMessage }];
    const toolCalls = [];
    let iterations = 0;

    while (true) {
      if (iterations >= this._maxIterations) {
        throw new Error(`AI agent exceeded max iterations (${this._maxIterations})`);
      }
      iterations++;

      const response = await this._client.messages.create({
        model: this._model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: systemPrompt,
        tools: tools.length ? tools : undefined,
        messages,
      });

      // Append assistant turn to conversation
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        return { text, toolCalls };
      }

      // Dispatch tool calls and build tool_result turn
      const toolResultBlocks = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await this._toolExecutor(block.name, block.input);
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        toolCalls.push({ name: block.name, input: block.input, result });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- aiAdapter
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/aiAdapter.js viewer/src/editor/ai/__tests__/aiAdapter.test.js
git commit -m "feat(ai): Anthropic SDK adapter with agent loop and tool dispatch"
```

---

### Task 6: Agent orchestrator

**Files:**
- Create: `viewer/src/editor/ai/aiAgent.js`
- Create: `viewer/src/editor/ai/__tests__/aiAgent.test.js`

Combines context builder, tools, and adapter into a single `runAgent(prompt, adapter)` call. Tracks which files were written (for diff display).

- [ ] **Step 1: Write the failing tests**

```javascript
// viewer/src/editor/ai/__tests__/aiAgent.test.js
import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../aiAgent.js';

function fakeAdapterWithWrites() {
  const written = {};
  return {
    written,
    async readText(path) {
      if (path === 'OEBF-GUIDE.md') return '# Guide';
      throw new Error(`no text: ${path}`);
    },
    async readJson(path) {
      if (path === 'manifest.json') return { project_name: 'Test', format_version: '0.1.0' };
      if (path === 'model.json') return { elements: ['element-wall-01'] };
      if (path === 'elements/element-wall-01.json')
        return { $schema: 'oebf://schema/0.1/element', id: 'element-wall-01', description: 'old' };
      throw new Error(`no json: ${path}`);
    },
    async writeJson(path, data) { written[path] = data; },
    async listDir() { return []; },
  };
}

describe('runAgent', () => {
  it('returns text and patches on success', async () => {
    const adapter = fakeAdapterWithWrites();
    // Mock the AiAdapter to simulate a write_entity call then end_turn
    const mockAdapterClass = vi.fn().mockImplementation(() => ({
      sendMessage: vi.fn().mockResolvedValue({
        text: 'Updated the wall description.',
        toolCalls: [
          {
            name: 'write_entity',
            input: {
              path: 'elements/element-wall-01.json',
              content: JSON.stringify({ $schema: 'oebf://schema/0.1/element', id: 'element-wall-01', description: 'new' }),
            },
            result: 'Written: elements/element-wall-01.json',
          },
        ],
      }),
    }));

    const result = await runAgent('update wall description', adapter, { AiAdapterClass: mockAdapterClass });
    expect(result.text).toBe('Updated the wall description.');
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].path).toBe('elements/element-wall-01.json');
  });

  it('returns empty patches when LLM makes no writes', async () => {
    const adapter = fakeAdapterWithWrites();
    const mockAdapterClass = vi.fn().mockImplementation(() => ({
      sendMessage: vi.fn().mockResolvedValue({
        text: 'The south wall is 4.5m long.',
        toolCalls: [],
      }),
    }));

    const result = await runAgent('how long is the south wall?', adapter, { AiAdapterClass: mockAdapterClass });
    expect(result.text).toBeTruthy();
    expect(result.patches).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- aiAgent
```

Expected: FAIL.

- [ ] **Step 3: Implement aiAgent.js**

```javascript
// viewer/src/editor/ai/aiAgent.js
import { buildSystemPrompt } from './aiContext.js';
import { AI_TOOLS, executeTool } from './aiTools.js';
import { AiAdapter } from './aiAdapter.js';

/**
 * Run the AI agent for one user request against the open bundle.
 *
 * @param {string} prompt — user's natural language request
 * @param {object} adapter — storage adapter (FsaAdapter or MemoryAdapter)
 * @param {object} [opts]
 * @param {string} [opts.apiKey] — Anthropic API key (from localStorage)
 * @param {string} [opts.model] — model override
 * @param {Function} [opts.AiAdapterClass] — for testing injection
 * @returns {Promise<{ text: string, patches: Array<{ path: string, before: any, after: any }> }>}
 */
export async function runAgent(prompt, adapter, opts = {}) {
  const { apiKey, model, AiAdapterClass = AiAdapter } = opts;

  // Intercept writes to track patches
  const patches = [];
  const patchingAdapter = _wrapAdapterForPatching(adapter, patches);

  // Build context
  const systemPrompt = await buildSystemPrompt(adapter);

  // Create tool executor bound to the patching adapter
  const toolExecutor = (name, input) => executeTool(name, input, patchingAdapter);

  // Run agent
  const aiAdapter = new AiAdapterClass({ apiKey, model, toolExecutor });
  const { text, toolCalls } = await aiAdapter.sendMessage(prompt, systemPrompt, AI_TOOLS);

  // Extract patches from write tool calls
  const writePatchesFromCalls = toolCalls
    .filter(tc => tc.name === 'write_entity' || tc.name === 'write_model_json')
    .map(tc => {
      const path = tc.input.path ?? 'model.json';
      return patches.find(p => p.path === path) ?? { path, before: null, after: JSON.parse(tc.input.content) };
    });

  return { text, patches: writePatchesFromCalls };
}

/**
 * Wrap the adapter to intercept writes and record before/after state.
 */
function _wrapAdapterForPatching(adapter, patches) {
  return {
    ...adapter,
    async writeJson(path, data) {
      let before = null;
      try { before = await adapter.readJson(path); } catch (_) { /* new file */ }
      await adapter.writeJson(path, data);
      patches.push({ path, before, after: data });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- aiAgent
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/aiAgent.js viewer/src/editor/ai/__tests__/aiAgent.test.js
git commit -m "feat(ai): agent orchestrator — combines context + tools + adapter into runAgent()"
```

---

## Phase 3 — Command palette UI

### Task 7: Key manager

**Files:**
- Create: `viewer/src/editor/ai/keyManager.js`
- Create: `viewer/src/editor/ai/__tests__/keyManager.test.js`

Manages the Anthropic API key in `localStorage`. Provides a minimal settings modal for the user to enter/clear their key.

- [ ] **Step 1: Write the failing tests**

```javascript
// viewer/src/editor/ai/__tests__/keyManager.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { KeyManager } from '../keyManager.js';

// jsdom provides localStorage
describe('KeyManager', () => {
  let km;

  beforeEach(() => {
    localStorage.clear();
    km = new KeyManager();
  });

  it('returns null when no key stored', () => {
    expect(km.getKey()).toBeNull();
  });

  it('stores and retrieves a key', () => {
    km.setKey('sk-ant-test-123');
    expect(km.getKey()).toBe('sk-ant-test-123');
  });

  it('clears key', () => {
    km.setKey('sk-ant-test-123');
    km.clearKey();
    expect(km.getKey()).toBeNull();
  });

  it('hasKey() returns correct boolean', () => {
    expect(km.hasKey()).toBe(false);
    km.setKey('sk-ant-test-123');
    expect(km.hasKey()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- keyManager
```

Expected: FAIL.

- [ ] **Step 3: Implement keyManager.js**

```javascript
// viewer/src/editor/ai/keyManager.js

const STORAGE_KEY = 'oebf-ai-api-key';

export class KeyManager {
  getKey() {
    return localStorage.getItem(STORAGE_KEY);
  }

  setKey(key) {
    localStorage.setItem(STORAGE_KEY, key);
  }

  clearKey() {
    localStorage.removeItem(STORAGE_KEY);
  }

  hasKey() {
    return this.getKey() !== null;
  }

  /**
   * Show a modal prompting the user to enter their Anthropic API key.
   * Resolves with true if key was saved, false if cancelled.
   * @returns {Promise<boolean>}
   */
  promptForKey() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ai-key-overlay';
      overlay.innerHTML = `
        <div class="ai-key-modal">
          <h3>Anthropic API key</h3>
          <p>Your key is stored locally in your browser and never sent to any server other than Anthropic's API.</p>
          <input type="password" id="ai-key-input" placeholder="sk-ant-…" value="${this.getKey() ?? ''}" />
          <div class="ai-key-buttons">
            <button id="ai-key-save">Save</button>
            <button id="ai-key-cancel">Cancel</button>
            ${this.hasKey() ? '<button id="ai-key-clear">Clear key</button>' : ''}
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#ai-key-input');
      input.focus();

      overlay.querySelector('#ai-key-save').addEventListener('click', () => {
        const val = input.value.trim();
        if (val) {
          this.setKey(val);
          document.body.removeChild(overlay);
          resolve(true);
        }
      });

      overlay.querySelector('#ai-key-cancel').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });

      overlay.querySelector('#ai-key-clear')?.addEventListener('click', () => {
        this.clearKey();
        document.body.removeChild(overlay);
        resolve(false);
      });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- keyManager
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/keyManager.js viewer/src/editor/ai/__tests__/keyManager.test.js
git commit -m "feat(ai): key manager — store Anthropic API key in localStorage with modal UI"
```

---

### Task 8: Command palette component

**Files:**
- Create: `viewer/src/editor/ai/commandPalette.js`
- Create: `viewer/src/editor/ai/commandPalette.css`
- Create: `viewer/src/editor/ai/__tests__/commandPalette.test.js`

The main UI component: a modal triggered by Ctrl+K that accepts a prompt, streams the LLM response, shows a diff of proposed writes, and requires the user to confirm or reject before changes are applied.

- [ ] **Step 1: Write the failing tests**

```javascript
// viewer/src/editor/ai/__tests__/commandPalette.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandPalette } from '../commandPalette.js';

// Minimal DOM setup
function makeRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

describe('CommandPalette', () => {
  let root;

  beforeEach(() => { root = makeRoot(); });
  afterEach(() => { document.body.removeChild(root); });

  it('renders input when opened', () => {
    const cp = new CommandPalette({ root, runAgent: vi.fn(), keyManager: { hasKey: () => true, promptForKey: vi.fn() } });
    cp.open();
    expect(root.querySelector('input[type="text"]')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const cp = new CommandPalette({ root, runAgent: vi.fn(), keyManager: { hasKey: () => true, promptForKey: vi.fn() } });
    cp.open();
    expect(cp.isOpen()).toBe(true);
    root.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cp.isOpen()).toBe(false);
  });

  it('prompts for key if none set', async () => {
    const promptForKey = vi.fn().mockResolvedValue(false);
    const cp = new CommandPalette({
      root,
      runAgent: vi.fn(),
      keyManager: { hasKey: () => false, promptForKey },
    });
    cp.open();
    const input = root.querySelector('input');
    input.value = 'add a wall';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(promptForKey).toHaveBeenCalled();
  });

  it('shows diff when agent returns patches', async () => {
    const runAgent = vi.fn().mockResolvedValue({
      text: 'Done.',
      patches: [{ path: 'elements/e.json', before: { id: 'e', desc: 'old' }, after: { id: 'e', desc: 'new' } }],
    });
    const cp = new CommandPalette({ root, runAgent, keyManager: { hasKey: () => true, getKey: () => 'sk-test' } });
    cp.open();
    const input = root.querySelector('input');
    input.value = 'update wall';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    expect(root.querySelector('.ai-diff')).toBeTruthy();
    expect(root.querySelector('.ai-confirm-btn')).toBeTruthy();
  });

  it('reject restores original entity content', async () => {
    const writes = {};
    const mockAdapter = {
      async writeJson(path, data) { writes[path] = data; },
    };
    const beforeData = { id: 'e', desc: 'original' };
    const runAgent = vi.fn().mockResolvedValue({
      text: 'Done.',
      patches: [{ path: 'elements/e.json', before: beforeData, after: { id: 'e', desc: 'new' } }],
    });
    const cp = new CommandPalette({
      root,
      runAgent,
      keyManager: { hasKey: () => true, getKey: () => 'sk-test' },
      adapter: mockAdapter,
    });
    cp.open();
    const input = root.querySelector('input');
    input.value = 'update wall';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    // Click reject
    root.querySelector('.ai-reject-btn').click();
    await new Promise(r => setTimeout(r, 0));
    expect(writes['elements/e.json']).toEqual(beforeData);
    expect(cp.isOpen()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- commandPalette
```

Expected: FAIL.

- [ ] **Step 3: Implement commandPalette.js**

```javascript
// viewer/src/editor/ai/commandPalette.js

/**
 * CommandPalette — Ctrl+K triggered AI editing modal for OEBF editor.
 *
 * Usage:
 *   const cp = new CommandPalette({ root, runAgent, keyManager, adapter });
 *   document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'k') cp.open(); });
 */
export class CommandPalette {
  constructor({ root, runAgent, keyManager, adapter }) {
    this._root = root;
    this._runAgent = runAgent;
    this._keyManager = keyManager;
    this._adapter = adapter;
    this._open = false;
    this._pendingPatches = null;
    this._el = null;
  }

  isOpen() { return this._open; }

  open() {
    if (this._open) return;
    this._open = true;
    this._render();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._el?.remove();
    this._el = null;
    this._pendingPatches = null;
  }

  _render() {
    const el = document.createElement('div');
    el.className = 'ai-palette-overlay';
    el.innerHTML = `
      <div class="ai-palette">
        <input type="text" class="ai-palette-input" placeholder="Ask AI to edit this bundle… (Escape to close)" autocomplete="off" />
        <div class="ai-palette-status"></div>
        <div class="ai-palette-response"></div>
      </div>
    `;
    this._root.appendChild(el);
    this._el = el;

    const input = el.querySelector('.ai-palette-input');
    input.focus();

    input.addEventListener('keydown', async e => {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key !== 'Enter') return;
      const prompt = input.value.trim();
      if (!prompt) return;
      await this._submit(prompt, input);
    });
  }

  async _submit(prompt, input) {
    const status = this._el.querySelector('.ai-palette-status');
    const response = this._el.querySelector('.ai-palette-response');

    // Ensure API key
    if (!this._keyManager.hasKey()) {
      const saved = await this._keyManager.promptForKey();
      if (!saved) return;
    }

    input.disabled = true;
    status.textContent = 'Thinking…';
    response.innerHTML = '';

    try {
      const result = await this._runAgent(prompt, this._adapter, {
        apiKey: this._keyManager.getKey(),
      });

      status.textContent = result.patches.length
        ? `${result.patches.length} change(s) proposed — review below`
        : 'No changes proposed.';

      response.innerHTML = `<p class="ai-reply">${_escapeHtml(result.text)}</p>`;

      if (result.patches.length) {
        this._pendingPatches = result.patches;
        response.appendChild(this._renderDiff(result.patches));
        response.appendChild(this._renderConfirmButtons());
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      input.disabled = false;
    }
  }

  _renderDiff(patches) {
    const container = document.createElement('div');
    container.className = 'ai-diff';
    for (const patch of patches) {
      const section = document.createElement('details');
      section.open = true;
      section.innerHTML = `<summary class="ai-diff-path">${_escapeHtml(patch.path)}</summary>`;
      const pre = document.createElement('pre');
      pre.className = 'ai-diff-content';
      pre.textContent = _simpleDiff(patch.before, patch.after);
      section.appendChild(pre);
      container.appendChild(section);
    }
    return container;
  }

  _renderConfirmButtons() {
    const bar = document.createElement('div');
    bar.className = 'ai-confirm-bar';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'ai-confirm-btn';
    confirmBtn.textContent = 'Apply changes';
    confirmBtn.addEventListener('click', () => this._confirm());

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'ai-reject-btn';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => this._reject());

    bar.appendChild(confirmBtn);
    bar.appendChild(rejectBtn);
    return bar;
  }

  async _confirm() {
    if (!this._pendingPatches) return;
    // Patches were already written to the adapter by runAgent during tool execution.
    // Signal to caller that bundle was modified and the scene should reload.
    this._el?.dispatchEvent(new CustomEvent('ai-bundle-changed', {
      bubbles: true,
      detail: { paths: this._pendingPatches.map(p => p.path) },
    }));
    this.close();
  }

  async _reject() {
    if (this._pendingPatches) {
      // Restore pre-AI state for every modified entity. Skip new files (before === null).
      for (const patch of this._pendingPatches) {
        if (patch.before !== null) {
          await this._adapter.writeJson(patch.path, patch.before);
        }
      }
    }
    this.close();
  }
}

// --- Utilities ---

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _simpleDiff(before, after) {
  const beforeLines = (before ? JSON.stringify(before, null, 2) : '(new file)').split('\n');
  const afterLines = JSON.stringify(after, null, 2).split('\n');
  const lines = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i] ?? '';
    const a = afterLines[i] ?? '';
    if (b !== a) {
      if (b) lines.push(`- ${b}`);
      if (a) lines.push(`+ ${a}`);
    } else {
      lines.push(`  ${a}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Create commandPalette.css**

```css
/* viewer/src/editor/ai/commandPalette.css */

.ai-palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.ai-palette {
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 8px;
  width: min(680px, 90vw);
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px;
  font-family: inherit;
  color: #ccc;
}

.ai-palette-input {
  width: 100%;
  box-sizing: border-box;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 4px;
  color: #eee;
  font-size: 14px;
  padding: 8px 10px;
  outline: none;
}

.ai-palette-input:focus { border-color: #888; }

.ai-palette-status {
  font-size: 12px;
  color: #888;
  margin: 6px 0;
  min-height: 16px;
}

.ai-reply {
  font-size: 13px;
  margin: 0 0 8px;
  line-height: 1.5;
}

.ai-diff {
  font-size: 12px;
  margin-top: 8px;
}

.ai-diff-path {
  color: #aaa;
  cursor: pointer;
  padding: 4px 0;
}

.ai-diff-content {
  background: #151515;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  white-space: pre;
  font-size: 11px;
  line-height: 1.4;
}

.ai-diff-content {
  /* Colour added/removed lines */
  color: #ccc;
}

.ai-confirm-bar {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.ai-confirm-btn, .ai-reject-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 13px;
}

.ai-confirm-btn { background: #2e7d32; color: #fff; }
.ai-confirm-btn:hover { background: #388e3c; }
.ai-reject-btn { background: #444; color: #ccc; }
.ai-reject-btn:hover { background: #555; }

/* API key modal */
.ai-key-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-key-modal {
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 24px;
  width: min(420px, 90vw);
  color: #ccc;
  font-family: inherit;
}

.ai-key-modal h3 { margin: 0 0 8px; font-size: 15px; color: #eee; }
.ai-key-modal p { font-size: 12px; color: #888; margin: 0 0 12px; }

.ai-key-modal input {
  width: 100%;
  box-sizing: border-box;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 4px;
  color: #eee;
  font-size: 13px;
  padding: 7px 9px;
  outline: none;
  margin-bottom: 12px;
}

.ai-key-buttons { display: flex; gap: 8px; }

.ai-key-buttons button {
  padding: 6px 14px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 13px;
}

#ai-key-save { background: #1565c0; color: #fff; }
#ai-key-save:hover { background: #1976d2; }
#ai-key-cancel { background: #444; color: #ccc; }
#ai-key-cancel:hover { background: #555; }
#ai-key-clear { background: #b71c1c; color: #fff; margin-left: auto; }
#ai-key-clear:hover { background: #c62828; }
```

- [ ] **Step 5: Run palette tests**

```bash
cd viewer && npm test -- commandPalette
```

Expected: PASS (4 tests).

- [ ] **Step 6: Run full suite**

```bash
cd viewer && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add viewer/src/editor/ai/commandPalette.js viewer/src/editor/ai/commandPalette.css \
        viewer/src/editor/ai/__tests__/commandPalette.test.js
git commit -m "feat(ai): command palette modal — input, streaming, diff preview, confirm/reject"
```

---

## Phase 4 — Editor integration

### Task 9: Wire command palette into editor

**Files:**
- Modify: `viewer/src/editor/editor.js`
- Modify: `viewer/editor.html`

Connect the command palette to the live editor session. The palette needs access to the active `adapter`, the `runAgent` function, and the `KeyManager`. On `ai-bundle-changed` event, trigger a full bundle reload so the 3D scene reflects the AI's edits.

- [ ] **Step 1: Read editor.js and editor.html**

Read `viewer/src/editor/editor.js` (first 100 lines) and `viewer/editor.html` to understand the existing init pattern before editing.

- [ ] **Step 2: Import AI modules in editor.js**

At the top of `viewer/src/editor/editor.js`, add:

```javascript
import { CommandPalette } from './ai/commandPalette.js';
import { KeyManager } from './ai/keyManager.js';
import { runAgent } from './ai/aiAgent.js';
import './ai/commandPalette.css';
```

- [ ] **Step 3: Init command palette after bundle load**

In `editor.js`, find the point where the bundle finishes loading (after `_loadAndRenderBundle` succeeds) and add:

```javascript
// Initialise AI command palette
const _keyManager = new KeyManager();
const _paletteRoot = document.getElementById('ai-palette-root');
const _palette = new CommandPalette({
  root: _paletteRoot,
  runAgent,
  keyManager: _keyManager,
  adapter,
});

// Listen for ai-bundle-changed and reload the scene
_paletteRoot.addEventListener('ai-bundle-changed', async () => {
  await _loadAndRenderBundle(adapter);
});

// Ctrl+K shortcut — open palette if a bundle is loaded
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    if (adapter) _palette.open();
  }
});
```

- [ ] **Step 4: Add palette root div and API key button to editor.html**

In `viewer/editor.html`, add:

```html
<!-- AI palette root (managed by CommandPalette) -->
<div id="ai-palette-root"></div>
```

In the editor toolbar, add an API key settings button:

```html
<button id="ai-key-btn" title="AI settings (API key)" class="toolbar-btn">AI key</button>
```

Wire in editor.js after `_keyManager` is initialised:

```javascript
document.getElementById('ai-key-btn')?.addEventListener('click', () => _keyManager.promptForKey());
```

- [ ] **Step 5: Build and smoke test**

```bash
cd viewer && npm run build
```

Open `https://architools.drawingtable.net/oebf/editor.html`, load a bundle, press Ctrl+K. Verify the palette opens and accepts input.

- [ ] **Step 6: Run full test suite**

```bash
cd viewer && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add viewer/src/editor/editor.js viewer/editor.html
git commit -m "feat(ai): wire command palette into editor — Ctrl+K, bundle reload on confirm"
```

---

## Phase 5 — Schema validation gate (safety)

### Task 10: Validate writes before applying patches

**Files:**
- Modify: `viewer/src/editor/ai/aiTools.js`
- Modify: `viewer/src/editor/ai/__tests__/aiTools.test.js`

Before writing a JSON entity, validate it against its declared `$schema`. This prevents the LLM from writing structurally invalid entities into the bundle. Uses `ajv` (already present in the project for spec tests).

- [ ] **Step 1: Read existing schema usage**

Check `viewer/src/` for existing `ajv` usage to understand how schemas are loaded:

```bash
grep -r 'ajv\|validate\|schema' viewer/src/ --include='*.js' -l
```

- [ ] **Step 2: Add validation to write_entity in aiTools.js**

Extend `executeTool` to validate before writing:

```javascript
case 'write_entity': {
  const data = JSON.parse(input.content);
  // Attempt schema validation if schema is available in bundle
  const schemaId = data.$schema;
  if (schemaId) {
    const schemaError = await _validateEntity(data, schemaId, adapter);
    if (schemaError) {
      return `Validation error (write rejected): ${schemaError}. Fix the entity and try again.`;
    }
  }
  await adapter.writeJson(input.path, data);
  return `Written: ${input.path}`;
}
```

Add helper:

```javascript
async function _validateEntity(data, schemaId, adapter) {
  // schemaId format: "oebf://schema/0.1/element" → schema file: "schema/element.schema.json"
  const typeName = schemaId.split('/').at(-1);
  let schema;
  try {
    schema = await adapter.readJson(`schema/${typeName}.schema.json`);
  } catch (_) {
    return null; // Schema not present in bundle — skip validation
  }
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile(schema);
  if (validate(data)) return null;
  return ajv.errorsText(validate.errors);
}
```

- [ ] **Step 3: Add a test for validation rejection**

```javascript
// Add to aiTools.test.js
it('write_entity rejects invalid entity and returns error string', async () => {
  const validatingAdapter = {
    ...fakeAdapter,
    async readJson(path) {
      if (path === 'schema/element.schema.json') {
        return {
          type: 'object',
          required: ['$schema', 'id', 'type'],
          properties: {
            $schema: { type: 'string' },
            id: { type: 'string' },
            type: { type: 'string', enum: ['Element'] },
          },
          additionalProperties: true,
        };
      }
      return fakeAdapter.readJson(path);
    },
    writeJson: vi.fn(),
  };

  const result = await executeTool(
    'write_entity',
    {
      path: 'elements/element-bad.json',
      content: JSON.stringify({ $schema: 'oebf://schema/0.1/element', id: 123, type: 'Element' }),
    },
    validatingAdapter,
  );
  expect(result).toContain('Validation error');
  expect(validatingAdapter.writeJson).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests**

```bash
cd viewer && npm test -- aiTools
```

Expected: PASS (all + new validation test).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/ai/aiTools.js viewer/src/editor/ai/__tests__/aiTools.test.js
git commit -m "feat(ai): schema validation gate on write_entity — rejects invalid entities"
```

---

## Phase 6 — Polish and model selector (future, not Phase 5 blocking)

These items are lower priority and can follow after Phase 4 is deployed and tested in practice.

### Task 11: Model selector in palette

Add a `<select>` in the palette UI for choosing the Claude model. Options: `claude-sonnet-4-6` (default), `claude-opus-4-6` (more capable, slower), `claude-haiku-4-5-20251001` (fast, simple tasks). Persist selection in `localStorage` under `oebf-ai-model`.

**Input:** Working Phase 4 palette.
**Output:** Model dropdown visible in palette footer; selected model passed to `runAgent` opts.
**Success:** User can switch models; selection persists across page refreshes.

---

### Task 12: Scene tree right-click "Ask AI…"

Add a context menu item to the scene tree. When triggered, pre-populate the palette input with the selected entity ID and type as context (`"About element-wall-south-gf (IfcWall): …"`). The context builder includes the full entity JSON in the system prompt when a specific entity is focused.

**Input:** Working Phase 4 palette; scene tree right-click handler in `editor.js`.
**Output:** Right-clicking a scene tree item shows "Ask AI about this…"; opens palette with prefilled context.
**Success:** LLM receives the selected entity's full JSON in its context without needing a `read_entity` call.

---

### Task 13: MCP server package (`oebf-mcp`)

Create a standalone Node.js package (`packages/oebf-mcp/`) that exposes the same tool library over the Model Context Protocol (stdio transport). Allows external agents (Claude Desktop, CI scripts) to read and edit `.oebf` bundles from the command line.

```bash
npx oebf-mcp --bundle ./terraced-house.oebf
# Starts MCP server on stdio; client can call read_entity, write_entity, etc.
```

**Input:** `aiTools.js` tool definitions; `storageAdapter.js` (Node.js filesystem adapter).
**Output:** `packages/oebf-mcp/` package; README; published to npm under `@oebf/mcp`.
**Success:** MCP-compatible client can read and write entities in a local bundle.

---

## Risks and constraints

### Browser-to-Anthropic CORS

The Anthropic API supports CORS for browser-side requests when using `dangerouslyAllowBrowser: true` in the SDK. This flag suppresses the SDK's warning about accidentally exposing server-side keys in browser code. It is the correct and documented approach for user-supplied API key scenarios. The user's key is stored in `localStorage` — it never touches the OEBF server.

**Risk:** Anthropic could tighten CORS policy in future.
**Mitigation:** Add an optional `proxyUrl` setting in `keyManager` that allows users to route requests through a self-hosted proxy — this is a one-line change to the `AiAdapter` constructor.

### Context window budget

OEBF-GUIDE.md (~2,000 tokens) + manifest (~200) + entity list (~300 for 30 entities) = ~2,500 tokens system prompt. An agent handling a 100-entity bundle may hit 1,500 tokens on the entity list alone.

**Mitigation:** The context builder truncates the entity list to 50 entries and appends `… (N more, use list_entities to see all)` when the bundle is large. The LLM can always call `list_entities` to discover IDs on demand.

### Write conflicts and undo

`runAgent` writes directly to the storage adapter during tool execution. If the user rejects the diff, changes have already been applied to the in-memory or on-disk bundle.

**Mitigation (Phase 4 implementation):** The `_wrapAdapterForPatching` wrapper in `aiAgent.js` records `before` snapshots. On rejection (instead of `this.close()`), the palette iterates patches and calls `adapter.writeJson(patch.path, patch.before)` to restore original state, then closes.

This should be implemented in the `_confirm` / reject flow during Task 8 step 3.

### LLM hallucinated IDs

The LLM may reference entity IDs that do not exist (e.g. `profile-cavity-100` when only `profile-cavity-250` exists). The `read_entity` tool will return an error string; the LLM typically recovers by calling `list_entities` and retrying with a correct ID.

**Mitigation:** The context builder always includes current entity IDs. The rejection message from a failed `readJson` is returned as the tool result, prompting the LLM to self-correct.

### Model reasoning about SVG profiles

Profile geometry is defined in SVG files (`profile-{id}.svg`), not JSON. The current tool library has no `read_svg` tool.

**Phase 5 scope:** AI edits to profile geometry are out of scope. The LLM can create a new profile JSON referencing an existing SVG but cannot generate or modify SVG files. A `list_profiles` tool returning profile IDs and their `assembly[]` JSON (without SVG content) is sufficient for most use cases.

---

## Success criteria per phase

| Phase | Input | Output | Verification |
|---|---|---|---|
| 1 — Foundation | Empty `ai/` directory | `aiContext.js`, `storageAdapter.js` (+`readText`), `aiTools.js` with passing tests | `npm test -- aiContext aiTools` — all pass |
| 2 — SDK adapter + agent loop | Phase 1 complete | `aiAdapter.js`, `aiAgent.js` with passing tests | `npm test -- aiAdapter aiAgent` — all pass |
| 3 — Palette UI | Phase 2 complete | `commandPalette.js`, `commandPalette.css`, `keyManager.js` with passing tests | `npm test -- commandPalette keyManager` — all pass |
| 4 — Integration | Phase 3 complete | `editor.js` + `editor.html` wired up; Ctrl+K opens palette | Manual: load bundle, Ctrl+K, type prompt, see response + diff (no unit test for wiring) |
| 5 — Validation | Phase 4 complete | Schema gate in `write_entity` rejects bad entities | `npm test -- aiTools` — validation rejection test passes |
| 6 — Polish | Phase 5 complete | Model selector, right-click context, MCP server | Model selector persists; MCP server responds to Claude Desktop |

---

## Dependency on Issue #22

OEBF-GUIDE.md is already present in `spec/OEBF-GUIDE-template.md` and embedded in the example bundle. However, Issue #22 (OEBF-GUIDE.md finalisation) tracks adding the guide to every newly-created bundle and verifying its completeness for v0.3 entities (Slab, Object, Opening, Array, Grid — currently missing from the guide's worked examples).

Phase 1 of this plan works with the current guide template. The AI integration is more useful after #22 is complete because the guide will accurately cover all entity types the LLM may need to create or modify.

**Recommended:** Complete Issue #22 before or alongside Phase 3 (editor integration).
