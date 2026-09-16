const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const bumpScript = path.join(root, 'scripts', 'bump-cache-version.cjs');

test('cache bump script increments the daily PWA cache sequence without writing in dry-run mode', () => {
    const sourceFile = path.join(root, 'sw.source.js');
    const sourceBefore = fs.readFileSync(sourceFile, 'utf8');
    const [, date, sequence] = sourceBefore.match(/const CACHE_NAME = 'myflight_v\.(\d{6})-(\d+)';/);
    const result = spawnSync(process.execPath, [bumpScript, `--date=${date}`, '--dry-run'], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`myflight_v\\.${date}-${sequence} -> myflight_v\\.${date}-${Number(sequence) + 1}`));
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBefore);
});

test('main pushes use GitHub Actions to bump, rebuild, commit, and deploy the PWA cache', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');

    assert.match(workflow, /contents:\s*write/);
    assert.match(workflow, /node scripts\/bump-cache-version\.cjs/);
    assert.match(workflow, /git commit -m "chore: bump PWA cache"/);
    assert.match(workflow, /git push/);
});
