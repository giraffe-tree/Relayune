import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { isDependencyDirectory, isDependencyInput } from '../scripts/mermaid-package-paths.mjs';

test('Mermaid metadata finds dependency inputs with either esbuild path separator', () => {
  for (const input of ['node_modules/mermaid/dist/core.mjs', 'node_modules\\mermaid\\dist\\core.mjs',
    'node_modules/mermaid/node_modules/katex/dist/katex.mjs',
    'node_modules\\mermaid/node_modules\\katex/dist/katex.mjs']) {
    assert.equal(isDependencyInput(input), true, input);
  }
  for (const input of ['<stdin>', 'scripts/node_modules-helper.mjs', 'app/main.ts']) {
    assert.equal(isDependencyInput(input), false, input);
  }
});

test('Mermaid package traversal stays inside node_modules on Windows and POSIX', () => {
  for (const [paths, root] of [[path.win32, 'C:\\work\\Relayune'], [path.posix, '/work/Relayune']]) {
    for (const segments of [['node_modules', 'mermaid', 'dist'], ['node_modules', 'mermaid'],
      ['node_modules', 'mermaid', 'node_modules', 'katex', 'dist']]) {
      assert.equal(isDependencyDirectory(root, paths.join(root, ...segments), paths), true);
    }
    for (const segments of [[], ['node_modules'], ['node_modules-other', 'mermaid'],
      ['other', 'node_modules', 'mermaid']]) {
      assert.equal(isDependencyDirectory(root, paths.join(root, ...segments), paths), false);
    }
    assert.equal(isDependencyDirectory(root, paths.resolve(root, '..', 'elsewhere', 'node_modules', 'mermaid'), paths), false);
  }
  assert.equal(isDependencyDirectory('C:\\work\\Relayune', 'D:\\node_modules\\mermaid', path.win32), false);
});
