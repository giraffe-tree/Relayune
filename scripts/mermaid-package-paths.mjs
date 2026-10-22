import path from 'node:path';

// esbuild input names can use either separator even when inspected on another
// host. Match a complete path component rather than a slash-specific prefix.
export function isDependencyInput(input) {
  return input.split(/[\\/]/).includes('node_modules');
}

export function isDependencyDirectory(root, directory, paths = path) {
  const relative = paths.relative(paths.resolve(root, 'node_modules'), directory);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}
