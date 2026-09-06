const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// This workspace also contains private, untracked experiments. CI and local
// verification must use the same versioned suite, including newly staged tests.
const inventory = spawnSync('git', ['ls-files', '-z', '--', 'tests'], { cwd: root, encoding: 'utf8' });
if (inventory.status !== 0) throw Error('Run tests from a Git checkout: ' + (inventory.stderr || inventory.error));
const tests = inventory.stdout.split('\0').filter(name => name.endsWith('.test.js'));
if (!tests.length) throw Error('No versioned tests found');
console.log('Running all ' + tests.length + ' versioned test files');
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
