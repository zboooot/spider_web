import fs from 'fs';
import path from 'path';

function usage() {
  console.error('Usage: node scripts/apply-shared-defaults.js <path-to-json>');
  console.error('   or: node scripts/apply-shared-defaults.js --stdin');
  process.exit(1);
}

function readInput(argv) {
  if (argv[2] === '--stdin') return fs.readFileSync(0, 'utf8');
  if (!argv[2]) usage();
  return fs.readFileSync(path.resolve(argv[2]), 'utf8');
}

function normalizeDefaults(payload) {
  var out = payload && typeof payload === 'object' ? payload : {};
  if (!out.panelParams || typeof out.panelParams !== 'object' || Array.isArray(out.panelParams)) out.panelParams = {};
  if (!Array.isArray(out.waveConfigs)) out.waveConfigs = [];
  if (!Array.isArray(out.levelConditions)) out.levelConditions = [];
  return out;
}

function toModuleSource(payload) {
  return 'export var SHARED_GAME_DEFAULTS = ' + JSON.stringify(payload, null, 2) + ';\n';
}

var raw = readInput(process.argv);
var parsed = JSON.parse(raw);
var normalized = normalizeDefaults(parsed);
var outPath = path.resolve('src/data/sharedGameDefaults.js');
fs.writeFileSync(outPath, toModuleSource(normalized), 'utf8');
console.error('Wrote shared defaults to ' + outPath);
