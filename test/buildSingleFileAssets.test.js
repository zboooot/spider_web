import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('single-file build does not leave runtime src asset paths behind', function () {
  execFileSync('npm', ['run', 'build'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe'
  });

  var html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /\/src\/assets\//, 'build output still references dev-only asset paths');
});

test('single-file build hides debug panels and non-game side content', function () {
  execFileSync('npm', ['run', 'build'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe'
  });

  var html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(html, /\.right-side \{ display:none !important; \}/, 'build output still leaves right-side controls visible');
  assert.match(html, /\.stats-panel \{ display:none !important; \}/, 'build output still leaves the stats panel visible');
  assert.match(html, /\.phase-bar \{ display:none !important; \}/, 'build output still leaves the phase status text visible');
});
