// Export an OEBF bundle directory to IFC with the viewer's own exporter (viewer/src/ifc/ifcExporter.js), for
// test_browser_export_198.py to measure through IfcOpenShell. Usage: node export_with_browser_exporter.mjs <bundle> <out.ifc>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { exportBundleToIfc } = await import(pathToFileURL(join(here, '../../viewer/src/ifc/ifcExporter.js')).href);
const [bundle, out] = process.argv.slice(2);
const adapter = { async readJson(path) { return JSON.parse(readFileSync(join(bundle, path), 'utf8')); } };
writeFileSync(out, await exportBundleToIfc(adapter));
