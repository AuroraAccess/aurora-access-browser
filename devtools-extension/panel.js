// ===========================================================================
// panel.js — Asset Extractor DevTools Panel
//
// Архитектура (интерфейс отделён от движка загрузчика):
//   EntryStore      — приём/дедупликация перехваченных network-запросов
//   PathNormalizer  — URL -> безопасный zip-путь с сохранением структуры папок
//   PathFilter      — фильтр: подстрока или /regex/flags
//   DownloadEngine  — асинхронный оркестратор: getContent() -> JSZip -> Blob
//   PanelSaver      — сохранение: chrome.downloads либо Blob -> <a download>
//   PanelUI         — только DOM: фильтр, прогресс-бар, статус, счётчики
//
// Совместимость: Chrome/Edge MV3 DevTools-расширение, а также кастомные
// сборки на Electron (DevTools), где chrome.downloads может отсутствовать —
// тогда скачивание идёт через Blob -> <a download> (см. PanelSaver).
// ===========================================================================

'use strict';

// ─── Конфигурация движка (guardrails против Out-Of-Memory) ─────────────────
const CONFIG = {
  /** Потолок на один файл (байт): тело больше этого пропускается. */
  MAX_FILE_SIZE_BYTES: 64 * 1024 * 1024,
  /** Суммарный потолок несжатых данных в архиве. */
  MAX_TOTAL_SIZE_BYTES: 512 * 1024 * 1024,
  /** Максимальное количество файлов в одном архиве. */
  MAX_FILES: 5000,
  /** Размер пачки параллельного getContent(): 8 тел за раз вместо 1. */
  FETCH_BATCH_SIZE: 8,
  /** Guard на повисший getContent() (вытесненный из disk cache ресурс). */
  CONTENT_TIMEOUT_MS: 20000,
};

// ─── Карта Content-Type -> Расширение файла ────────────────────────────────
const MIME_MAP = {
  'text/html': '.html',
  'text/plain': '.txt',
  'text/css': '.css',
  'application/javascript': '.js',
  'text/javascript': '.js',
  'application/x-javascript': '.js',
  'application/json': '.json',
  'application/manifest+json': '.json',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'application/font-woff': '.woff',
  'application/octet-stream': '.bin',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
};

// ─── ResourceType: категория ресурса для чекбоксов «Типы» ───────────────
const ResourceType = {
  /**
   * Категория ресурса по Content-Type ответа (для фильтра перед архивацией).
   * Возвращает одно из: 'scripts' | 'images' | 'fonts' | 'styles' | 'other'.
   * @param {string} mimeType
   */
  classify(mimeType) {
    const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
    if (/^image\//.test(mime) || mime.indexOf('x-icon') !== -1) return 'images';
    if (mime.indexOf('font') !== -1 || mime.indexOf('woff') !== -1 ||
        mime.indexOf('otf') !== -1 || mime.indexOf('ttf') !== -1) return 'fonts';
    if (mime.indexOf('text/css') === 0) return 'styles';
    if (mime.indexOf('javascript') !== -1 || mime.indexOf('ecmascript') !== -1 ||
        mime.indexOf('json') !== -1) return 'scripts';
    return 'other';
  },
};

// ─── EntryStore: хранилище перехваченных запросов ──────────────────────────
const EntryStore = {
  /** Map: url -> HAR Entry / Resource. Дедупликация: последний запрос побеждает. */
  _entries: new Map(),
  _changedListeners: [],

  add(request) {
    this._entries.set(request.request.url, request);
    this._notify();
  },

  /**
   * Оборачивает Resource из chrome.devtools.inspectedWindow.getResources()
   * в интерфейс, совместимый с HAR Entry (getContent, request.url, response.content).
   */
  wrapResource(res) {
    let mimeType = 'application/octet-stream';
    if (res.type === 'script') mimeType = 'application/javascript';
    else if (res.type === 'stylesheet') mimeType = 'text/css';
    else if (res.type === 'image') mimeType = 'image/png';
    else if (res.type === 'document') mimeType = 'text/html';
    else if (res.type === 'font') mimeType = 'font/woff2';

    const cleanUrl = (res.url || '').split('?')[0];
    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    if (match) {
      const ext = '.' + match[1].toLowerCase();
      for (const [m, e] of Object.entries(MIME_MAP)) {
        if (e === ext) {
          mimeType = m;
          break;
        }
      }
    }

    return {
      _isResource: true,
      request: { url: res.url, method: 'GET' },
      response: {
        content: {
          mimeType,
          size: 0,
        },
      },
      getContent(cb) {
        try {
          res.getContent((content, encoding) => {
            cb(content !== undefined && content !== null ? content : '', encoding || null);
          });
        } catch (_) {
          cb('', null);
        }
      },
    };
  },

  /**
   * Опрашивает chrome.devtools.inspectedWindow.getResources() для захвата
   * всех ресурсов страницы, даже если они загрузились до открытия DevTools.
   */
  async harvest() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.devtools ||
      !chrome.devtools.inspectedWindow ||
      !chrome.devtools.inspectedWindow.getResources
    ) {
      return;
    }
    return new Promise((resolve) => {
      try {
        chrome.devtools.inspectedWindow.getResources((resources) => {
          if (Array.isArray(resources)) {
            let added = false;
            for (const res of resources) {
              if (!res || !res.url || !res.url.startsWith('http')) continue;
              if (!this._entries.has(res.url)) {
                this._entries.set(res.url, this.wrapResource(res));
                added = true;
              }
            }
            if (added) this._notify();
          }
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  },

  clear() {
    this._entries.clear();
    this._notify();
  },

  list() {
    return [...this._entries.values()];
  },

  get size() {
    return this._entries.size;
  },

  onChange(fn) {
    this._changedListeners.push(fn);
  },

  _notify() {
    for (const fn of this._changedListeners) {
      try { fn(); } catch (_) { /* сбой UI не должен ломать движок */ }
    }
  },
};

// ─── PathNormalizer: URL -> zip-путь ───────────────────────────────────────
const PathNormalizer = {
  // Санитизация имён/папок: управляющие символы реально встречаются в
  // шальных URL, поэтому \x00-\x1f здесь намеренно.
  //eslint-disable-next-line no-control-regex
  _INVALID_CHARS: /[<>:"\\|?*]|[\x00-\x1f]/g,

  /**
   * Строит относительный путь внутри архива, повторяя структуру папок
   * сервера. Примеры:
   *   https://site.com                          -> index.html
   *   https://site.com/visibility/dist/vite/main.js?v=2
   *                                             -> visibility/dist/vite/main.js
   *   https://api.site.com/posts/42 (JSON)      -> posts/42.json
   *
   * @param {string} urlStr            полный URL ресурса
   * @param {string} contentTypeHeader заголовок Content-Type ответа
   * @returns {string} путь без ведущих слэшей, безопасный для ZIP и для
   *                   распаковки в Windows (недопустимые символы вычищены)
   */
  build(urlStr, contentTypeHeader) {
    const mime = String(contentTypeHeader || '').split(';')[0].trim().toLowerCase();
    const extFromMime = MIME_MAP[mime] || '';

    try {
      const url = new URL(urlStr);
      let pathname = url.pathname;

      // Запрос корня/директории без имени файла -> index.<ext|html>.
      // Расширение берём из Content-Type: /stream (application/json) станет
      // index.json, а не index.html.
      if (pathname === '' || pathname.endsWith('/')) {
        pathname += 'index' + (extFromMime || '.html');
      }

      const segments = pathname.split('/');
      let fileName = segments.pop() || '';

      // Query/фрагменты не должны попадать в имя файла (script.js?v=2 -> script.js).
      // URL API обычно отделяет их само; здесь страховка для нестандартных схем.
      fileName = fileName.split('?')[0].split('#')[0];

      // Файлы без расширения получают суффикс по Content-Type
      // (API-роуты вида /posts/42 -> 42.json).
      if (!fileName.includes('.')) {
        fileName += extFromMime || '.txt';
      }

      // URL API возвращает path в percent-encoding: вернём исходные символы
      // (папки с кириллицей, пробелами и т.п.), невалидные %-последовательности
      // декодируем «как есть». Затем вычищаем недопустимые символы ФС.
      const decodeSegment = (s) => {
        let out = s;
        try { out = decodeURIComponent(s); } catch (_) { /* оставить как есть */ }
        return out.replace(this._INVALID_CHARS, '_');
      };

      fileName = decodeSegment(fileName);

      const dirs = segments
        .filter((s) => s && s !== '.' && s !== '..') // анти zip-slip
        .map(decodeSegment);

      return [...dirs, fileName].join('/');
    } catch (e) {
      // Резерв: URL не парсится — плоский безопасный файл в extracted_assets/.
      const flat = urlStr.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-64);
      return 'extracted_assets/' + (flat || 'unnamed') + (extFromMime || '.bin');
    }
  },

  /** Разрешает коллизии путей (одинаковые файлы с разных хостов). */
  makeUnique(path, usedPaths) {
    if (!usedPaths.has(path)) return usedPaths.add(path), path;

    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    const dir = slash > -1 ? path.slice(0, slash + 1) : '';
    const stem = path.slice(slash + 1, dot > slash ? dot : undefined);
    const ext = dot > slash ? path.slice(dot) : '';

    let n = 1;
    let candidate;
    do {
      candidate = `${dir}${stem}_${n}${ext}`;
      n += 1;
    } while (usedPaths.has(candidate));
    usedPaths.add(candidate);
    return candidate;
  },
};

// ─── PathFilter: подстрока, /regex/ или «сырое» выражение ──────────────────
const PathFilter = {
  /**
   * Поддержка трёх форматов:
   *   "dist/vite"          — подстрока (регистронезависимо)
   *   "/.*\.png$/i"        — явный RegExp с флагами
   *   ".*\.js$"            — сырое выражение (если валидно как RegExp)
   * @param {string} value
   * @returns {{ regex: RegExp|null, error: string|null }}
   */
  compile(value) {
    const raw = String(value || '').trim();
    if (!raw) return { regex: null, error: null };

    const wrapped = raw.match(/^\/(.+)\/([a-z]*)$/s);
    if (wrapped) {
      try {
        return {
          regex: new RegExp(wrapped[1], wrapped[2] || undefined),
          error: null,
        };
      } catch (e) {
        return { regex: null, error: 'Невалидный RegExp: ' + e.message };
      }
    }

    try {
      return { regex: new RegExp(raw), error: null };
    } catch (_) {
      // Фолбэк: экранируем метасимволы и ищем как подстроку.
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { regex: new RegExp(escaped, 'i'), error: null };
    }
  },

  matches(regex, entry) {
    return !regex || regex.test(entry.request.url);
  },
};

// ─── SourceMapExtractor: распаковка оригинальных файлов из .map ───────────
const SourceMapExtractor = {
  _decodeBase64(str) {
    if (typeof atob === 'function') {
      try { return atob(str); } catch (_) {}
    }
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(str, 'base64').toString('utf8'); } catch (_) {}
    }
    return '';
  },

  /** Запрос через background service worker расширения (без CORS-ограничений страницы). */
  async _fetchViaBackground(url) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'fetchUrl', url }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            resolve(null);
          } else {
            resolve(typeof resp.text === 'string' ? resp.text : null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  },

  /** Запрос через контекст открытой страницы (same-origin с куками и сессией). */
  async _fetchViaPage(url) {
    if (
      typeof chrome === 'undefined' ||
      !chrome.devtools ||
      !chrome.devtools.inspectedWindow ||
      !chrome.devtools.inspectedWindow.eval
    ) {
      return null;
    }
    return new Promise((resolve) => {
      // Исполняем синхронный XHR внутри контекста инспектируемой вкладки
      const code = `(function() {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', ${JSON.stringify(url)}, false);
          xhr.withCredentials = true;
          xhr.send(null);
          if (xhr.status >= 200 && xhr.status < 300) {
            return xhr.responseText;
          }
        } catch (_) {}
        return null;
      })()`;
      try {
        chrome.devtools.inspectedWindow.eval(code, (result, isException) => {
          if (!isException && typeof result === 'string' && result.length > 0) {
            resolve(result);
          } else {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  },

  /** Прямой fetch (фоллбэк для тестовых сред и открытых CDN). */
  async _fetchDirect(url) {
    if (typeof fetch !== 'function') return null;
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.text();
    } catch (_) {}
    return null;
  },

  /** Универсальный загрузчик текста по URL (Background -> Page Eval -> Direct). */
  async fetchText(url) {
    if (!url || typeof url !== 'string') return null;
    let res = await this._fetchViaBackground(url);
    if (typeof res === 'string' && res.length > 0) return res;
    res = await this._fetchViaPage(url);
    if (typeof res === 'string' && res.length > 0) return res;
    return await this._fetchDirect(url);
  },

  /**
   * Находит и извлекает Source Map из содержимого JS/CSS, заголовков или сетевых записей.
   * @param {string} content
   * @param {string} fileUrl
   * @param {Array} entries
   * @param {Object?} entry
   * @returns {Promise<{ map: Object, mapUrl: string }|null>}
   */
  async extract(content, fileUrl, entries = [], entry = null) {
    if (!content || typeof content !== 'string') return null;

    // 1. Сам файл является картой .map
    if (fileUrl && /\.map(\?.*)?$/i.test(fileUrl)) {
      try {
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.sources)) {
          return { map: parsed, mapUrl: fileUrl };
        }
      } catch (_) {}
    }

    // 2. Ищем директиву sourceMappingURL или заголовок SourceMap
    let mapRef = null;
    const match =
      content.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/) ||
      content.match(/\/\*[#@]\s*sourceMappingURL=([^\s'"]+)\s*\*\//);
    if (match) {
      mapRef = match[1].trim();
    } else if (entry && entry.response && Array.isArray(entry.response.headers)) {
      const h = entry.response.headers.find(
        (x) => x && /^(sourcemap|x-sourcemap)$/i.test(x.name)
      );
      if (h && h.value) mapRef = h.value.trim();
    }

    if (!mapRef) return null;

    // 2.1 Inline Data URL
    if (mapRef.startsWith('data:')) {
      try {
        if (mapRef.includes('base64,')) {
          const b64 = mapRef.split('base64,')[1];
          const decoded = this._decodeBase64(b64);
          const parsed = JSON.parse(decoded);
          return parsed ? { map: parsed, mapUrl: fileUrl } : null;
        }
        const raw = decodeURIComponent(mapRef.split(',')[1] || '');
        const parsed = JSON.parse(raw);
        return parsed ? { map: parsed, mapUrl: fileUrl } : null;
      } catch (err) {
        console.warn('[SourceMap] Failed to decode inline map:', err.message);
        return null;
      }
    }

    // 2.2 Внешний URL к .map
    if (fileUrl) {
      try {
        const resolvedUrl = new URL(mapRef, fileUrl).href;

        // Проверяем, был ли .map уже загружен среди сетевых записей
        const existingEntry = entries.find((e) => {
          if (!e.request || !e.request.url) return false;
          return e.request.url.split('?')[0] === resolvedUrl.split('?')[0];
        });

        if (existingEntry) {
          const body = await new Promise((resolve) => {
            try {
              existingEntry.getContent((c) => resolve(c));
            } catch (_) {
              resolve(null);
            }
          });
          if (body) {
            try {
              const parsed = JSON.parse(body);
              if (parsed && Array.isArray(parsed.sources)) {
                return { map: parsed, mapUrl: resolvedUrl };
              }
            } catch (_) {}
          }
        }

        // Если не найден в записях — загружаем через универсальный загрузчик
        const rawText = await this.fetchText(resolvedUrl);
        if (rawText) {
          try {
            const parsed = JSON.parse(rawText);
            if (parsed && Array.isArray(parsed.sources)) {
              return { map: parsed, mapUrl: resolvedUrl };
            }
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[SourceMap] Failed to resolve/fetch external map:', err.message);
      }
    }

    return null;
  },

  /**
   * Очищает относительный путь из Source Map от схем и мусора.
   */
  cleanPath(srcPath) {
    if (!srcPath || typeof srcPath !== 'string') return 'unnamed.js';
    let p = srcPath.trim();
    // Срезаем DevTools префикс "(From ...)"
    p = p.replace(/^\(From [^)]+\)\/?/i, '');
    // Срезаем webpack://, vite://, turbopack:// и др.
    p = p.replace(/^[a-z0-9_-]+:\/\/[^/]*\/?/i, '');
    p = p.replace(/[?#].*$/, '');
    p = p.replace(/^(\.\.\/|\.\/|\/|\\)+/g, '');
    p = p.replace(/\\/g, '/');
    p = p.replace(/\/+/g, '/');
    const parts = p
      .split('/')
      .filter(Boolean)
      .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
    return parts.join('/') || 'unnamed.js';
  },

  /**
   * Распаковывает массив оригинальных файлов { path, content } из карты.
   * Если sourcesContent отсутствует, докачивает файлы относительно mapUrl.
   */
  async unpack(mapJson, mapUrl) {
    if (!mapJson || !Array.isArray(mapJson.sources)) return [];
    const sources = mapJson.sources;
    const contents = Array.isArray(mapJson.sourcesContent) ? mapJson.sourcesContent : [];
    const sourceRoot = mapJson.sourceRoot || '';
    const files = [];

    for (let i = 0; i < sources.length; i++) {
      const rawPath = sources[i];
      let content = contents[i];

      // Фоллбэк: если в sourcesContent нет тела, пробуем загрузить файл с сервера
      if ((typeof content !== 'string' || content.length === 0) && mapUrl) {
        try {
          let base = mapUrl;
          if (sourceRoot) {
            base = new URL(sourceRoot, mapUrl).href;
          }
          const srcUrl = new URL(rawPath, base).href;
          const fetched = await this.fetchText(srcUrl);
          if (typeof fetched === 'string') {
            content = fetched;
          }
        } catch (_) {}
      }

      if (typeof content !== 'string') continue;

      const clean = this.cleanPath(rawPath);
      files.push({
        path: `sources/${clean}`,
        content,
      });
    }

    return files;
  },
};

// ─── DownloadEngine: оркестратор сборки .ZIP ────────────────────────────────
const DownloadEngine = {
  /**
   * Собирает .ZIP из перехваченных ресурсов.
   * @param {{ entries: Array, regex: RegExp?, categories: Set<string>|null,
   *           onProgress: Function, onStatus: Function }} opts
   * @returns {Promise<Blob|null>}
   */
  async buildZip(opts) {
    const { entries, regex, categories, noCompression, unpackSourceMaps, onProgress, onStatus } = opts;

    // ── I. Фильтрация (путь + выбранные типы) + pre-flight ──
    if (categories && categories.size === 0) {
      // Дефенс-проверка: UI обычно не даёт дойти сюда с пустым набором.
      onStatus({ type: 'notice', message: 'Не выбран ни один тип ресурсов (чекбоксы «Типы»).' });
      return null;
    }
    const typeOk = (entry) =>
      !categories || categories.has(ResourceType.classify(entry.response.content.mimeType));
    const matched = entries.filter(
      (e) => PathFilter.matches(regex, e) && typeOk(e)
    );
    if (matched.length === 0) {
      onStatus({ type: 'notice', message: 'Нет файлов, соответствующих фильтру и выбранным типам.' });
      return null;
    }
    if (matched.length > CONFIG.MAX_FILES) {
      onStatus({
        type: 'error',
        message: `Слишком много файлов (${matched.length}); лимит — ${CONFIG.MAX_FILES}. Уточните фильтр.`,
      });
      return null;
    }

    // ── II. Уникализация zip-путей ──
    const usedPaths = new Set();
    const zipPathOf = new Map();
    for (const entry of matched) {
      const rawPath = PathNormalizer.build(
        entry.request.url,
        entry.response.content.mimeType
      );
      zipPathOf.set(entry, PathNormalizer.makeUnique(rawPath, usedPaths));
    }    const totalFiles = matched.length;
    const zip = new JSZip();
    const skipped = { tooBig: 0, noContent: 0, failed: 0 };
    // Карта реально добавленных в архив файлов для assets_manifest.json.
    const manifestFiles = [];
    let totalBytes = 0;
    let processedCount = 0;

    // ── III. Упаковка пачками: getContent() читается параллельно пачками
    // по FETCH_BATCH_SIZE (вместо одного файла за итерацию), запись в ZIP
    // остаётся последовательной — порядок путей, счётчиков и прогресса
    // детерминирован. На сайтах с сотнями ресурсов это кратно быстрее.
    for (let i = 0; i < matched.length; i += CONFIG.FETCH_BATCH_SIZE) {
      const batch = matched.slice(i, i + CONFIG.FETCH_BATCH_SIZE);

      // Фаза 1: планирование — лимиты размеров ДО чтения тела,
      // чтобы не тратить getContent() на заведомо пропускаемые файлы.
      const planned = new Map(); // entry -> declaredSize | null (пропуск)
      const toFetch = [];
      let batchPlannedBytes = 0;
      for (const entry of batch) {
        const declaredSize = entry.response.content.size || 0;
        if (
          declaredSize > CONFIG.MAX_FILE_SIZE_BYTES ||
          totalBytes + batchPlannedBytes + declaredSize > CONFIG.MAX_TOTAL_SIZE_BYTES
        ) {
          planned.set(entry, null); // свыше лимита
        } else {
          planned.set(entry, declaredSize);
          batchPlannedBytes += declaredSize;
          toFetch.push(entry);
        }
      }

      // Фаза 2: параллельное чтение тел (getContent не блокирует event loop).
      const contents = await Promise.all(
        toFetch.map((entry) => this._fetchContent(entry))
      );
      const contentOf = new Map();
      toFetch.forEach((entry, idx) => contentOf.set(entry, contents[idx]));

      // Фаза 3: последовательная запись в ZIP.
      for (const entry of batch) {
        const zipPath = zipPathOf.get(entry);
        const declaredSize = planned.get(entry);
        try {
          if (declaredSize == null) {
            // В пачке 1 помечено как превышение лимита.
            skipped.tooBig += 1;
          } else {
            const contentData = contentOf.get(entry);
            if (!contentData || contentData.content == null) {
              // Тела нет (ресурс получен до открытия DevTools и вытеснен
              // из disk cache) либо getContent() превысил таймаут.
              skipped.noContent += 1;
            } else if (contentData.encoding === 'base64') {
              // Бинарные ресурсы (картинки, шрифты, wasm) — base64-декод на лету.
              zip.file(zipPath, contentData.content, { base64: true });
              totalBytes += declaredSize;
              manifestFiles.push({
                url: entry.request.url,
                path: zipPath,
                mime: entry.response.content.mimeType || '',
                bytes: declaredSize,
              });
            } else {
              // Текстовые данные (JS, CSS, HTML, JSON) — как есть.
              zip.file(zipPath, contentData.content);
              totalBytes += declaredSize;
              manifestFiles.push({
                url: entry.request.url,
                path: zipPath,
                mime: entry.response.content.mimeType || '',
                bytes: declaredSize,
              });

              // ── Распаковка Source Maps (если включена опция) ──
              if (unpackSourceMaps !== false && typeof contentData.content === 'string') {
                try {
                  const mapResult = await SourceMapExtractor.extract(
                    contentData.content,
                    entry.request.url,
                    entries,
                    entry
                  );
                  if (mapResult && mapResult.map) {
                    const extracted = await SourceMapExtractor.unpack(
                      mapResult.map,
                      mapResult.mapUrl
                    );
                    for (const item of extracted) {
                      const uniquePath = PathNormalizer.makeUnique(item.path, usedPaths);
                      zip.file(uniquePath, item.content);
                      totalBytes += item.content.length;
                      manifestFiles.push({
                        url: `${entry.request.url}#${item.path}`,
                        path: uniquePath,
                        mime: 'text/typescript',
                        bytes: item.content.length,
                        fromSourceMap: true,
                      });
                    }
                  }
                } catch (mapErr) {
                  console.warn('[SourceMap] Error unpacking map for ' + entry.request.url, mapErr);
                }
              }
            }
          }
        } catch (err) {
          // Сбой чтения тела одного файла не роняет весь архив.
          console.error('Не удалось прочитать контент для: ' + entry.request.url, err);
          skipped.failed += 1;
        }

        processedCount += 1;
        // Каждый шаг — await, event loop остаётся отзывчивым: UI не «морозит».
        await onProgress({
          type: 'file',
          processedCount,
          totalFiles,
          currentFile: zipPath,
        });
      }
    }

    // ── IV. Сгенерировать архив ──
    const packedCount = manifestFiles.length;
    if (packedCount <= 0) {
      onStatus({
        type: 'notice',
        message: 'Все файлы были пропущены: ' +
          (skipped.noContent ? `без тела: ${skipped.noContent}` : '') +
          (skipped.tooBig ? ` свыше лимита: ${skipped.tooBig}` : '') +
          (skipped.failed ? `, ошибок чтения: ${skipped.failed}` : ''),
      });
      return null;
    }

    const skipSummary =
      (skipped.tooBig ? `, пропущено (лимит): ${skipped.tooBig}` : '') +
      (skipped.noContent ? `, без тела: ${skipped.noContent}` : '') +
      (skipped.failed ? `, ошибок чтения: ${skipped.failed}` : '');

    // ── V. Манифест: карта URL -> путь внутри архива ──
    if (manifestFiles.length > 0) {
      // Если сервер реально отдал файл с именем из манифеста — по makeUnique
      // манифест уйдёт в assets_manifest_1.json, реальный файл не затрётся.
      const manifestPath = PathNormalizer.makeUnique('assets_manifest.json', usedPaths);
      zip.file(
        manifestPath,
        JSON.stringify(
          {
            generator: 'Asset Extractor (DevTools extension)',
            generatedAt: new Date().toISOString(),
            fileCount: manifestFiles.length,
            totalBytes: totalBytes,
            files: manifestFiles,
          },
          null,
          2
        )
      );
    }

    onStatus({
      type: 'info',
      message: 'Генерация ZIP-архива...',
      detail: `В архив войдёт ${packedCount} файлов (${this._fmtBytes(totalBytes)})${skipSummary}`,
    });

    try {
      // streamFiles: JSZip стримит файлы в архив один за другим, не копя
      // весь несжатый и сжатый архив в памяти одновременно — это главная
      // защита вкладки от Out-Of-Memory при сотнях ресурсов.
      // STORE вместо DEFLATE: png/woff2/mp4 уже сжаты, повторное сжатие
      // только тратит CPU и время без выигрыша по размеру.
      const zipOptions = { type: 'blob', streamFiles: true };
      if (noCompression) {
        zipOptions.compression = 'STORE';
      } else {
        zipOptions.compression = 'DEFLATE';
        zipOptions.compressionOptions = { level: 6 };
      }
      const blob = await zip.generateAsync(
        zipOptions,
        (metadata) => {
          onProgress({
            type: 'compress',
            percent: Math.floor(metadata.percent || 0),
            currentFile: metadata.currentFile,
          });
        }
      );
      return blob;
    } catch (zipErr) {
      onStatus({ type: 'error', message: 'Ошибка архивации: ' + zipErr.message });
      console.error(zipErr);
      return null;
    }
  },

  /**
   * Читает тело одного ресурса с guard-таймаутом: getContent() может
   * повиснуть на вытесненном из disk cache ресурсе — вернём null вместо
   * бесконечного ожидания.
   * @returns {Promise<{content: string, encoding: string?}|null>}
   */
  _fetchContent(entry) {
    if (typeof entry.getContent !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), CONFIG.CONTENT_TIMEOUT_MS);
      try {
        entry.getContent((content, encoding) => done({ content, encoding }));
      } catch (_) {
        done(null);
      }
    });
  },

  /**
   * Имя архива по домену страницы-источника: host большинства перехваченных
   * ресурсов + дата — архивы с разных сайтов различаются на диске.
   * @returns {string} например "example.com_2026-10-22.zip"
   */
  fileNameFor(entries, regex, categories) {
    const typeOk = (entry) =>
      !categories || categories.has(ResourceType.classify(entry.response.content.mimeType));
    const counts = new Map();
    for (const entry of entries.filter((e) => PathFilter.matches(regex, e) && typeOk(e))) {
      try {
        const host = new URL(entry.request.url).hostname;
        counts.set(host, (counts.get(host) || 0) + 1);
      } catch (_) { /* непарсируемый URL не участвует в голосовании */ }
    }
    let best = '';
    let bestN = 0;
    for (const [host, n] of counts) {
      if (n > bestN) {
        best = host;
        bestN = n;
      }
    }
    const site = best.replace(/^www\./i, '').replace(/[^a-zA-Z0-9.-]/g, '');
    const stamp = new Date().toISOString().slice(0, 10);
    return (site ? site : 'assets') + '_' + stamp + '.zip';
  },

  _fmtBytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = n;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i += 1;
    }
    return `${Math.round(val * 10) / 10} ${units[i]}`;
  },
};

// ─── PanelSaver: сохранение в средах с/без chrome.downloads ────────────────
const PanelSaver = {
  /**
   * @param {Blob} blob успешно собранный ZIP
   * @param {string} fileName желаемое имя файла
   * @returns {boolean} true, если сохранение пошло через chrome.downloads
   */
  save(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);

    if (
      typeof chrome !== 'undefined' &&
      chrome.downloads &&
      chrome.downloads.download
    ) {
      chrome.downloads.download(
        { url: blobUrl, filename: fileName, saveAs: true },
        () => {
          // Освобождаем Blob-ссылку после старта закачки.
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }
      );
      return true;
    }

    // Фолбэк: среда без Downloads API (Electron DevTools / WebView2 и т.п.)
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    return false;
  },
};

// ─── PanelUI: DOM-привязка и индикация статуса ──────────────────────────────
const PanelUI = {
  el: {},

  bind() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      filter: $('path-filter'),
      btnDownload: $('btn-download'),
      btnClear: $('btn-clear'),
      fileCount: $('file-count'),
      matchCount: $('match-count'),
      statusText: $('status-text'),
      progressBg: $('progress-bg'),
      progressFill: $('progress-fill'),
      typeInputs: document.querySelectorAll('input.type-filter'),
      optNoCompress: $('opt-no-compress'),
      optUnpackMaps: $('opt-unpack-maps'),
    };
  },

  /** Чекбокс «Без сжатия» (STORE вместо DEFLATE). */
  getNoCompression() {
    return !!(this.el.optNoCompress && this.el.optNoCompress.checked);
  },

  /** Чекбокс «Распаковать Source Maps». */
  getUnpackSourceMaps() {
    return this.el.optUnpackMaps ? !!this.el.optUnpackMaps.checked : true;
  },

  /** Выбранные категории ресурсов (значения чекбоксов «Типы»). */
  getSelectedTypes() {
    const selected = new Set();
    for (const box of this.el.typeInputs) {
      if (box.checked) selected.add(box.value);
    }
    return selected;
  },

  setCount(n) {
    this.el.fileCount.textContent = String(n);
  },

  setMatchDetail(text) {
    this.el.matchCount.textContent = text;
  },

  setStatus(text, kind) {
    this.el.statusText.textContent = text;
    this.el.statusText.className = kind === 'error' ? 'error' : kind === 'done' ? 'done' : '';
  },

  showProgress() {
    this.el.progressBg.style.display = 'block';
    this.el.progressFill.style.width = '0%';
    this.el.progressFill.classList.remove('compressing');
  },

  setProgress(percent, compressing) {
    this.el.progressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (compressing) this.el.progressFill.classList.add('compressing');
  },

  hideProgress() {
    // Задержка, чтобы пользователь увидел 100%.
    setTimeout(() => {
      this.el.progressBg.style.display = 'none';
    }, 3000);
  },

  setBusy(busy) {
    this.el.btnDownload.disabled = busy;
    this.el.btnClear.disabled = busy;
  },
};

// ─── SettingsPersist: фильтр/типы/опции переживают закрытие DevTools ──────
const SETTINGS_KEY = 'assetExtractor.settings';

const SettingsPersist = {
  /**
   * Восстановление прошлого состояния UI при открытии панели.
   * chrome.storage требует MV3 permission 'storage'; в средах без него
   * настройки просто не доступны — молча пропускаем.
   * @param {Function?} onRestore вызывается после применения настроек
   *        (например, чтобы пересчитать счётчик совпадений)
   */
  load(onRestore) {
    try {
      if (!chrome.storage || !chrome.storage.local || !chrome.storage.local.get) return;
      chrome.storage.local.get(SETTINGS_KEY, (data) => {
        try {
          const s = data && data[SETTINGS_KEY];
          if (!s) return;
          if (typeof s.filter === 'string') PanelUI.el.filter.value = s.filter;
          if (Array.isArray(s.types)) {
            for (const box of PanelUI.el.typeInputs) {
              box.checked = s.types.indexOf(box.value) !== -1;
            }
          }
          if (typeof s.noCompression === 'boolean' && PanelUI.el.optNoCompress) {
            PanelUI.el.optNoCompress.checked = s.noCompression;
          }
          if (typeof s.unpackSourceMaps === 'boolean' && PanelUI.el.optUnpackMaps) {
            PanelUI.el.optUnpackMaps.checked = s.unpackSourceMaps;
          }
          if (typeof onRestore === 'function') onRestore();
        } catch (_) {
          /* битые/чужие настройки не роняют панель */
        }
      });
    } catch (_) {
      /* нет chrome.storage — настройки просто не сохраняются */
    }
  },

  /** Запись текущего состояния UI (вызывается из слушателей событий). */
  save() {
    try {
      if (!chrome.storage || !chrome.storage.local || !chrome.storage.local.set) return;
      chrome.storage.local.set({
        [SETTINGS_KEY]: {
          filter: PanelUI.el.filter.value,
          types: Array.from(PanelUI.getSelectedTypes()),
          noCompression: PanelUI.getNoCompression(),
          unpackSourceMaps: PanelUI.getUnpackSourceMaps(),
        },
      });
    } catch (_) {
      /* нет chrome.storage */
    }
  },
};

// ─── Инициализация панели ───────────────────────────────────────────────────
(function init() {
  PanelUI.bind();

  /** Обновляет счётчик совпадений по пути + типам (ввод, перехват, чекбоксы). */
  const updateMatchDetail = () => {
    const { regex, error } = PathFilter.compile(PanelUI.el.filter.value);
    if (error) {
      PanelUI.setMatchDetail(error);
      return;
    }
    const types = PanelUI.getSelectedTypes();
    const knownTypes = PanelUI.el.typeInputs.length;
    if (!regex && types.size === knownTypes) {
      PanelUI.setMatchDetail('');
      return;
    }
    const matched = EntryStore.list().filter((entry) =>
      PathFilter.matches(regex, entry) &&
      types.has(ResourceType.classify(entry.response.content.mimeType))
    );
    const label =
      regex && types.size < knownTypes ? 'Совпадает по пути и типам: '
        : regex ? 'Совпадает с фильтром: '
        : 'Совпадает по типам: ';
    PanelUI.setMatchDetail(label + matched.length);
  };

  // 1. Backfill: ресурсы инспектируемой страницы через getResources() и getHAR().
  // getResources() захватывает ВСЕ ресурсы страницы из дерева Sources,
  // даже если они загрузились до открытия DevTools.
  EntryStore.harvest().then(updateMatchDetail);

  if (
    typeof chrome !== 'undefined' &&
    chrome.devtools &&
    chrome.devtools.inspectedWindow &&
    chrome.devtools.inspectedWindow.onResourceAdded
  ) {
    try {
      chrome.devtools.inspectedWindow.onResourceAdded.addListener((res) => {
        if (!res || !res.url || !res.url.startsWith('http')) return;
        if (!EntryStore._entries.has(res.url)) {
          EntryStore._entries.set(res.url, EntryStore.wrapResource(res));
          EntryStore._notify();
        }
      });
    } catch (_) {}
  }

  try {
    chrome.devtools.network.getHAR((harLog) => {
      if (!harLog || !Array.isArray(harLog.entries)) return;
      for (const entry of harLog.entries) {
        if (!entry.request.url.startsWith('http')) continue;
        if (!EntryStore._entries.has(entry.request.url)) {
          EntryStore._entries.set(entry.request.url, entry);
        }
      }
      EntryStore._notify();
    });
  } catch (_) {
    /* getHAR недоступен — live-перехват всё равно работает */
  }

  // 2. Основной канал перехвата: точные, раскодированные тела ответов.
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    if (!request.request.url.startsWith('http')) return; // data:, devtools:, chrome-internal
    EntryStore.add(request);
  });

  // 3. Подписки UI.
  EntryStore.onChange(() => {
    PanelUI.setCount(EntryStore.size);
    updateMatchDetail();
  });
  PanelUI.el.filter.addEventListener('input', updateMatchDetail);
  // Чекбоксы «Типы»: пересчёт счётчика и переключение состояния на лету.
  for (const box of PanelUI.el.typeInputs) {
    box.addEventListener('change', updateMatchDetail);
  }

  // 3b. Персистентность: восстановить прошлый фильтр/типы/опции при
  //     открытии панели и сохранять их при изменениях (фильтр — с debounce,
  //     чтобы не писать в chrome.storage на каждый символ).
  SettingsPersist.load(updateMatchDetail);
  let persistTimer = null;
  PanelUI.el.filter.addEventListener('input', () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => SettingsPersist.save(), 400);
  });
  for (const box of PanelUI.el.typeInputs) {
    box.addEventListener('change', () => SettingsPersist.save());
  }
  if (PanelUI.el.optNoCompress) {
    PanelUI.el.optNoCompress.addEventListener('change', () => SettingsPersist.save());
  }
  if (PanelUI.el.optUnpackMaps) {
    PanelUI.el.optUnpackMaps.addEventListener('change', () => SettingsPersist.save());
  }

  // 4. Кнопка «Сброс» — очистка сессии перехвата.
  PanelUI.el.btnClear.addEventListener('click', () => {
    EntryStore.clear();
    PanelUI.setCount(0);
    PanelUI.setMatchDetail('');
    PanelUI.setStatus('Перехват сброшен. Новый трафик будет перехвачен.');
  });

  // 5. Кнопка скачивания -> DownloadEngine -> PanelSaver.
  PanelUI.el.btnDownload.addEventListener('click', async () => {
    // Дособираем все ресурсы из дерева Sources перед началом
    await EntryStore.harvest();
    updateMatchDetail();

    const { regex, error } = PathFilter.compile(PanelUI.el.filter.value);
    if (error) {
      PanelUI.setStatus(error, 'error');
      return;
    }
    if (EntryStore.size === 0) {
      PanelUI.setStatus('Нет перехваченных ресурсов. Обновите страницу.', 'error');
      return;
    }

    const types = PanelUI.getSelectedTypes();
    if (types.size === 0) {
      // Все категории сняты — архивировать нечего, не запускаем пустую сборку.
      PanelUI.setStatus('Выберите хотя бы один тип ресурсов (чекбоксы «Типы» над кнопкой).', 'error');
      return;
    }

    PanelUI.setBusy(true);
    PanelUI.setStatus('Запуск архивации...');
    PanelUI.showProgress();

    let skipNotice = null;

    try {
      const blob = await DownloadEngine.buildZip({
        entries: EntryStore.list(),
        regex,
        categories: types,
        noCompression: PanelUI.getNoCompression(),
        unpackSourceMaps: PanelUI.getUnpackSourceMaps(),

        // Прогресс: «Упаковка: имя (X из Y)» / «Сжатие: NN%».
        onProgress: (info) => {
          if (info.type === 'file') {
            PanelUI.setStatus(
              `Упаковка: ${info.currentFile.split('/').pop()} ` +
                `(${info.processedCount} из ${info.totalFiles})...`
            );
            PanelUI.setProgress(
              Math.floor((info.processedCount / info.totalFiles) * 100),
              false
            );
          } else if (info.type === 'compress') {
            PanelUI.setStatus(
              info.currentFile
                ? `Сжатие: ${info.currentFile} (${info.percent}%)`
                : `Сжатие архива: ${info.percent}%`
            );
            PanelUI.setProgress(info.percent, true);
          }
        },

        // Финальные статусы от движка (notice / error / info).
        onStatus: (st) => {
          if (st.type === 'notice') skipNotice = st.message;
        },
      });

      if (!blob) {
        PanelUI.setStatus(skipNotice || 'Нечего сохранять.');
        return;
      }

      PanelUI.setStatus('Сохранение файла на диск...');
      const fileName = DownloadEngine.fileNameFor(EntryStore.list(), regex, types);
      const viaDownloadsApi = PanelSaver.save(blob, fileName);

      PanelUI.setStatus(
        skipNotice
          ? skipNotice + ' Архив готов и скачан.'
          : viaDownloadsApi
            ? 'Готово! Архив отправлен в загрузки (chrome.downloads).'
            : 'Готово! Архив сохранён (Blob download).',
        'done'
      );
    } catch (err) {
      PanelUI.setStatus('Неожиданная ошибка: ' + err.message, 'error');
      console.error(err);
    } finally {
      PanelUI.setBusy(false);
      PanelUI.hideProgress();
    }
  });
})();
