const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
for (const name of ['sw.source.js', 'sw.js', 'service-worker.js', 'offline-client.js', 'app.js', 'suflights.js', 'dbaircraft.js']) {
    new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
}
for (const name of ['index.html', 'myfuel.html', 'mywind.html', 'mypath.html', 'mynpa.html', 'myshift.html']) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        new vm.Script(match[1], { filename: name });
    }
}
console.log('Application JavaScript syntax OK');
