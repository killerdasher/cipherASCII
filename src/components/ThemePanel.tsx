import { memo } from 'react';
import React, { useState } from 'react';
import { useStoreShallow, selectTheme, selectAvailableThemes } from '../store';

function ThemePanelInner() {
  const {
    theme,
    availableThemes,
    setTheme,
    createCustomTheme,
  } = useStoreShallow(
    (s) => ({
      theme: selectTheme(s),
      availableThemes: selectAvailableThemes(s),
      setTheme: s.setTheme,
      createCustomTheme: s.createCustomTheme,
    })
  );

  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBase, setCustomBase] = useState(theme.id);

  const handleCreateCustom = () => {
    if (!customName.trim()) return;
    const baseTheme = availableThemes.find((t) => t.id === customBase) || theme;
    createCustomTheme({
      name: customName,
      description: `Custom theme based on ${baseTheme.name}`,
      colors: baseTheme.colors,
      fonts: baseTheme.fonts,
      spacing: baseTheme.spacing,
      borderRadius: baseTheme.borderRadius,
      shadows: baseTheme.shadows,
      transitions: baseTheme.transitions,
      isDark: baseTheme.isDark,
    });
    setCustomName('');
    setShowCustomDialog(false);
  };

  return (
    <div className="theme-panel">
      <div className="panel-header">
        <h3>Themes</h3>
        <button onClick={() => setShowCustomDialog(true)}>+ Create Custom</button>
      </div>

      <div className="theme-grid">
        {availableThemes.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            isActive={t.id === theme.id}
            onActivate={() => setTheme(t.id)}
          />
        ))}
      </div>

      {showCustomDialog && (
        <div className="modal-overlay" onClick={() => setShowCustomDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Custom Theme</h2>
            <div className="prop-row">
              <label>Name:</label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My Custom Theme"
              />
            </div>
            <div className="prop-row">
              <label>Based on:</label>
              <select value={customBase} onChange={(e) => setCustomBase(e.target.value)}>
                {availableThemes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowCustomDialog(false)}>Cancel</button>
              <button className="primary" onClick={handleCreateCustom} disabled={!customName.trim()}>
                Create Theme
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeCard({ theme, isActive, onActivate }: { theme: any; isActive: boolean; onActivate: () => void }) {
  return (
    <button
      className={`theme-card ${isActive ? 'active' : ''}`}
      onClick={onActivate}
      style={{
        '--color-bg': theme.colors.bg,
        '--color-bg-elevated': theme.colors.bgElevated,
        '--color-fg': theme.colors.fg,
        '--color-accent': theme.colors.accent,
        '--color-border': theme.colors.border,
      } as React.CSSProperties}
    >
      <div className="theme-preview">
        <div className="preview-bg" />
        <div className="preview-elevated" />
        <div className="preview-accent" />
      </div>
      <div className="theme-info">
        <div className="theme-name">{theme.name}</div>
        <div className="theme-desc">{theme.description}</div>
        {theme.isDark && <span className="theme-badge dark">Dark</span>}
        {!theme.isDark && <span className="theme-badge light">Light</span>}
      </div>
      {isActive && <div className="active-indicator" />}
    </button>
  );
}

export const ThemePanel = memo(ThemePanelInner);
