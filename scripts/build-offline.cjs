const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pages = ['index.html', 'myfuel.html', 'mywind.html', 'mypath.html', 'mynpa.html', 'myshift.html', 'offline.html'];
const assets = [...pages, 'manifest.json', 'app.js', 'offline-client.js', 'bottom-navigation.css', 'suflights.js', 'dbaircraft.js',
    'vendor/firebase-app-compat.js', 'vendor/firebase-database-compat.js', 'vendor/firebase-auth-compat.js'].sort();
const source = fs.readFileSync(path.join(root, 'sw.source.js'), 'utf8').replace(/\r\n/g, '\n');
const raw = new Map(assets.map(url => {
    const bytes = Buffer.from(fs.readFileSync(path.join(root, url), 'utf8').replace(/\r\n/g, '\n'));
    return [url, pages.includes(url) ? Buffer.from(bytes.toString().replace(/<meta name="offline-build" content="[^"]+">\s*/g, '')) : bytes];
}));
const id = hash(JSON.stringify([...raw].map(([url, bytes]) => ({ url, hash: hash(bytes) }))) + source).slice(0, 24);
const mime = url => url.endsWith('.html') ? ['text/html'] : url.endsWith('.css') ? ['text/css']
    : url.endsWith('.js') ? ['text/javascript', 'application/javascript'] : ['application/json', 'application/manifest+json'];
const output = new Map([...raw].map(([url, bytes]) => [url, pages.includes(url)
    ? Buffer.from(bytes.toString().replace('</head>', '<meta name="offline-build" content="' + id + '"></head>')) : bytes]));
const build = { id, assets: [...output].map(([url, bytes]) => ({ url, sha256: hash(bytes), mime: mime(url) })) };
if (!source.includes('const PRECACHE_BUILD = null;')) throw Error('Missing worker build placeholder');
output.set('sw.js', Buffer.from(source.replace('const PRECACHE_BUILD = null;', 'const PRECACHE_BUILD = ' + JSON.stringify(build) + ';')));
// Upgrade the legacy registration through the same verified installer.
output.set('service-worker.js', output.get('sw.js'));
for (const [url, bytes] of output) {
    const file = path.join(root, url);
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) throw Error('Release must be rebuilt: ' + url);
    } else if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) fs.writeFileSync(file, bytes);
}
console.log('Offline release ' + id + ': ' + build.assets.length + ' verified assets');
if (!process.argv.includes('--check')) {
    const dist = path.resolve(root, 'dist');
    if (path.dirname(dist) !== root || (fs.existsSync(dist) && fs.realpathSync(dist) !== dist)) {
        throw Error('Unsafe deployment output directory: ' + dist);
    }
    fs.rmSync(dist, { recursive: true, force: true });
    const optional = JSON.parse(source.match(/const OPTIONAL_ASSETS = (\[[^;]+\]);/)[1]);
    for (const url of new Set([...assets, 'sw.js', 'service-worker.js', ...optional])) {
        const file = path.join(root, url);
        if (!fs.existsSync(file)) continue;
        const destination = path.join(root, 'dist', url);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(file, destination);
    }
}
