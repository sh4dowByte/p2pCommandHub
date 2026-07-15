import { state } from './state.js';
import { hexToRgb, adjustColorBrightness, hexToRgbaStr } from './utils.js';

export function applyCustomTheme(primaryHex, bgHex) {
  const rgbBg = hexToRgb(bgHex);
  const isLightBg = rgbBg ? ((rgbBg.r * 299 + rgbBg.g * 587 + rgbBg.b * 114) / 1000) > 128 : false;

  const bgShift = isLightBg ? -6 : 6;
  const bgSec = adjustColorBrightness(bgHex, bgShift);
  const bgTert = adjustColorBrightness(bgHex, bgShift * 2);

  document.body.style.setProperty('--bg-primary', bgHex);
  document.body.style.setProperty('--bg-secondary', bgSec);
  document.body.style.setProperty('--bg-tertiary', bgTert);
  document.body.style.setProperty('--primary', primaryHex);
  document.body.style.setProperty('--primary-hover', adjustColorBrightness(primaryHex, isLightBg ? -10 : 10));
  document.body.style.setProperty('--primary-glow', hexToRgbaStr(primaryHex, 0.15));
  document.body.style.setProperty('--secondary-glow', hexToRgbaStr(primaryHex, 0.02));
  document.body.style.setProperty('--border-color', hexToRgbaStr(primaryHex, 0.15));
  document.body.style.setProperty('--border-color-glow', hexToRgbaStr(primaryHex, 0.3));
  
  if (isLightBg) {
    document.body.style.setProperty('--text-primary', '#111827');
    document.body.style.setProperty('--text-secondary', '#4b5563');
    document.body.style.setProperty('--text-muted', '#9ca3af');
    document.body.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.8)');
    document.body.style.setProperty('--terminal-bg', '#ffffff');
    document.body.classList.add('light-mode');
  } else {
    document.body.style.setProperty('--text-primary', '#f3f4f6');
    document.body.style.setProperty('--text-secondary', '#9ca3af');
    document.body.style.setProperty('--text-muted', '#6b7280');
    document.body.style.setProperty('--glass-bg', 'rgba(17, 24, 39, 0.7)');
    document.body.style.setProperty('--terminal-bg', 'rgba(0, 0, 0, 0.2)');
    document.body.classList.remove('light-mode');
  }
}

export function clearCustomThemeStyles() {
  document.body.style.removeProperty('--bg-primary');
  document.body.style.removeProperty('--bg-secondary');
  document.body.style.removeProperty('--bg-tertiary');
  document.body.style.removeProperty('--primary');
  document.body.style.removeProperty('--primary-hover');
  document.body.style.removeProperty('--primary-glow');
  document.body.style.removeProperty('--secondary-glow');
  document.body.style.removeProperty('--border-color');
  document.body.style.removeProperty('--border-color-glow');
  document.body.style.removeProperty('--text-primary');
  document.body.style.removeProperty('--text-secondary');
  document.body.style.removeProperty('--text-muted');
  document.body.style.removeProperty('--glass-bg');
  document.body.style.removeProperty('--terminal-bg');
}

// Apply theme on load
export function applyThemeClass(theme) {
  document.body.classList.remove(
    'light-mode', 
    'theme-dark', 
    'theme-light', 
    'theme-dracula', 
    'theme-nord', 
    'theme-cyberpunk', 
    'theme-sakura', 
    'theme-retro',
    'theme-oceanic',
    'theme-sunset',
    'theme-monokai',
    'theme-lavender',
    'theme-custom'
  );
  if (theme === 'light') {
    document.body.classList.add('light-mode');
  }
  document.body.classList.add('theme-' + theme);

  if (theme === 'custom') {
    const customPrimary = localStorage.getItem('custom-theme-primary') || '#00b4d8';
    const customBg = localStorage.getItem('custom-theme-bg') || '#0a0b10';
    applyCustomTheme(customPrimary, customBg);
  } else {
    clearCustomThemeStyles();
  }
}

export function updateThemeUI(editor) {
  applyThemeClass(state.currentTheme);
  
  // Highlight active theme option in the dropdown
  document.querySelectorAll('.theme-opt-btn').forEach(btn => {
    if (btn.getAttribute('data-theme') === state.currentTheme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Set Ace Editor theme based on active color theme
  if (editor) {
    switch (state.currentTheme) {
      case 'light':
        editor.setTheme("ace/theme/chrome");
        break;
      case 'cyberpunk':
        editor.setTheme("ace/theme/chaos");
        break;
      case 'dracula':
        editor.setTheme("ace/theme/dracula");
        break;
      case 'nord':
      case 'oceanic':
        editor.setTheme("ace/theme/clouds_midnight");
        break;
      case 'sakura':
      case 'sunset':
      case 'lavender':
        editor.setTheme("ace/theme/pastel_on_dark");
        break;
      case 'monokai':
        editor.setTheme("ace/theme/monokai");
        break;
      case 'retro':
        editor.setTheme("ace/theme/terminal");
        break;
      case 'custom': {
        const bgHex = localStorage.getItem('custom-theme-bg') || '#0a0b10';
        const rgbBg = hexToRgb(bgHex);
        const isLightBg = rgbBg ? ((rgbBg.r * 299 + rgbBg.g * 587 + rgbBg.b * 114) / 1000) > 128 : false;
        editor.setTheme(isLightBg ? "ace/theme/chrome" : "ace/theme/tomorrow_night_eighties");
        break;
      }
      case 'dark':
      default:
        editor.setTheme("ace/theme/tomorrow_night_eighties");
        break;
    }
  }

  // Refresh Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}
