/**
 * devtools-extension.test.js — проверки Download Engine без браузера.
 *
 * panel.js объявляет чистые модули (EntryStore, PathNormalizer, PathFilter,
 * DownloadEngine) и имеет побочные эффекты только внутри init(); поэтому мы
 * исполняем исходник в vm-контексте с заглушками chrome / DOM и реальным
 * JSZip из vendor/ — тестируется код самого panel.js, а не его копия.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PANEL_DIR = path.join(__dirname, '..', 'devtools-extension');
const PANEL_SRC = fs.readFileSync(path.join(PANEL_DIR, 'panel.js'), 'utf8');

/** Синтетическая HAR-запись, как в chrome.devtools.network.onRequestFinished. */
function makeFakeEntry(url, mime, content = 'hello', opts = {}) {
  return {
    request: { url, method: 'GET' },
    response: {
      content: { mimeType: mime, size: (content && content.length) || 0 },
    },
    getContent(cb) {
      setImmediate(() => cb(content, opts.encoding || null));
    },
  };
}

/** Создаёт vm-контекст с заглушками chrome/DOM и реальным JSZip из vendor/. */
function createPanelSandbox() {
  // JSZip UMD экспортирует сам класс как module.exports.
  const JSZip = require('../devtools-extension/vendor/jszip.min.js');

  const chrome = {
    runtime: {
      sendMessage(msg, cb) { if (cb) cb({ ok: false }); },
    },
    devtools: {
      network: {
        onRequestFinished: { addListener() {} },
        getHAR(cb) { cb({ entries: [] }); },
      },
      inspectedWindow: {
        getResources(cb) { cb([]); },
        onResourceAdded: { addListener() {} },
        eval(expr, cb) { if (cb) cb(null, null); },
      },
    },
  };

  const makeElement = (id) => ({
    id,
    value: '',
    textContent: '',
    className: '',
    checked: id === 'opt-unpack-maps',
    disabled: false,
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    click() {},
  });

  const document = {
    getElementById: (id) => makeElement(id),
    createElement: (tag) => makeElement('dynamic-' + tag),
    // Чекбоксов «Типы» в песочнице нет (не управляем ими в тестах).
    querySelectorAll: () => [],
    body: { appendChild() {}, removeChild() {} },
  };

  // Sandboxed URL: настоящий конструктор (new URL() нужен PathNormalizer)
  // плюс blob-методы, которыми пользуется только PanelSaver.
  class SandboxURL extends globalThis.URL {}
  SandboxURL.createObjectURL = () => 'blob:fake';
  SandboxURL.revokeObjectURL = () => {};

  const context = {
    chrome,
    document,
    console,
    setTimeout,
    clearTimeout,
    atob: globalThis.atob,
    Buffer: globalThis.Buffer,
    URL: SandboxURL,
    JSZip,
    Blob: globalThis.Blob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };
  vm.createContext(context);
  vm.runInContext(PANEL_SRC, context, { filename: 'panel.js' });

  return context;
}

/** Запускает DownloadEngine.buildZip на синтетических HAR-записях. */
async function buildZipInSandbox(context, entries, regex = null, categories = null) {
  const engine = vm.runInContext('DownloadEngine', context);
  const statuses = [];
  const progresses = [];
  const blob = await engine.buildZip({
    entries,
    regex,
    categories,
    onProgress: (p) => progresses.push(p),
    onStatus: (s) => statuses.push(s),
  });
  return { blob, statuses, progresses };
}

/** Разворачивает Blob -> map путей -> содержимого (бинарно) для проверок. */
async function unzipBlobInSandbox(context, blob) {
  const JSZip = context.JSZip;
  const buf = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const files = {};
  zip.forEach((relPath, obj) => {
    if (!obj.dir) files[relPath] = null;
  });
  for (const relPath of Object.keys(files)) {
    files[relPath] = await zip.file(relPath).async('nodebuffer');
  }
  return files;
}

// ─── PathNormalizer ──────────────────────────────────────────────────────────

test('PathNormalizer: сохраняет полную структуру папок сервера', async () => {
  const ctx = createPanelSandbox();
  const norm = vm.runInContext('PathNormalizer', ctx);
  assert.equal(
    norm.build('https://site.com/visibility/dist/vite/main.js', 'application/javascript'),
    'visibility/dist/vite/main.js'
  );
});

test('PathNormalizer: срезает query-параметры (script.js?v=2 -> script.js)', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  assert.equal(
    norm.build('https://site.com/scripts/app.js?v=2&lang=ru', 'application/javascript'),
    'scripts/app.js'
  );
});

test('PathNormalizer: директория расширением из Content-Type', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  assert.equal(norm.build('https://site.com/', 'text/html'), 'index.html');
  assert.equal(norm.build('https://api.site.com', 'application/json'), 'index.json');
});

test('PathNormalizer: файл без расширения получает суффикс по MIME', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  assert.equal(norm.build('https://api.site.com/posts/42', 'application/json'), 'posts/42.json');
  assert.equal(norm.build('https://api.site.com/robots', 'text/plain'), 'robots.txt');
});

test('PathNormalizer: вычищает недопустимые символы файловой системы', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  const out = norm.build('https://site.com/a<b>/c*.js', 'application/javascript');
  assert.ok(!/[<>:"\\|?*]/.test(out), `путь очищен, получено: ${out}`);
  assert.equal(out, 'a_b_/c_.js');
});

test('PathNormalizer: zip-slip сегменты .. и невалидные URL', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  assert.equal(norm.build('https://site.com/../../etc/x.js', 'application/javascript'), 'etc/x.js');
  const fallback = norm.build('//not a url', 'application/javascript');
  assert.ok(fallback.startsWith('extracted_assets/'), `резервный путь: ${fallback}`);
});

// ─── makeUnique ──────────────────────────────────────────────────────────

test('makeUnique: не допускает коллизий путей в архиве', async () => {
  const norm = vm.runInContext('PathNormalizer', createPanelSandbox());
  const used = new Set();
  assert.equal(norm.makeUnique('dist/main.js', used), 'dist/main.js');
  assert.equal(norm.makeUnique('dist/main.js', used), 'dist/main_1.js');
  assert.equal(norm.makeUnique('dist/main.js', used), 'dist/main_2.js');
});

// ─── PathFilter ──────────────────────────────────────────────────────────

test('PathFilter: подстрока по умолчанию', async () => {
  const pf = vm.runInContext('PathFilter', createPanelSandbox());
  const { regex, error } = pf.compile('dist/vite');
  assert.equal(error, null);
  assert.ok(pf.matches(regex, makeFakeEntry('https://site.com/visibility/dist/vite/main.js', 'text/javascript')));
  assert.ok(!pf.matches(regex, makeFakeEntry('https://site.com/index.html', 'text/html')));
});

test('PathFilter: /regex/ с флагами и сырое выражение', async () => {
  const pf = vm.runInContext('PathFilter', createPanelSandbox());
  const r1 = pf.compile('/.*\\.png$/i');
  assert.ok(pf.matches(r1.regex, makeFakeEntry('https://site.com/imgs/Photo.PNG', 'image/png')));

  const r2 = pf.compile('.*\\.js$');
  assert.ok(pf.matches(r2.regex, makeFakeEntry('https://site.com/app.js', 'text/javascript')));
  assert.ok(!pf.matches(r2.regex, makeFakeEntry('https://site.com/app.css', 'text/css')));
});

test('PathFilter: фолбэк на подстроку при невалидном RegExp', async () => {
  const pf = vm.runInContext('PathFilter', createPanelSandbox());
  const { regex, error } = pf.compile('(site.com');
  assert.equal(error, null); // не роняет компиляцию
  assert.ok(!pf.matches(regex, makeFakeEntry('https://example.com/a.js', 'text/javascript')));
});

// ─── DownloadEngine.end-to-end ─────────────────────────────────────────────

test('DownloadEngine: собирает ZIP с корректной структурой, base64 и суффиксами', async () => {
  const ctx = createPanelSandbox();

  const entries = [
    makeFakeEntry('https://site.com/visibility/dist/vite/main.js', 'application/javascript', 'console.log("main");'),
    makeFakeEntry('https://site.com/visibility/dist/vite/main.js?v=2', 'application/javascript', 'console.log("second: not deduped here");'),
    makeFakeEntry('https://cdn.site.com/img/logo.png', 'image/png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'), { encoding: 'base64' }),
    makeFakeEntry('https://api.site.com/posts/42', 'application/json', '{"id":42}'),
    makeFakeEntry('https://site.com/', 'text/html', '<html></html>'),
  ];

  const { blob, progresses } = await buildZipInSandbox(ctx, entries);
  assert.ok(blob, 'архив собран');

  const files = await unzipBlobInSandbox(ctx, blob);
  const textOf = (k) => files[k].toString('utf8');
  // Оба URL отображаются в один путь — коллизия решается суффиксом _1.
  assert.equal(textOf('visibility/dist/vite/main.js'), 'console.log("main");');
  assert.equal(textOf('visibility/dist/vite/main_1.js'), 'console.log("second: not deduped here");');
  // base64-бинарник корректно распакован в байты PNG-сигнатуры.
  assert.deepEqual(
    [...files['img/logo.png']],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  // Файл без расширения получил суффикс .json по MIME.
  assert.equal(textOf('posts/42.json'), '{"id":42}');
  // Корень сайта -> index.html.
  assert.equal(textOf('index.html'), '<html></html>');

  const fileProgress = progresses.filter((p) => p.type === 'file');
  assert.equal(fileProgress.length, entries.length, 'прогресс по каждому файлу');
  assert.equal(
    fileProgress[fileProgress.length - 1].processedCount,
    entries.length,
    'финальное событие: processedCount == totalFiles'
  );
});

test('DownloadEngine: пропускает файлы свыше лимита, не прерывая архив', async () => {
  const ctx = createPanelSandbox();
  vm.runInContext('CONFIG.MAX_FILE_SIZE_BYTES = 5;', ctx);

  const entries = [
    makeFakeEntry('https://site.com/small.js', 'application/javascript', 'tiny'),
    makeFakeEntry('https://site.com/big.js', 'application/javascript', '0123456789012345678901234'),
  ];
  const { blob } = await buildZipInSandbox(ctx, entries);
  assert.ok(blob, 'архив собирается даже при пропусках');

  const files = await unzipBlobInSandbox(ctx, blob);
  assert.ok('small.js' in files, 'маленький файл упакован');
  assert.ok(!('big.js' in files), 'большой файл пропущен по лимиту');
});

test('DownloadEngine: запись без getContent -> архив не собирается, notice', async () => {
  const ctx = createPanelSandbox();
  // Как записи из getHAR(): тело тела нет (getContent отсутствует).
  const harLike = {
    request: { url: 'https://site.com/har.js', method: 'GET' },
    response: { content: { mimeType: 'application/javascript', size: 10 } },
  };
  const { blob, statuses } = await buildZipInSandbox(ctx, [harLike]);
  assert.equal(blob, null, 'архив не собирается без тел');
  assert.equal(statuses.at(-1).type, 'notice', 'движок сообщает, что упаковывать нечего');
});

// ─── ResourceType: классификация по MIME ───────────────────────────────────

test('ResourceType.classify: размечает MIME по категориям чекбоксов', async () => {
  const rt = vm.runInContext('ResourceType', createPanelSandbox());
  assert.equal(rt.classify('application/javascript'), 'scripts');
  assert.equal(rt.classify('text/javascript;charset=UTF-8'), 'scripts');
  assert.equal(rt.classify('application/json'), 'scripts');
  assert.equal(rt.classify('image/png'), 'images');
  assert.equal(rt.classify('image/svg+xml'), 'images');
  assert.equal(rt.classify('image/x-icon'), 'images');
  assert.equal(rt.classify('font/woff2'), 'fonts');
  assert.equal(rt.classify('application/font-woff'), 'fonts');
  assert.equal(rt.classify('font/ttf'), 'fonts');
  assert.equal(rt.classify('text/css'), 'styles');
  assert.equal(rt.classify('text/html'), 'other');
  assert.equal(rt.classify('application/pdf'), 'other');
  assert.equal(rt.classify(''), 'other');
  assert.equal(rt.classify(' application/json ; charset=UTF-8 '), 'scripts', 'пробелы и параметры MIME обрезаются');
});

// ─── Фильтрация типов в DownloadEngine ───────────────────────────────────────

test('DownloadEngine: категории — в архив попадают только выбранные типы', async () => {
  const ctx = createPanelSandbox();
  const entries = [
    makeFakeEntry('https://site.com/app.js', 'application/javascript', 'js-body'),
    makeFakeEntry('https://cdn.site.com/img/logo.png', 'image/png',
      Buffer.from([137, 80, 78, 71]).toString('base64'), { encoding: 'base64' }),
    makeFakeEntry('https://site.com/style.css', 'text/css', 'body{}'),
    makeFakeEntry('https://site.com/doc.html', 'text/html', '<html></html>'),
  ];
  const { blob } = await buildZipInSandbox(ctx, entries, null, new Set(['scripts', 'styles']));
  assert.ok(blob, 'архив собран');

  const files = await unzipBlobInSandbox(ctx, blob);
  assert.ok('app.js' in files, 'скрипт упакован');
  assert.ok('style.css' in files, 'стиль упакован');
  assert.ok(!('img/logo.png' in files), 'картинка отфильтрована');
  assert.ok(!('doc.html' in files), 'html (other) отфильтрован');
});

test('DownloadEngine: ни один тип не выбран — архив не запускается, notice', async () => {
  const ctx = createPanelSandbox();
  const entries = [makeFakeEntry('https://site.com/app.js', 'application/javascript', 'x')];
  const { blob, statuses } = await buildZipInSandbox(ctx, entries, null, new Set());
  assert.equal(blob, null, 'пустой набор типов -> без архива');
  assert.equal(statuses.at(-1).type, 'notice');
  assert.equal(statuses.at(-1).message, 'Не выбран ни один тип ресурсов (чекбоксы «Типы»).');
});

// ─── Манифест, имя по хосту, пачки, STORE ───────────────────────────────

test('DownloadEngine: кладёт assets_manifest.json с картой URL -> путь', async () => {
  const ctx = createPanelSandbox();
  const entries = [
    makeFakeEntry('https://site.com/app.js', 'application/javascript', 'console.log(1)'),
    makeFakeEntry('https://site.com/img/logo.png', 'image/png',
      Buffer.from([137, 80]).toString('base64'), { encoding: 'base64' }),
  ];
  const { blob } = await buildZipInSandbox(ctx, entries);
  const files = await unzipBlobInSandbox(ctx, blob);
  assert.ok(files['assets_manifest.json'], 'манифест присутствует в архиве');

  const manifest = JSON.parse(files['assets_manifest.json'].toString('utf8'));
  assert.equal(manifest.generator, 'Asset Extractor (DevTools extension)');
  assert.equal(manifest.fileCount, 2);
  const byUrl = new Map(manifest.files.map((f) => [f.url, f.path]));
  assert.equal(byUrl.get('https://site.com/app.js'), 'app.js');
  assert.equal(byUrl.get('https://site.com/img/logo.png'), 'img/logo.png');
  assert.ok(files['app.js'].toString('utf8').includes('console.log(1)'), 'путь из манифеста реально в архиве');
});

test('DownloadEngine.fileNameFor: имя архива по домену большинства ресурсов', () => {
  const engine = vm.runInContext('DownloadEngine', createPanelSandbox());
  const entries = [
    makeFakeEntry('https://example.com/app.js', 'application/javascript'),
    makeFakeEntry('https://example.com/style.css', 'text/css'),
    makeFakeEntry('https://cdn.example.net/img.png', 'image/png'),
  ];
  assert.match(engine.fileNameFor(entries, null, null), /^example\.com_\d{4}-\d{2}-\d{2}\.zip$/);
  // Пустой список -> запасное нейтральное имя.
  assert.match(engine.fileNameFor([], null, null), /^assets_\d{4}-\d{2}-\d{2}\.zip$/);
  // www-префикс срезается, домен остаётся читаемым.
  assert.match(engine.fileNameFor([makeFakeEntry('https://www.test.org/a.js', 'text/javascript')], null, null),
    /^test\.org_\d{4}-\d{2}-\d{2}\.zip$/);
});

test('DownloadEngine: пачки getContent — обработан каждый файл, прогресс полный', async () => {
  const ctx = createPanelSandbox();
  const entries = [];
  for (let n = 0; n < 20; n++) {
    entries.push(makeFakeEntry('https://x.com/f' + n + '.js', 'application/javascript', 'v=' + n));
  }
  const { blob, progresses } = await buildZipInSandbox(ctx, entries);
  assert.ok(blob, 'архив собран из 20 файлов');
  const fileProgress = progresses.filter((p) => p.type === 'file');
  assert.equal(fileProgress.at(-1).processedCount, 20);
  assert.equal(fileProgress.at(-1).totalFiles, 20);
});

test('DownloadEngine: noCompression -> STORE, архив крупнее DEFLATE на повторяемом тексте', async () => {
  const ctx = createPanelSandbox();
  const big = 'A'.repeat(20000);
  const entries = [makeFakeEntry('https://site.com/big.txt', 'text/plain', big)];
  const engine = vm.runInContext('DownloadEngine', ctx);
  const mvOpts = (noCompression) => ({
    entries, regex: null, categories: null, noCompression,
    onProgress: () => {}, onStatus: () => {},
  });
  const deflate = await engine.buildZip(mvOpts(false));
  const store = await engine.buildZip(mvOpts(true));
  assert.ok(store.size > deflate.size, `STORE (${store.size} B) должен быть больше DEFLATE (${deflate.size} B)`);
  // Содержимое в STORE-архиве не повреждено.
  const text = await ctx.JSZip.loadAsync(await store.arrayBuffer());
  const back = await text.file('big.txt').async('string');
  assert.equal(back, big);
});

test('DownloadEngine._fetchContent: повисший getContent не вешает сборку (таймаут)', async () => {
  const ctx = createPanelSandbox();
  vm.runInContext('CONFIG.CONTENT_TIMEOUT_MS = 30;', ctx);
  const hung = {
    request: { url: 'https://h.com/a.js', method: 'GET' },
    response: { content: { mimeType: 'application/javascript', size: 3 } },
    getContent() {}, // никогда не вызывает callback
  };
  const { blob, statuses } = await buildZipInSandbox(ctx, [hung]);
  assert.equal(blob, null);
  assert.ok(statuses.some((s) => s.type === 'notice' && /без тела/.test(s.message)));
});

// ─── SettingsPersist ────────────────────────────────────────────────────

test('SettingsPersist: save пишет в chrome.storage.local, load восстанавливает', async () => {
  const ctx = createPanelSandbox();
  const storageData = {};
  ctx.chrome.storage = {
    local: {
      get(key, cb) { cb({ [key]: storageData[key] }); },
      set(obj, cb) { Object.assign(storageData, obj); if (cb) cb(); },
    },
  };
  const sp = vm.runInContext('SettingsPersist', ctx);
  const ui = vm.runInContext('PanelUI', ctx);

  ui.el.filter.value = 'dist/vite';
  sp.save();
  // Объект создан внутри vm-контекста (чужой Object.prototype), поэтому
  // deepStrictEqual непригоден — сравниваем по полям.
  const savedSettings = storageData['assetExtractor.settings'];
  assert.equal(savedSettings.filter, 'dist/vite');
  assert.deepEqual([...savedSettings.types], []);
  assert.equal(savedSettings.noCompression, false);
  assert.equal(savedSettings.unpackSourceMaps, true);

  // После «перезапуска» панели (фильтр сброшен) настройки возвращаются.
  ui.el.filter.value = '';
  sp.load(() => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(ui.el.filter.value, 'dist/vite');
});

test('SettingsPersist: отсутствие chrome.storage не роняет панель', () => {
  const ctx = createPanelSandbox();
  const sp = vm.runInContext('SettingsPersist', ctx);
  assert.doesNotThrow(() => sp.save());
  assert.doesNotThrow(() => sp.load(() => {}));
});

// ─── SourceMapExtractor ──────────────────────────────────────────────────

test('SourceMapExtractor: cleanPath очищает схемы и пути', () => {
  const ctx = createPanelSandbox();
  const extractor = vm.runInContext('SourceMapExtractor', ctx);

  assert.equal(
    extractor.cleanPath('webpack:///src/components/Button.tsx?v=1'),
    'src/components/Button.tsx'
  );
  assert.equal(
    extractor.cleanPath('vite:///packages/core/colors.ts'),
    'packages/core/colors.ts'
  );
  assert.equal(
    extractor.cleanPath('../../../src/index.ts'),
    'src/index.ts'
  );
  assert.equal(
    extractor.cleanPath(''),
    'unnamed.js'
  );
});

test('SourceMapExtractor: unpack извлекает пары path/content', async () => {
  const ctx = createPanelSandbox();
  const extractor = vm.runInContext('SourceMapExtractor', ctx);

  const map = {
    version: 3,
    sources: [
      'webpack:///src/app.tsx',
      'webpack:///src/utils/math.ts',
    ],
    sourcesContent: [
      'export const App = () => <div>App</div>;',
      'export const add = (a, b) => a + b;',
    ],
  };

  const files = await extractor.unpack(map);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'sources/src/app.tsx');
  assert.equal(files[0].content, 'export const App = () => <div>App</div>;');
  assert.equal(files[1].path, 'sources/src/utils/math.ts');
  assert.equal(files[1].content, 'export const add = (a, b) => a + b;');
});

test('SourceMapExtractor: unpack докачивает файлы при отсутствии sourcesContent', async () => {
  const ctx = createPanelSandbox();
  const extractor = vm.runInContext('SourceMapExtractor', ctx);

  // Перехват fetchText в extractor
  extractor.fetchText = async (url) => {
    if (url === 'https://example.com/src/colors.ts') {
      return 'export const RED = "#f00";';
    }
    return null;
  };

  const map = {
    version: 3,
    sources: ['src/colors.ts'],
    sourcesContent: null, // нет встроенного тела
  };

  const files = await extractor.unpack(map, 'https://example.com/app.js.map');
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'sources/src/colors.ts');
  assert.equal(files[0].content, 'export const RED = "#f00";');
});

test('EntryStore.harvest: собирает ресурсы из chrome.devtools.inspectedWindow.getResources()', async () => {
  const ctx = createPanelSandbox();
  const store = vm.runInContext('EntryStore', ctx);

  ctx.chrome.devtools.inspectedWindow.getResources = (cb) => {
    cb([
      {
        url: 'https://example.com/styles/theme.css',
        type: 'stylesheet',
        getContent(cbb) { cbb('body { color: red; }'); },
      },
      {
        url: 'https://example.com/scripts/vendor.js',
        type: 'script',
        getContent(cbb) { cbb('console.log("vendor");'); },
      },
    ]);
  };

  await store.harvest();
  assert.equal(store.size, 2);
  const list = store.list();
  assert.equal(list[0].request.url, 'https://example.com/styles/theme.css');
  assert.equal(list[0].response.content.mimeType, 'text/css');
  assert.equal(list[1].request.url, 'https://example.com/scripts/vendor.js');
  assert.equal(list[1].response.content.mimeType, 'application/javascript');
});

test('DownloadEngine: распаковывает inline source map в sources/ внутри ZIP', async () => {
  const ctx = createPanelSandbox();
  const mapData = {
    version: 3,
    sources: ['vite:///src/secret.ts'],
    sourcesContent: ['export const SECRET = "aurora-key";'],
  };
  const b64Map = Buffer.from(JSON.stringify(mapData)).toString('base64');
  const bundleCode = `console.log("bundle");\n//# sourceMappingURL=data:application/json;base64,${b64Map}`;

  const entry = makeFakeEntry('https://example.com/assets/bundle.js', 'application/javascript', bundleCode);
  const { blob } = await buildZipInSandbox(ctx, [entry]);

  assert.ok(blob, 'ZIP должен быть собран');
  const zip = await ctx.JSZip.loadAsync(await blob.arrayBuffer());

  // Проверяем наличие оригинального bundle.js
  const bundleFile = zip.file('assets/bundle.js');
  assert.ok(bundleFile, 'bundle.js должен присутствовать в архиве');

  // Проверяем наличие распакованного из source map файла
  const unpackedFile = zip.file('sources/src/secret.ts');
  assert.ok(unpackedFile, 'sources/src/secret.ts должен быть извлечен из Source Map');
  const secretContent = await unpackedFile.async('string');
  assert.equal(secretContent, 'export const SECRET = "aurora-key";');

  // Проверяем manifest
  const manifestFile = zip.file('assets_manifest.json');
  assert.ok(manifestFile);
  const manifest = JSON.parse(await manifestFile.async('string'));
  const foundInManifest = manifest.files.find((f) => f.path === 'sources/src/secret.ts');
  assert.ok(foundInManifest, 'Распакованный файл должен быть зарегистрирован в manifest');
  assert.equal(foundInManifest.fromSourceMap, true);
});
