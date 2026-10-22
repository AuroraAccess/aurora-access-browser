import React from 'react';
import './DownloadsDropdown.css';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function DownloadsDropdown({
  downloads = [],
  onOpenFile,
  onShowInFolder,
  onCancel,
  onClear,
  onClose: _onClose,
}) {
  return (
    <div className="downloads-dropdown">
      <div className="dl-header">
        <div className="dl-title-group">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Загрузки</span>
        </div>
        {downloads.length > 0 && (
          <button className="dl-clear-btn" onClick={onClear} title="Очистить завершённые">
            Очистить
          </button>
        )}
      </div>

      <div className="dl-list">
        {downloads.length === 0 ? (
          <div className="dl-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36" opacity="0.4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Список загрузок пуст</span>
          </div>
        ) : (
          downloads.map((item) => (
            <div key={item.id} className="dl-item">
              <div className="dl-item-top">
                <div className="dl-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                </div>
                <div className="dl-item-info">
                  <div className="dl-item-name" title={item.filename}>{item.filename}</div>
                  {item.state === 'progressing' && (
                    <div className="dl-item-meta">
                      <span>{formatBytes(item.receivedBytes)} из {formatBytes(item.totalBytes)} ({item.percent}%)</span>
                      {item.speed > 0 && <span>• {formatBytes(item.speed)}/с</span>}
                    </div>
                  )}
                  {item.state === 'completed' && (
                    <div className="dl-item-meta completed">
                      <span>✓ {formatBytes(item.totalBytes || item.receivedBytes)} • Завершено</span>
                    </div>
                  )}
                  {item.state === 'cancelled' && (
                    <div className="dl-item-meta cancelled">
                      <span>✕ Отменено</span>
                    </div>
                  )}
                  {item.state === 'interrupted' && (
                    <div className="dl-item-meta interrupted">
                      <span>⚠ Прервано</span>
                    </div>
                  )}
                </div>

                <div className="dl-item-actions">
                  {item.state === 'progressing' && (
                    <button
                      className="dl-action-btn dl-action-btn--danger"
                      onClick={() => onCancel(item.id)}
                      title="Отменить загрузку"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                  {item.state === 'completed' && (
                    <>
                      <button
                        className="dl-action-btn"
                        onClick={() => onOpenFile(item.id)}
                        title="Открыть файл"
                      >
                        Открыть
                      </button>
                      <button
                        className="dl-action-btn"
                        onClick={() => onShowInFolder(item.id)}
                        title="Показать в папке"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {item.state === 'progressing' && (
                <div className="dl-progress-bar">
                  <div
                    className="dl-progress-fill"
                    style={{ width: `${Math.max(4, item.percent)}%` }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
