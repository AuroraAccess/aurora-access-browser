/* 
 * NOTICE: This file is protected under RCF-PL v1.2.8
 * [RCF:PROTECTED]
 */
import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import Toolbar from './components/Toolbar.jsx';
import MainContent, { WELCOME_URL } from './components/MainContent.jsx';

let tabIdCounter = 1;
function createTab(url = WELCOME_URL, title = '') {
  return { id: tabIdCounter++, url, title, favicon: null };
}

export default function App() {
  const [tabs, setTabs] = useState([createTab()]);
  const [activeTab, setActiveTab] = useState(0);
  const [activePanel, setActivePanel] = useState('browser');
  const [isLoading, setIsLoading] = useState(false);
  
  // Settings State
  const [language, setLanguage] = useState('ru');
  const [theme, setTheme] = useState('dark');
  const [accentColor, setAccentColor] = useState('#00d4ff');

  // Ref to the <webview> element in MainContent
  const webviewRef = useRef(null);

  // Apply Theme & Accent Color
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.setProperty('--aurora-primary', accentColor);
    
    // Simple theme colors
    if (theme === 'dark') {
      root.style.setProperty('--aurora-bg', '#0a0d14');
      root.style.setProperty('--aurora-glass', 'rgba(15, 20, 30, 0.7)');
      root.style.setProperty('--aurora-text', '#ffffff');
    } else {
      root.style.setProperty('--aurora-bg', '#f0f2f5');
      root.style.setProperty('--aurora-glass', 'rgba(255, 255, 255, 0.8)');
      root.style.setProperty('--aurora-text', '#1a1d23');
    }
  }, [theme, accentColor]);

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
  const [isCoreConnected, setIsCoreConnected] = useState(!!window.electronAPI);

  useEffect(() => {
    // Poll for bridge if not connected initially
    if (!isCoreConnected) {
      const timer = setInterval(() => {
        if (window.electronAPI) {
          setIsCoreConnected(true);
          clearInterval(timer);
        }
      }, 100);
      return () => clearInterval(timer);
    }
  }, [isCoreConnected]);

  return (
    <div className={`app-layout platform-${platform}`} data-theme={theme} style={{ gridTemplateColumns: '1fr' }}>
      <div className="app-main">
        <Toolbar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(i) => { setActiveTab(i); setActivePanel('browser'); }}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onNavigate={handleNavigate}
          isLoading={isLoading}
          language={language}
          setLanguage={setLanguage}
          theme={theme}
          setTheme={setTheme}
          accentColor={accentColor}
          setAccentColor={setAccentColor}
          activePanel={activePanel}
          onPanelChange={(panelId) => {
            if (panelId === 'browser') {
              setActivePanel('browser');
              return;
            }
            // Create a new tab for the tool
            const toolUrl = `aurora://${panelId}`;
            let title = panelId.charAt(0).toUpperCase() + panelId.slice(1);
            if (panelId === 'rcf') title = 'Firmware';
            if (panelId === 'p2p') title = 'P2P';
            
            const newTab = createTab(toolUrl, title);
            setTabs(prev => [...prev, newTab]);
            setActiveTab(tabs.length);
            setActivePanel('browser'); // Keep browser view as the primary view container
          }}
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
          language={language}
        />
      </div>

      {/* Decorative aurora orbs */}
      <div className="aurora-orb aurora-orb--1" />
      <div className="aurora-orb aurora-orb--2" />
    </div>
  );
}
