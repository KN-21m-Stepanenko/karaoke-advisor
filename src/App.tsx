import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

interface Song {
  id: string;
  artist: string;
  title: string;
  url: string;
  createdAt: number;
}

type View = 'list' | 'add' | 'view';

const STORAGE_KEY = 'karaoke-songs-db';

function loadSongs(): Song[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveSongs(songs: Song[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 30);
  }
}

// List of CORS proxies to try in order
const CORS_PROXIES = [
  (url: string) => `/api/fetch?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// Fetch HTML through proxy, trying multiple services
async function fetchThroughProxy(url: string): Promise<string | null> {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(url);
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const text = await response.text();
        if (text && text.length > 100) {
          return text;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

// Clean HTML for display in iframe
function cleanHtmlForIframe(html: string, originalUrl: string): string {
  let cleaned = html;
  
  // Remove framing restrictions
  cleaned = cleaned
    .replace(/<meta[^>]*http-equiv\s*=\s*["']X-Frame-Options["'][^>]*>/gi, '')
    .replace(/<meta[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, '')
    .replace(/frame-ancestors\s+[^;]*/gi, '');

  // Parse URL for base
  let baseUrl: string;
  try {
    const parsed = new URL(originalUrl);
    baseUrl = `${parsed.origin}${parsed.pathname.replace(/[^/]*$/, '')}`;
  } catch {
    baseUrl = originalUrl;
  }

  // Inject base tag
  const baseTag = `<base href="${baseUrl}" target="_blank">`;
  if (cleaned.includes('<head>')) {
    cleaned = cleaned.replace('<head>', `<head>${baseTag}`);
  } else if (/<head\s[^>]*>/.test(cleaned)) {
    cleaned = cleaned.replace(/<head\s[^>]*>/, (m) => `${m}${baseTag}`);
  } else {
    cleaned = `<head>${baseTag}</head>${cleaned}`;
  }

  // Add dark theme styles
  const styles = `
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        line-height: 1.6 !important;
        color: #e5e7eb !important;
        background: #111827 !important;
        padding: 1rem !important;
        margin: 0 !important;
      }
      a { color: #a78bfa !important; text-decoration: underline !important; }
      a:hover { color: #c4b5fd !important; }
      pre, code { 
        background: #1f2937 !important; 
        color: #f3f4f6 !important;
        border-radius: 0.5rem !important;
        padding: 0.5rem !important;
        font-size: 0.9rem !important;
      }
      img { max-width: 100% !important; height: auto !important; }
      h1, h2, h3, h4 { color: #f3f4f6 !important; }
      table { border-collapse: collapse !important; width: 100% !important; }
      td, th { padding: 4px 8px !important; border: 1px solid #374151 !important; }
    </style>
  `;
  cleaned = cleaned.replace('</head>', `${styles}</head>`);

  // Script to open links in new tab and prevent frame-busting
  const script = `
    <script>
      document.addEventListener('click', function(e) {
        var a = e.target.closest('a');
        if (a && a.href) {
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener,noreferrer');
        }
      });
    </script>
  `;
  cleaned = cleaned.replace('</body>', `${script}</body>`);

  return cleaned;
}

export default function App() {
  const [songs, setSongs] = useState<Song[]>(loadSongs);
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState('');
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [formData, setFormData] = useState({ artist: '', title: '', url: '' });
  const [formError, setFormError] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentHtml, setContentHtml] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importText, setImportText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveSongs(songs);
  }, [songs]);

  const filteredSongs = useMemo(() => {
    if (!filter.trim()) return songs;
    const q = filter.toLowerCase();
    return songs.filter(
      (s) =>
        s.artist.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q)
    );
  }, [songs, filter]);

  const handleAdd = useCallback(() => {
    setFormError('');
    const { artist, title, url } = formData;
    if (!artist.trim() || !title.trim() || !url.trim()) {
      setFormError('Заполните все поля');
      return;
    }
    try {
      new URL(url);
    } catch {
      setFormError('Введите корректную ссылку (https://...)');
      return;
    }
    const newSong: Song = {
      id: generateId(),
      artist: artist.trim(),
      title: title.trim(),
      url: url.trim(),
      createdAt: Date.now(),
    };
    setSongs((prev) => [newSong, ...prev]);
    setFormData({ artist: '', title: '', url: '' });
    setView('list');
  }, [formData]);

  const handleRandom = useCallback(() => {
    if (songs.length === 0) return;
    const idx = Math.floor(Math.random() * songs.length);
    setSelectedSong(songs[idx]);
    setView('view');
  }, [songs]);

  const handleSelectSong = useCallback((song: Song) => {
    setSelectedSong(song);
    setView('view');
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    if (selectedSong?.id === id) {
      setSelectedSong(null);
      setView('list');
    }
  }, [selectedSong]);

  // Load content when viewing a song
  useEffect(() => {
    if (view !== 'view' || !selectedSong) return;

    let cancelled = false;
    setContentLoading(true);
    setContentHtml(null);
    setContentError(false);

    fetchThroughProxy(selectedSong.url).then((html) => {
      if (cancelled) return;
      if (html) {
        const cleaned = cleanHtmlForIframe(html, selectedSong.url);
        setContentHtml(cleaned);
      } else {
        setContentError(true);
      }
      setContentLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setContentError(true);
      setContentLoading(false);
    });

    return () => { cancelled = true; };
  }, [view, selectedSong]);

  const handleExport = useCallback(() => {
    const data = JSON.stringify(songs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'karaoke-songs-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [songs]);

  const handleImport = useCallback(() => {
    try {
      const parsed = JSON.parse(importText);
      if (Array.isArray(parsed)) {
        const validSongs = parsed.filter(
          (s: any) => s.artist && s.title && s.url
        ).map((s: any) => ({
          id: s.id || generateId(),
          artist: String(s.artist),
          title: String(s.title),
          url: String(s.url),
          createdAt: s.createdAt || Date.now(),
        }));
        setSongs((prev) => [...validSongs, ...prev]);
        setImportText('');
        setShowExport(false);
      }
    } catch {
      setFormError('Некорректный JSON формат');
    }
  }, [importText]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (Array.isArray(parsed)) {
          const validSongs = parsed.filter(
            (s: any) => s.artist && s.title && s.url
          ).map((s: any) => ({
            id: s.id || generateId(),
            artist: String(s.artist),
            title: String(s.title),
            url: String(s.url),
            createdAt: s.createdAt || Date.now(),
          }));
          setSongs((prev) => [...validSongs, ...prev]);
        }
      } catch {
        alert('Ошибка чтения файла');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-800/50" style={{ backgroundColor: 'rgba(3, 7, 18, 0.85)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl sm:text-3xl">🎤</span>
            <div>
              <h1 className="text-lg sm:text-xl font-bold" style={{ background: 'linear-gradient(to right, #c084fc, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Караоке База
              </h1>
              <p className="text-xs text-gray-500 hidden sm:block">Песни с аккордами</p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setView('list')}
              className="px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all"
              style={{
                backgroundColor: view === 'list' ? 'rgba(147, 51, 234, 0.15)' : 'transparent',
                color: view === 'list' ? '#c4b5fd' : '#9ca3af',
                border: view === 'list' ? '1px solid rgba(147, 51, 234, 0.3)' : '1px solid transparent',
              }}
            >
              📋 <span className="hidden sm:inline">Список</span>
            </button>
            <button
              onClick={() => setView('add')}
              className="px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all"
              style={{
                backgroundColor: view === 'add' ? 'rgba(147, 51, 234, 0.15)' : 'transparent',
                color: view === 'add' ? '#c4b5fd' : '#9ca3af',
                border: view === 'add' ? '1px solid rgba(147, 51, 234, 0.3)' : '1px solid transparent',
              }}
            >
              ➕ <span className="hidden sm:inline">Добавить</span>
            </button>
            <button
              onClick={() => setShowExport(!showExport)}
              className="px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all"
              style={{
                color: showExport ? '#c4b5fd' : '#9ca3af',
                backgroundColor: showExport ? 'rgba(147, 51, 234, 0.15)' : 'transparent',
                border: showExport ? '1px solid rgba(147, 51, 234, 0.3)' : '1px solid transparent',
              }}
            >
              💾 <span className="hidden sm:inline">Данные</span>
            </button>
            <button
              onClick={handleRandom}
              disabled={songs.length === 0}
              className="btn-primary text-xs sm:text-sm px-3 sm:px-4 py-2"
            >
              🎲 <span className="hidden sm:inline">Случайная</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Export/Import Panel */}
      {showExport && (
        <div className="max-w-5xl mx-auto w-full px-4 pt-4">
          <div className="glass-card p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">📦 Управление данными</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={handleExport} className="btn-secondary text-xs">
                📥 Экспорт JSON
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-xs">
                📤 Импорт из файла
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileImport}
                className="hidden"
              />
              <button
                onClick={() => {
                  if (confirm('Удалить все песни? Это действие необратимо.')) {
                    setSongs([]);
                  }
                }}
                className="btn-danger text-xs"
              >
                🗑 Очистить всё
              </button>
            </div>
            <div className="flex gap-2">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Или вставьте JSON для импорта..."
                className="input-field text-xs"
                rows={2}
              />
              <button
                onClick={handleImport}
                disabled={!importText.trim()}
                className="btn-primary text-xs self-end"
              >
                Импорт
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              Всего песен в базе: {songs.length}
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-5">
        {/* Song List View */}
        {view === 'list' && (
          <div className="space-y-4">
            {/* Stats & Filter */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="text-sm text-gray-400">
                {songs.length === 0 ? (
                  <span>База пуста. Добавьте первую песню!</span>
                ) : (
                  <span>
                    {filteredSongs.length === songs.length
                      ? `${songs.length} песен`
                      : `${filteredSongs.length} из ${songs.length} песен`}
                  </span>
                )}
              </div>
              {songs.length > 0 && (
                <div className="relative w-full sm:w-72">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    🔍
                  </span>
                  <input
                    type="text"
                    placeholder="Поиск по исполнителю или названию..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: '2.25rem' }}
                  />
                  {filter && (
                    <button
                      onClick={() => setFilter('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-sm"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Empty State */}
            {songs.length === 0 && (
              <div className="glass-card p-10 sm:p-12 text-center">
                <div className="text-5xl sm:text-6xl mb-4">🎵</div>
                <h2 className="text-xl font-semibold text-gray-300 mb-2">
                  Пока нет песен
                </h2>
                <p className="text-gray-500 mb-6 text-sm max-w-sm mx-auto">
                  Добавляйте песни с аккордами и собирайте свою базу для караоке. 
                  Ссылки на amdm.ru, mychords.net, acords.ru и другие сайты.
                </p>
                <button
                  onClick={() => setView('add')}
                  className="btn-primary"
                >
                  ➕ Добавить первую песню
                </button>
              </div>
            )}

            {/* Song Grid */}
            {filteredSongs.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredSongs.map((song) => (
                  <div
                    key={song.id}
                    className="song-card group"
                    onClick={() => handleSelectSong(song)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-100 truncate group-hover:text-purple-300 transition-colors text-sm sm:text-base">
                          {song.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400 truncate mt-0.5">
                          {song.artist}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Удалить «${song.title}»?`)) {
                            handleDelete(song.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1 text-xs shrink-0"
                        title="Удалить"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-xs text-gray-600 truncate">
                        🔗 {getHostname(song.url)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No results */}
            {songs.length > 0 && filteredSongs.length === 0 && (
              <div className="glass-card p-8 text-center">
                <div className="text-4xl mb-3">🔍</div>
                <p className="text-gray-400">
                  Ничего не найдено по запросу «{filter}»
                </p>
                <button
                  onClick={() => setFilter('')}
                  className="btn-secondary text-sm mt-3"
                >
                  Сбросить фильтр
                </button>
              </div>
            )}
          </div>
        )}

        {/* Add Song View */}
        {view === 'add' && (
          <div className="max-w-lg mx-auto">
            <div className="glass-card p-5 sm:p-8">
              <h2 className="text-xl font-bold text-gray-100 mb-6 flex items-center gap-2">
                <span>➕</span> Новая песня
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Исполнитель
                  </label>
                  <input
                    type="text"
                    value={formData.artist}
                    onChange={(e) =>
                      setFormData({ ...formData, artist: e.target.value })
                    }
                    placeholder="Например: Кино"
                    className="input-field"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Название песни
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder="Например: Звезда по имени Солнце"
                    className="input-field"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Ссылка на текст с аккордами
                  </label>
                  <input
                    type="url"
                    value={formData.url}
                    onChange={(e) =>
                      setFormData({ ...formData, url: e.target.value })
                    }
                    placeholder="https://amdm.ru/akordi/kino/..."
                    className="input-field"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  />
                  <p className="text-xs text-gray-600 mt-1.5">
                    💡 Подойдут ссылки с amdm.ru, mychords.net, acords.ru, guitar.ru и других сайтов
                  </p>
                </div>

                {formError && (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                    ⚠️ {formError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button onClick={handleAdd} className="btn-primary flex-1">
                    💾 Сохранить
                  </button>
                  <button
                    onClick={() => {
                      setView('list');
                      setFormData({ artist: '', title: '', url: '' });
                      setFormError('');
                    }}
                    className="btn-secondary"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Song View */}
        {view === 'view' && selectedSong && (
          <div className="space-y-4">
            {/* Song Info Bar */}
            <div className="glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-100 truncate">
                  {selectedSong.title}
                </h2>
                <p className="text-sm text-gray-400 truncate">
                  {selectedSong.artist}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                <button
                  onClick={() => {
                    setContentLoading(true);
                    setContentHtml(null);
                    setContentError(false);
                    // Re-trigger the effect by toggling selectedSong
                    setSelectedSong({ ...selectedSong });
                  }}
                  className="btn-secondary text-sm px-3 py-2 flex-1 sm:flex-none"
                >
                  🔄 Обновить
                </button>
                <a
                  href={selectedSong.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm px-3 py-2 flex-1 sm:flex-none text-center"
                >
                  ↗ Оригинал
                </a>
                <button
                  onClick={() => setView('list')}
                  className="btn-secondary text-sm px-3 py-2 flex-1 sm:flex-none"
                >
                  ← Назад
                </button>
              </div>
            </div>

            {/* Content Display */}
            <div className="glass-card overflow-hidden relative" style={{ minHeight: '70vh' }}>
              {/* Loading */}
              {contentLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: 'rgba(3, 7, 18, 0.9)' }}>
                  <div className="text-center">
                    <div className="inline-block animate-spin text-4xl mb-3">🎵</div>
                    <p className="text-gray-400 text-sm">Загрузка текста с аккордами...</p>
                    <p className="text-gray-600 text-xs mt-1">{getHostname(selectedSong.url)}</p>
                    <div className="mt-3 flex items-center justify-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Content via srcdoc */}
              {contentHtml && !contentLoading && (
                <iframe
                  srcDoc={contentHtml}
                  title={`${selectedSong.title} - аккорды`}
                  className="w-full border-0"
                  style={{ height: '70vh' }}
                  sandbox="allow-same-origin allow-popups"
                />
              )}

              {/* Error / Fallback */}
              {contentError && !contentLoading && (
                <div className="p-8 text-center" style={{ minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="text-5xl mb-4">🔒</div>
                  <h3 className="text-lg font-semibold text-gray-300 mb-2">
                    Не удалось загрузить содержимое
                  </h3>
                  <p className="text-gray-500 mb-2 text-sm max-w-md mx-auto">
                    Сайт блокирует доступ к содержимому через прокси.
                  </p>
                  <p className="text-gray-600 mb-4 text-xs max-w-md mx-auto">
                    Это может быть связано с защитой сайта. Откройте ссылку напрямую для просмотра текста с аккордами.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <a
                      href={selectedSong.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary inline-block"
                    >
                      ↗ Открыть оригинал
                    </a>
                    <button
                      onClick={() => {
                        setContentLoading(true);
                        setContentHtml(null);
                        setContentError(false);
                        setSelectedSong({ ...selectedSong });
                      }}
                      className="btn-secondary"
                    >
                      🔄 Попробовать снова
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Info note */}
            <div className="glass-card p-3 flex items-start gap-2">
              <span className="text-sm">ℹ️</span>
              <p className="text-xs text-gray-500">
                Содержимое загружается через прокси-сервер. Если текст не отображается, 
                используйте кнопку «↗ Оригинал» для открытия страницы напрямую.
                При деплое на Vercel используется встроенный серверный прокси для максимальной совместимости.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 py-4 mt-auto">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-gray-600">
            🎤 Караоке База • Данные хранятся локально в вашем браузере
          </p>
          <p className="text-xs text-gray-700">
            {songs.length} {songs.length === 1 ? 'песня' : songs.length < 5 ? 'песни' : 'песен'} в коллекции
          </p>
        </div>
      </footer>
    </div>
  );
}
