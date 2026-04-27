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
  const [language, setLanguage] = useState(() => localStorage.getItem('aurora-language') || 'ru');
  const [theme, setTheme] = useState(() => localStorage.getItem('aurora-theme') || 'dark');
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('aurora-accent-color') || '#00d4ff');

  // Appearance Granular Settings
  const [appearance, setAppearance] = useState(() => {
    const saved = localStorage.getItem('aurora-appearance');
    return saved ? JSON.parse(saved) : { theme: 'aurora', blur: 20, opacity: 0.55, animate: true };
  });

  // Vault Prompt State
  const [vaultPrompt, setVaultPrompt] = useState(null); // { url, u, p }
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultSetup, setVaultSetup] = useState(false);

  // Ref to the <webview> element in MainContent
  const webviewRef = useRef(null);

  useEffect(() => {
    window.onVaultCapture = (url, u, p) => {
      setVaultPrompt({ url, u, p });
    };
    return () => { window.onVaultCapture = null; };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    (async () => {
      const setup = await window.electronAPI.vault.isSetup();
      setVaultSetup(setup);
      const unlocked = await window.electronAPI.vault.isUnlocked();
      setVaultUnlocked(unlocked);
    })();
  }, []);

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('aurora-language', language);
    localStorage.setItem('aurora-theme', theme);
    localStorage.setItem('aurora-accent-color', accentColor);
    localStorage.setItem('aurora-appearance', JSON.stringify(appearance));
  }, [language, theme, accentColor, appearance]);

  // Apply Theme & Appearance Variables
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.setProperty('--aurora-primary', accentColor);
    
    // Apply granular variables
    root.style.setProperty('--aurora-blur', `${appearance.blur}px`);
    root.style.setProperty('--aurora-opacity', appearance.opacity);
    
    // Simple theme colors (dark/light mode)
    if (theme === 'dark') {
      root.style.setProperty('--aurora-bg', '#0a0d14');
      root.style.setProperty('--aurora-glass', 'rgba(15, 20, 30, 0.7)');
      root.style.setProperty('--aurora-text', '#ffffff');
    } else {
      root.style.setProperty('--aurora-bg', '#f0f2f5');
      root.style.setProperty('--aurora-glass', 'rgba(255, 255, 255, 0.8)');
      root.style.setProperty('--aurora-text', '#1a1d23');
    }
  }, [theme, accentColor, appearance]);

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

  const handleTitleUpdate = (title, tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  };

  const handleUrlUpdate = (url, tabId) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1 || prev[idx].url === url) return prev;
      
      const updated = [...prev];
      updated[idx] = { ...updated[idx], url };
      return updated;
    });
  };

  const handleFaviconUpdate = (favicon, tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, favicon } : t));
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
    <div className={`app-layout platform-${platform} theme-${appearance.theme} ${appearance.animate ? 'pulse-animation' : ''}`} data-theme={theme} style={{ gridTemplateColumns: '1fr' }}>
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
          appearance={appearance}
          setAppearance={setAppearance}
          activePanel={activePanel}
          vaultPrompt={vaultPrompt}
          onVaultAction={async (action) => {
            if (action === 'SAVE' && vaultPrompt) {
              try {
                await window.electronAPI.vault.save(vaultPrompt.url, vaultPrompt.u, vaultPrompt.p);
              } catch (_) { /* vault is locked */ }
            }
            setVaultPrompt(null);
          }}
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
          onUrlUpdate={handleUrlUpdate}
          onFaviconUpdate={handleFaviconUpdate}
          language={language}
          appearance={appearance}
          setAppearance={setAppearance}
          vaultUnlocked={vaultUnlocked}
          vaultSetup={vaultSetup}
          onVaultUnlock={async (password) => {
            const res = await window.electronAPI.vault.unlock(password);
            if (res.ok) setVaultUnlocked(true);
            return res;
          }}
          onVaultSetup={async (password) => {
            const res = await window.electronAPI.vault.setup(password);
            if (res.ok) { setVaultSetup(true); setVaultUnlocked(true); }
            return res;
          }}
          onVaultLock={async () => {
            await window.electronAPI.vault.lock();
            setVaultUnlocked(false);
          }}
        />
      </div>

      {/* Decorative aurora orbs */}
      <div className="aurora-orb aurora-orb--1" />
      <div className="aurora-orb aurora-orb--2" />
    </div>
  );
}
