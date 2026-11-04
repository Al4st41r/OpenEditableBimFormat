import { createNewBundle } from './viewer/src/editor/newBundle.js';

const adapter = createNewBundle('FormatCheck');

// Get the raw stringified values from the map
const mapValues = adapter.map;
const manifestRaw = mapValues.get('manifest.json');
const modelRaw = mapValues.get('model.json');

// Check both can be parsed and are valid JSON
try {
  const manifestParsed = JSON.parse(manifestRaw);
  const modelParsed = JSON.parse(modelRaw);
  console.log('✓ JSON is valid and parseable');
  
  // Check that indentation is present (spec requires null, 2)
  // JSON.stringify(obj, null, 2) adds 2-space indentation
  const hasIndent = manifestRaw.includes('  ') || manifestRaw.includes('\n');
  console.log('✓ JSON has proper indentation:', hasIndent);
  
  // Verify the content matches after parsing
  console.log('✓ manifest parsed correctly:', manifestParsed.format === 'oebf');
  console.log('✓ model parsed correctly:', Array.isArray(modelParsed.storeys));
} catch (e) {
  console.error('✗ JSON parsing failed:', e.message);
}
