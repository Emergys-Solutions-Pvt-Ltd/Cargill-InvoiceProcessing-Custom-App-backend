// Usage: npm run openapi:export [-- <output path>]   (default: openapi.json in the backend folder)
import fs from 'node:fs';
import path from 'node:path';
import { openApiDocument } from '../src/docs/openapi.js';

const output = path.resolve(process.argv[2] ?? 'openapi.json');
fs.writeFileSync(output, JSON.stringify(openApiDocument, null, 2) + '\n');
console.log(`OpenAPI document written to ${output}`);
