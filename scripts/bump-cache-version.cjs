const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceFile = path.join(root, 'sw.source.js');
const dateArgument = process.argv.find(argument => argument.startsWith('--date='));
const dryRun = process.argv.includes('--dry-run');
const today = new Date();
const defaultDate = [
    String(today.getUTCFullYear()).slice(-2),
    String(today.getUTCMonth() + 1).padStart(2, '0'),
    String(today.getUTCDate()).padStart(2, '0')
].join('');
const nextDate = dateArgument ? dateArgument.slice('--date='.length) : defaultDate;

if (!/^\d{6}$/.test(nextDate)) throw Error('Cache date must use YYMMDD format.');

const source = fs.readFileSync(sourceFile, 'utf8');
const match = source.match(/const CACHE_NAME = 'myflight_v\.(\d{6})-(\d+)';/);
if (!match) throw Error('CACHE_NAME is missing or has an unsupported format.');

const [, currentDate, currentSequence] = match;
const nextSequence = currentDate === nextDate ? Number(currentSequence) + 1 : 1;
const currentName = `myflight_v.${currentDate}-${currentSequence}`;
const nextName = `myflight_v.${nextDate}-${nextSequence}`;
const updated = source.replace(currentName, nextName);

if (!dryRun) fs.writeFileSync(sourceFile, updated);
console.log(`${currentName} -> ${nextName}${dryRun ? ' (dry run)' : ''}`);
