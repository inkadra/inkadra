import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokensCss } from '../src/tokens-css.ts';

writeFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), tokensCss());
