/* 
 * NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import Toolbar from './components/Toolbar.jsx';
import MainContent, { WELCOME_URL } from './components/MainContent.jsx';
// TZ v2.0.9 feature #4: global release-notification modal (mounted at root).
import AutoUpdateModal from './components/AutoUpdateModal.jsx';

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
  const [vaultPrompt, setVaultPrompt] = useState(null); // { url, u, p, isUpdate }
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultSetup, setVaultSetup] = useState(false);

  // Ref to the <webview> element in MainContent
  const webviewRef = useRef(null);

  useEffect(() => {
    window.onVaultCapture = (url, u, p, isUpdate) => {
      setVaultPrompt({ url, u, p, isUpdate });
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

  // target=_blank / window.open from pages: the main process forwards the URL
  // here (Electron has no native tabs), and we open it as a real in-app tab —
  // not in the OS default browser.
  useEffect(() => {
    if (!window.electronAPI?.onOpenTabRequest) return;
    const unsubscribe = window.electronAPI.onOpenTabRequest((url) => {
      if (!url || !/^https?:/i.test(url)) return;
      let title = url;
      try { title = new URL(url).hostname || url; } catch (_) {}
      setTabs(prev => {
        const newTab = createTab(url, title);
        // Activate the new tab at index = current length.
        setActiveTab(prev.length);
        return [...prev, newTab];
      });
      setActivePanel('browser');
    });
    return unsubscribe;
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
      if (url.startsWith('panel://')) {
        const panelNames = {
          security: 'Security Center',
          traffic: 'Traffic Monitor',
          inspector: 'Site Inspector',
          passaudit: 'Password Audit',
          proxy: 'Proxy',
          vault: 'Vault',
          history: 'History',
          settings: 'Settings',
        };
        title = panelNames[url.replace('panel://', '')] || url;
      } else {
        title = new URL(url).hostname || url;
      }
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

  // TZ: open an explicit URL as a new in-app tab — the mini-History widget in
  // the sessions dropdown navigates through this (click → new tab, widget
  // closes itself).
  const openUrlInNewTab = (url) => {
    if (!url || !/^https?:/i.test(url)) return;
    let title = url;
    try { title = new URL(url).hostname || url; } catch (_) { title = url.slice(0, 30); }
    setTabs(prev => {
      setActiveTab(prev.length);
      return [...prev, createTab(url, title)];
    });
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

  const handleTriggerVideoTranslate = (opts) => {
    const wv = webviewRef.current?.current;
    if (wv && typeof wv.send === 'function') {
      wv.send('video:toggle-translate', opts);
    }
  };

  const handleSetVideoVolume = (volumes) => {
    const wv = webviewRef.current?.current;
    if (wv && typeof wv.send === 'function') {
      wv.send('video:set-volume', volumes);
    }
  };

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
          vaultUnlocked={vaultUnlocked}
          vaultPrompt={vaultPrompt}
          onOpenUrl={openUrlInNewTab}
          onTriggerVideoTranslate={handleTriggerVideoTranslate}
          onSetVideoVolume={handleSetVideoVolume}
          onVaultAction={async (action) => {
            if (action === 'SAVE' && vaultPrompt) {
              try {
                const res = await window.electronAPI.vault.save(vaultPrompt.url, vaultPrompt.u, vaultPrompt.p);
                // TZ: cross-surface sync — toolbar-prompt saves must appear in
                // any open Password Audit / Vault panel immediately.
                if (res?.ok) window.dispatchEvent(new CustomEvent('aurora:vault-changed'));
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
            const toolUrl = `panel://${panelId}`;
            const panelTitles = {
              security: 'Security Center',
              traffic: 'Traffic Monitor',
              inspector: 'Site Inspector',
              passaudit: 'Password Audit',
              proxy: 'Proxy',
              vault: 'Vault',
              history: 'History',
              settings: 'Settings',
            };
            const newTab = createTab(toolUrl, panelTitles[panelId] || panelId);
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
            // TZ v2.0.9 fix #2: the unlock form (VaultPanel lock screen) is the
            // path out of the "Audit failed: the vault is locked" state; log
            // the attempt so the fix is verifiable in the devtools console.
            const res = await window.electronAPI.vault.unlock(password);
            console.log('[Vault] unlock attempt ->', res?.ok ? 'success' : (res?.error || 'failed'));
            if (res.ok) setVaultUnlocked(true);
            return res;
          }}
          onVaultSetup={async (password) => {
            const res = await window.electronAPI.vault.setup(password);
            console.log('[Vault] setup attempt ->', res?.ok ? 'success' : (res?.error || 'failed'));
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

      {/* TZ v2.0.9 feature #4: release notification — one global mount, so it
          renders over tabs, panels and dropdowns. */}
      <AutoUpdateModal language={language} />
    </div>
  );
}
