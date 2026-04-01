import React, { useState, useRef } from 'react';
import './App.css';
import Sidebar from './components/Sidebar.jsx';
import Toolbar from './components/Toolbar.jsx';
import MainContent, { WELCOME_URL } from './components/MainContent.jsx';

let tabIdCounter = 1;
function createTab(url = WELCOME_URL, title = 'Новая вкладка') {
  return { id: tabIdCounter++, url, title, favicon: null };
}

export default function App() {
  const [tabs, setTabs] = useState([createTab()]);
  const [activeTab, setActiveTab] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState('browser');
  const [isLoading, setIsLoading] = useState(false);

  // Ref to the <webview> element in MainContent
  const webviewRef = useRef(null);

  const handleNavigate = (action) => {
    const wv = webviewRef.current?.current;

    if (action === 'BACK') { wv?.goBack(); return; }
    if (action === 'FORWARD') { wv?.goForward(); return; }
    if (action === 'RELOAD') { wv?.reload(); return; }
    if (action === 'STOP') { wv?.stop(); setIsLoading(false); return; }

    const url = action;
    setIsLoading(true);

    let title = url;
    try {
      if (url.startsWith('rcf://')) title = 'RCF — ' + url.replace('rcf://', '');
      else if (url.startsWith('aurora://')) title = 'Aurora — ' + url.replace('aurora://', '');
      else title = new URL(url).hostname || url;
    } catch (_) {
      title = url.slice(0, 30);
    }

    setTabs(prev => {
      const updated = [...prev];
      updated[activeTab] = { ...updated[activeTab], url, title };
      return updated;
    });
    setActivePanel('browser');
  };

  const handleLoadStart = () => setIsLoading(true);
  const handleLoadStop  = () => setIsLoading(false);

  const handleTitleUpdate = (title) => {
    setTabs(prev => {
      const updated = [...prev];
      updated[activeTab] = { ...updated[activeTab], title };
      return updated;
    });
  };

  const handleNewTab = () => {
    const newTab = createTab();
    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabs.length);
    setActivePanel('browser');
  };

  const handleCloseTab = (idx) => {
    if (tabs.length === 1) { setTabs([createTab()]); setActiveTab(0); return; }
    setTabs(prev => prev.filter((_, i) => i !== idx));
    setActiveTab(prev => Math.min(prev, tabs.length - 2));
  };

  const platform = window.electronAPI?.platform || 'web';

  return (
    <div className={`app-layout platform-${platform}`}>
      <Sidebar
        activePanel={activePanel}
        onPanelChange={(id) => setActivePanel(id)}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
      />
      <div className="app-main">
        <Toolbar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(i) => { setActiveTab(i); setActivePanel('browser'); }}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onNavigate={handleNavigate}
          isLoading={isLoading}
        />
        <MainContent
          tabs={tabs}
          activeTab={activeTab}
          panel={activePanel}
          onNavigate={handleNavigate}
          webviewRef={webviewRef}
          onLoadStart={handleLoadStart}
          onLoadStop={handleLoadStop}
          onTitleUpdate={handleTitleUpdate}
        />
      </div>

      {/* Diagnostic Status Bar */}
      <div className="debug-status-bar">
        <span className={window.electronAPI ? 'status-ok' : 'status-err'}>
          {window.electronAPI ? '● Electron Core Connected' : '○ Browser Mode Only'}
        </span>
        {window.electronAPI && <span className="status-meta">Bridge Version: {window.electronAPI.version}</span>}
      </div>

      {/* Decorative aurora orbs */}
      <div className="aurora-orb aurora-orb--1" />
      <div className="aurora-orb aurora-orb--2" />
    </div>
  );
}
