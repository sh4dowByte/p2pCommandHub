// Connect to Socket.io with role metadata
const socket = io({
  auth: {
    role: 'dashboard'
  }
});

// App State
let agentsList = [];
let selectedAgentId = null;
let currentCommandId = null;
let broadcastCommandIds = {}; // agentId -> commandId for active broadcast
let commandOutputs = {}; // commandId -> string buffer of outputs
let activeTab = 'terminal'; // 'terminal' | 'files'
let agentPaths = {}; // agentId -> current path string
let currentTheme = localStorage.getItem('theme') || 'dark'; // 'dark' | 'light'
let fbViewMode = localStorage.getItem('fbViewMode') || 'list'; // 'list' | 'grid'

// Terminal History
let commandHistory = JSON.parse(localStorage.getItem('commandHistory') || '[]');
let historyIndex = -1;

// New Dashboard Settings (Client-side)
let dashboardSettings = {
  theme: currentTheme,
  terminalFontSize: localStorage.getItem('terminalFontSize') || '14',
  terminalFontFamily: localStorage.getItem('terminalFontFamily') || "'Fira Code', monospace",
  terminalOpacity: localStorage.getItem('terminalOpacity') || '1',
  soundEnabled: localStorage.getItem('soundEnabled') === 'true',
  autoClear: localStorage.getItem('autoClear') === 'true',
  historyLimit: localStorage.getItem('historyLimit') || '100'
};

// Color generation helpers for custom theme picker
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function adjustColorBrightness(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, Math.max(0, rgb.r + (percent * 2.55)));
  const g = Math.min(255, Math.max(0, rgb.g + (percent * 2.55)));
  const b = Math.min(255, Math.max(0, rgb.b + (percent * 2.55)));
  return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
}

function hexToRgbaStr(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function applyCustomTheme(primaryHex, bgHex) {
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

function clearCustomThemeStyles() {
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
function applyThemeClass(theme) {
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
applyThemeClass(currentTheme);


// DOM Elements
const agentsContainer = document.getElementById('agents-container');
const agentCount = document.getElementById('agent-count');
const selectedHostname = document.getElementById('selected-hostname');
const selectedAgentTags = document.getElementById('selected-agent-tags');
const metricsPanel = document.getElementById('metrics-panel');
const cpuProgress = document.getElementById('cpu-progress');
const cpuValue = document.getElementById('cpu-value');
const ramProgress = document.getElementById('ram-progress');
const ramValue = document.getElementById('ram-value');
const platformText = document.getElementById('platform-text');
const ipText = document.getElementById('ip-text');
const terminalScreen = document.getElementById('terminal-screen');
const terminalInput = document.getElementById('terminal-input');
const btnSendCommand = document.getElementById('btn-send-command');
const btnClearTerminal = document.getElementById('btn-clear-terminal');
const inputPrompt = document.getElementById('input-prompt');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeIcon = document.getElementById('theme-icon');

// Tabs DOM Elements
const tabBtnTerminal = document.getElementById('tab-btn-terminal');
const tabBtnFiles = document.getElementById('tab-btn-files');
const terminalTabContent = document.getElementById('terminal-tab-content');
const terminalAutocomplete = document.getElementById('terminal-autocomplete');
const fileBrowserTabContent = document.getElementById('file-browser-tab-content');
const tabBtnDocker = document.getElementById('tab-btn-docker');
const dockerTabContent = document.getElementById('docker-tab-content');
const dockerContainersBody = document.getElementById('docker-containers-body');
const dockerBtnRefresh = document.getElementById('docker-btn-refresh');
const dockerLoading = document.getElementById('docker-loading');
const dockerEmptyState = document.getElementById('docker-empty-state');
const dockerStatusText = document.getElementById('docker-status-text');

// File Browser DOM Elements
const fbBtnUp = document.getElementById('fb-btn-up');
const fbBtnHome = document.getElementById('fb-btn-home');
const fbPathInput = document.getElementById('fb-path-input');
const fbBreadcrumbs = document.getElementById('fb-breadcrumbs');
const fbPathContainer = document.querySelector('.fb-path-container');
const fbBtnGo = document.getElementById('fb-btn-go');
const fbBtnRefresh = document.getElementById('fb-btn-refresh');
const fbFilesBody = document.getElementById('fb-files-body');
const fbTableView = document.getElementById('fb-table-view');
const fbGridView = document.getElementById('fb-grid-view');
const fbBtnViewToggle = document.getElementById('fb-btn-view-toggle');
const fbViewIcon = document.getElementById('fb-view-icon');
const fbLoading = document.getElementById('fb-loading');
const fbEmptyState = document.getElementById('fb-empty-state');

// File Preview DOM Elements
const previewModal = document.getElementById('preview-modal');
const btnClosePreview = document.getElementById('btn-close-preview');
const previewFilename = document.getElementById('preview-filename');
const previewContent = document.getElementById('preview-content');
let previewTargetFilePath = null; // Stores target path to avoid race conditions/delays

// Markdown & Toggle Selectors
const previewToggleContainer = document.getElementById('preview-toggle-container');
const btnPreviewModeCode = document.getElementById('btn-preview-mode-code');
const btnPreviewModeRender = document.getElementById('btn-preview-mode-render');
const previewContentHtml = document.getElementById('preview-content-html');
let previewRawContent = "";

// Initialize Ace Editor
ace.config.set('basePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/');
const editor = ace.edit("preview-content");
editor.setTheme("ace/theme/tomorrow_night_eighties");
editor.setReadOnly(true);
editor.setShowPrintMargin(false);
editor.setOptions({
  fontSize: "13px",
  fontFamily: "var(--font-mono)"
});

function getFileIcon(filename, isDir) {
  if (isDir) return { icon: 'folder', class: 'fb-icon-folder' };
  
  const ext = filename.split('.').pop().toLowerCase();
  switch(ext) {
    case 'js': case 'ts': case 'py': case 'java': case 'c': case 'cpp': case 'go': 
    case 'rs': case 'php': case 'sh': case 'bash': case 'yml': case 'yaml': 
    case 'json': case 'html': case 'css': case 'md': case 'sql': case 'xml':
      return { icon: 'code', class: 'fb-icon-code' };
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp':
      return { icon: 'image', class: 'fb-icon-image' };
    case 'mp4': case 'mkv': case 'avi': case 'mov':
      return { icon: 'video', class: 'fb-icon-video' };
    case 'mp3': case 'wav': case 'ogg': case 'flac':
      return { icon: 'music', class: 'fb-icon-audio' };
    case 'zip': case 'tar': case 'gz': case 'rar': case '7z':
      return { icon: 'archive', class: 'fb-icon-archive' };
    case 'pdf':
      return { icon: 'file-text', class: 'fb-icon-pdf' };
    case 'xls': case 'xlsx': case 'csv':
      return { icon: 'table', class: 'fb-icon-sheet' };
    case 'doc': case 'docx':
      return { icon: 'file-text', class: 'fb-icon-word' };
    case 'ppt': case 'pptx':
      return { icon: 'presentation', class: 'fb-icon-word' };
    default:
      return { icon: 'file', class: 'fb-icon-file' };
  }
}

function setEditorMode(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  let mode = 'text';
  switch(ext) {
    case 'js': case 'json': case 'ts': mode = 'javascript'; break;
    case 'py': mode = 'python'; break;
    case 'sh': case 'bash': case 'zsh': mode = 'sh'; break;
    case 'html': case 'htm': mode = 'html'; break;
    case 'css': mode = 'css'; break;
    case 'md': case 'markdown': mode = 'markdown'; break;
    case 'yml': case 'yaml': mode = 'yaml'; break;
    case 'sql': mode = 'sql'; break;
    case 'xml': mode = 'xml'; break;
    case 'php': mode = 'php'; break;
    case 'go': mode = 'golang'; break;
    case 'rs': mode = 'rust'; break;
  }
  editor.session.setMode(`ace/mode/${mode}`);
}

// Broadcast Elements
const btnBroadcastMode = document.getElementById('btn-broadcast-mode');
const broadcastModal = document.getElementById('broadcast-modal');
const btnCloseBroadcast = document.getElementById('btn-close-broadcast');
const broadcastInput = document.getElementById('broadcast-input');

// Theme Switcher & Toggle Handler
const themeDropdown = document.getElementById('theme-dropdown');
const dropdownCustomPrimary = document.getElementById('dropdown-custom-primary');
const dropdownCustomBg = document.getElementById('dropdown-custom-bg');
const btnApplyDropdownCustom = document.getElementById('btn-apply-dropdown-custom');

// Set initial dropdown values from localStorage
if (dropdownCustomPrimary && dropdownCustomBg) {
  dropdownCustomPrimary.value = localStorage.getItem('custom-theme-primary') || '#00b4d8';
  dropdownCustomBg.value = localStorage.getItem('custom-theme-bg') || '#0a0b10';
}

function updateThemeUI() {
  applyThemeClass(currentTheme);
  
  // Highlight active theme option in the dropdown
  document.querySelectorAll('.theme-opt-btn').forEach(btn => {
    if (btn.getAttribute('data-theme') === currentTheme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Set Ace Editor theme based on active color theme
  if (typeof editor !== 'undefined') {
    switch (currentTheme) {
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

// Toggle Dropdown when clicking the theme icon
btnThemeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  themeDropdown.classList.toggle('hidden');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (themeDropdown && !themeDropdown.classList.contains('hidden') && !e.target.closest('.theme-switcher-container')) {
    themeDropdown.classList.add('hidden');
  }
});

// Theme Options Click Handler
document.querySelectorAll('.theme-opt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedTheme = btn.getAttribute('data-theme');
    currentTheme = selectedTheme;
    dashboardSettings.theme = currentTheme;
    localStorage.setItem('theme', currentTheme);
    updateThemeUI();
    
    // Sync select input if settings modal is open
    if (settingsTheme) {
      settingsTheme.value = currentTheme;
      if (typeof toggleSettingsCustomThemeVisibility === 'function') {
        toggleSettingsCustomThemeVisibility();
      }
    }
    
    // Hide dropdown
    themeDropdown.classList.add('hidden');
  });
});

// Dropdown Custom Picker Apply Click Handler
if (btnApplyDropdownCustom) {
  btnApplyDropdownCustom.addEventListener('click', () => {
    const prim = dropdownCustomPrimary.value;
    const bg = dropdownCustomBg.value;
    
    localStorage.setItem('custom-theme-primary', prim);
    localStorage.setItem('custom-theme-bg', bg);
    
    currentTheme = 'custom';
    dashboardSettings.theme = 'custom';
    localStorage.setItem('theme', 'custom');
    
    updateThemeUI();
    
    // Sync settings modal custom controls
    if (settingsTheme) {
      settingsTheme.value = 'custom';
      if (typeof toggleSettingsCustomThemeVisibility === 'function') {
        toggleSettingsCustomThemeVisibility();
      }
    }
    if (settingsCustomPrimary && settingsCustomBg) {
      settingsCustomPrimary.value = prim;
      settingsCustomBg.value = bg;
    }
    
    themeDropdown.classList.add('hidden');
  });
}

// Initial theme UI update
updateThemeUI();

// Apply initial dashboard settings
function applyDashboardSettings() {
  // Theme
  currentTheme = dashboardSettings.theme;
  updateThemeUI();
  
  // Terminal Font Size
  terminalScreen.style.fontSize = `${dashboardSettings.terminalFontSize}px`;
  
  // Terminal Font Family
  terminalScreen.style.fontFamily = dashboardSettings.terminalFontFamily;
  
  // Terminal Opacity
  terminalScreen.style.opacity = dashboardSettings.terminalOpacity;
  
  // Ace Editor Preview Settings
  if (typeof editor !== 'undefined') {
    editor.setOptions({
      fontSize: `${dashboardSettings.terminalFontSize}px`,
      fontFamily: dashboardSettings.terminalFontFamily
    });
  }
}
applyDashboardSettings();

const btnSendBroadcast = document.getElementById('btn-send-broadcast');
const broadcastGridResults = document.getElementById('broadcast-grid-results');

// Helper to play notification sound
function playNotificationSound(type = 'connect') {
  if (!dashboardSettings.soundEnabled) return;
  
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'connect') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      oscillator.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.1); // E6
    } else {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
      oscillator.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.2); // A3
    }

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.2);
  } catch (err) {
    console.warn('Sound playback failed:', err);
  }
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to server websocket');
});

socket.on('file-browse-response', (response) => {
  showFbLoading(false);
  if (response.status === 'success') {
    agentPaths[selectedAgentId] = response.path;
    fbPathInput.value = response.path;
    renderBreadcrumbs(response.path);
    renderFileList(response.items);
  } else {
    alert(`Error: ${response.message || 'Failed to list directory'}`);
  }
});

socket.on('docker-list-response', (response) => {
  showDockerLoading(false);
  if (response.status === 'success') {
    renderDockerList(response.containers);
  } else {
    alert(`Error: ${response.message || 'Failed to list Docker containers'}`);
  }
});

socket.on('file-browse-download-response', (response) => {
  showFbLoading(false);
  if (response.status === 'success') {
    // Check if this was a thumbnail request (we'd need server support or detect by size/extension)
    // For now, if it's an image and not a full preview, we might be loading it into a grid item
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(response.name.split('.').pop().toLowerCase());
    const thumbEl = document.getElementById(`thumb-${response.name.replace(/[^a-zA-Z0-9]/g, '-')}`);
    
    if (thumbEl && !previewTargetFilePath) {
      thumbEl.src = `data:image/${response.name.split('.').pop().toLowerCase()};base64,${response.content}`;
      return;
    }

    if (previewTargetFilePath && response.path === previewTargetFilePath) {
      previewTargetFilePath = null;
      previewFilename.textContent = response.name;
      
      if (isImg) {
        previewToggleContainer.classList.add('hidden');
        previewContent.classList.add('hidden');
        previewContentHtml.classList.remove('hidden');
        previewContentHtml.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;"><img src="data:image/${response.name.split('.').pop().toLowerCase()};base64,${response.content}" style="max-width:100%;max-height:100%;object-fit:contain;"></div>`;
        previewModal.classList.remove('hidden');
        return;
      }

      let decoded = "";
      try {
        decoded = decodeURIComponent(escape(atob(response.content)));
      } catch (err) {
        try {
          decoded = atob(response.content);
        } catch (e) {
          decoded = "[Binary file or unsupported encoding for preview]";
        }
      }
      
      previewRawContent = decoded;
      setEditorMode(response.name);
      editor.setValue(decoded);
      editor.clearSelection();
      editor.gotoLine(1);
      
      const isMd = response.name.endsWith('.md') || response.name.endsWith('.markdown');
      if (isMd) {
        previewToggleContainer.classList.remove('hidden');
        // Render markdown by default
        btnPreviewModeRender.classList.add('active');
        btnPreviewModeCode.classList.remove('active');
        previewContentHtml.classList.remove('hidden');
        previewContent.classList.add('hidden');
        
        if (typeof marked !== 'undefined') {
          previewContentHtml.innerHTML = marked.parse(previewRawContent);
        } else {
          previewContentHtml.innerHTML = "<p>Markdown renderer not loaded.</p>";
        }
      } else {
        previewToggleContainer.classList.add('hidden');
        btnPreviewModeCode.classList.add('active');
        btnPreviewModeRender.classList.remove('active');
        previewContent.classList.remove('hidden');
        previewContentHtml.classList.remove('hidden');
      }
      
      previewModal.classList.remove('hidden');
      
      // Resize Ace editor after showing modal to ensure correct dimensions
      setTimeout(() => {
        editor.resize();
        editor.renderer.updateFull();
      }, 100);
    } else {
      // Direct download
      const base64Content = response.content;
      const filename = response.name;
      const blob = base64ToBlob(base64Content);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } else {
    if (response.path === previewTargetFilePath) {
      previewTargetFilePath = null;
    }
    // Only alert if it's not a thumbnail background load
    if (!document.getElementById(`thumb-${response.name?.replace(/[^a-zA-Z0-9]/g, '-')}`)) {
        alert(`Error: ${response.message || 'Failed to process file'}`);
    }
  }
});

socket.on('agents-update', (agents) => {
  const oldOnlineCount = agentsList.filter(a => a.status === 'online').length;
  const newOnlineCount = agents.filter(a => a.status === 'online').length;
  
  if (newOnlineCount > oldOnlineCount) {
    playNotificationSound('connect');
  } else if (newOnlineCount < oldOnlineCount) {
    playNotificationSound('disconnect');
  }

  agentsList = agents;
  renderAgentsList();
  updateSelectedAgentData();
  updateBroadcastModalTargets();
});

socket.on('command-started', ({ commandId, agentId, cmd }) => {
  // Store command state if it is for the active agent
  if (agentId === selectedAgentId) {
    currentCommandId = commandId;
    commandOutputs[commandId] = "";
    
    // Add command to screen
    appendTerminalLine(`$ ${cmd}`, 'cmd-input-line');
    // Disable input while running
    setTerminalInputState(false);
  }
});

socket.on('command-output', ({ commandId, output, isEof, exitCode }) => {
  // 1. Single Agent Terminal Logic
  if (commandId === currentCommandId) {
    appendTerminalOutput(output);
    if (isEof) {
      appendTerminalLine(`[Process exited with code ${exitCode}]`, 'system-msg');
      setTerminalInputState(true);
      currentCommandId = null;
    }
  }

  // 2. Broadcast Terminal Logic
  for (const [agentId, bCmdId] of Object.entries(broadcastCommandIds)) {
    if (bCmdId === commandId) {
      const termEl = document.getElementById(`broadcast-term-${agentId}`);
      if (termEl) {
        // Remove trailing lines or append directly
        termEl.textContent += output;
        termEl.scrollTop = termEl.scrollHeight;
        
        if (isEof) {
          termEl.textContent += `\n[Exit Code: ${exitCode}]`;
          termEl.scrollTop = termEl.scrollHeight;
        }
      }
    }
  }
});

socket.on('command-error', ({ error }) => {
  appendTerminalLine(`Error: ${error}`, 'error-msg');
  setTerminalInputState(true);
  currentCommandId = null;
});

// Render Sidebar List
function renderAgentsList() {
  if (agentsList.length === 0) {
    agentsContainer.innerHTML = `
      <div class="no-agents">
        <i data-lucide="wifi-off"></i>
        <p>No agents connected yet</p>
      </div>
    `;
    agentCount.textContent = "0";
    lucide.createIcons();
    return;
  }

  agentCount.textContent = agentsList.length;
  agentsContainer.innerHTML = '';

  agentsList.forEach(agent => {
    const isSelected = agent.id === selectedAgentId;
    const isOnline = agent.status === 'online';
    
    let platformIcon = 'monitor';
    if (agent.platform.toLowerCase().includes('darwin') || agent.platform.toLowerCase().includes('mac')) {
      platformIcon = 'apple';
    } else if (agent.platform.toLowerCase().includes('win')) {
      platformIcon = 'monitor'; 
    } else if (agent.platform.toLowerCase().includes('linux')) {
      platformIcon = 'terminal';
    }

    const agentItem = document.createElement('div');
    agentItem.className = `agent-item ${isSelected ? 'active' : ''}`;
    agentItem.innerHTML = `
      <div class="agent-item-header">
        <div class="agent-item-title" title="${agent.hostname}">${agent.hostname}</div>
        <div class="agent-platform-tag">
          <i data-lucide="${platformIcon}" style="width:12px;height:12px;"></i>
          <span class="agent-os">${agent.platform}</span>
        </div>
      </div>
      <div class="agent-item-body">
        <span class="agent-type-badge ${agent.type}">${agent.type} client</span>
        <span class="system-status">
          <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
          <span>${agent.status}</span>
        </span>
      </div>
      ${isOnline ? `
      <div class="agent-item-metrics">
        <span>CPU: ${agent.metrics.cpu.toFixed(0)}%</span>
        <span>RAM: ${agent.metrics.ram.toFixed(0)}%</span>
      </div>
      ` : ''}
    `;

    agentItem.addEventListener('click', () => {
      selectAgent(agent.id);
    });

    agentsContainer.appendChild(agentItem);
  });

  lucide.createIcons();
}

// Select an Agent
function selectAgent(agentId) {
  selectedAgentId = agentId;
  currentCommandId = null;
  
  // Clear terminal screen on agent switch
  terminalScreen.innerHTML = '';
  appendTerminalLine('System connected. Interactive CLI session initialized.', 'system-msg');
  
  renderAgentsList();
  updateSelectedAgentData();

  // Close sidebar on mobile after selection
  const sidebarEl = document.querySelector('.sidebar');
  const sidebarBackdropEl = document.getElementById('sidebar-backdrop');
  if (sidebarEl && window.innerWidth <= 768) {
    sidebarEl.classList.remove('open');
    if (sidebarBackdropEl) {
      sidebarBackdropEl.classList.add('hidden');
    }
  }

  // Load files for new agent if already on the Files tab
  if (activeTab === 'files') {
    const currentPath = agentPaths[selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  } else if (activeTab === 'docker') {
    fetchDockerContainers();
  }
}

// Update Active Details Panel
function updateSelectedAgentData() {
  const agent = agentsList.find(a => a.id === selectedAgentId);
  
  if (!agent) {
    // Reset views
    selectedHostname.textContent = 'Select an Agent';
    selectedAgentTags.innerHTML = `<span class="tag placeholder-tag">Connect an agent to start remote shell execution</span>`;
    metricsPanel.classList.add('hidden');
    setTerminalInputState(false);
    inputPrompt.textContent = '$';
    tabBtnFiles.setAttribute('disabled', 'true');
    switchTab('terminal');
    return;
  }

  // Update details
  selectedHostname.textContent = agent.hostname;
  inputPrompt.textContent = agent.platform.toLowerCase().includes('win') ? 'PS >' : '$';

  const isOnline = agent.status === 'online';

  selectedAgentTags.innerHTML = `
    <span class="tag tag-status-${agent.status}">${agent.status}</span>
    <span class="tag tag-os">${agent.platform}</span>
    <span class="tag">Type: ${agent.type}</span>
    <span class="tag">IP: ${agent.ip}</span>
  `;

  if (isOnline) {
    console.log(`Agent ${agent.hostname} Docker Status:`, agent.docker);
    metricsPanel.classList.remove('hidden');
    tabBtnFiles.removeAttribute('disabled');
    // Update live metrics gauges
    cpuProgress.style.width = `${agent.metrics.cpu}%`;
    cpuValue.textContent = `${agent.metrics.cpu.toFixed(0)}%`;
    ramProgress.style.width = `${agent.metrics.ram}%`;
    ramValue.textContent = `${agent.metrics.ram.toFixed(0)}%`;
    platformText.textContent = agent.platform;
    ipText.textContent = agent.ip;
    
    // Enable input if not currently executing a command
    if (!currentCommandId) {
      setTerminalInputState(true);
    }

    // Show/Hide Docker tab
    if (agent.docker && agent.docker !== 'none') {
      tabBtnDocker.classList.remove('hidden');
      dockerStatusText.textContent = agent.docker === 'connected' ? 'Docker Connected' : 'Docker Installed (Service Not Running)';
      const dot = document.querySelector('.docker-status-indicator .status-dot');
      if (dot) {
        dot.className = `status-dot ${agent.docker === 'connected' ? 'online' : 'offline'}`;
      }
    } else {
      tabBtnDocker.classList.add('hidden');
      if (activeTab === 'docker') switchTab('terminal');
    }
  } else {
    metricsPanel.classList.add('hidden');
    setTerminalInputState(false);
    tabBtnFiles.setAttribute('disabled', 'true');
    switchTab('terminal');
    appendTerminalLine(`Agent is offline. Terminal connection paused.`, 'error-msg');
  }

  lucide.createIcons();
}

// Enable/Disable single terminal input and control button visibility
function setTerminalInputState(enabled) {
  const btnStopCommand = document.getElementById('btn-stop-command');
  if (!btnStopCommand) return;
  
  if (enabled && selectedAgentId) {
    const agent = agentsList.find(a => a.id === selectedAgentId);
    if (agent && agent.status === 'online') {
      terminalInput.removeAttribute('disabled');
      btnSendCommand.removeAttribute('disabled');
      btnSendCommand.classList.remove('hidden');
      btnStopCommand.classList.add('hidden');
      terminalInput.focus();
      return;
    }
  }
  
  terminalInput.setAttribute('disabled', 'true');
  btnSendCommand.setAttribute('disabled', 'true');
  
  if (currentCommandId && selectedAgentId) {
    btnSendCommand.classList.add('hidden');
    btnStopCommand.classList.remove('hidden');
    btnStopCommand.removeAttribute('disabled');
  } else {
    btnSendCommand.classList.remove('hidden');
    btnStopCommand.classList.add('hidden');
  }
}

// Write line helper to terminal UI
function appendTerminalLine(text, className = '') {
  const line = document.createElement('div');
  line.className = `terminal-line ${className}`;
  
  if (className === 'cmd-input-line') {
    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.textContent = inputPrompt.textContent;
    line.appendChild(prompt);
    line.appendChild(document.createTextNode(text.replace(/^\$\s*/, '')));
  } else {
    line.textContent = text;
  }
  
  terminalScreen.appendChild(line);
  terminalScreen.scrollTop = terminalScreen.scrollHeight;
}

// Streaming output appender
function appendTerminalOutput(text) {
  // Find or create current output element
  let activeOutput = terminalScreen.querySelector('.terminal-line.streaming-output');
  if (!activeOutput) {
    activeOutput = document.createElement('div');
    activeOutput.className = 'terminal-line streaming-output';
    terminalScreen.appendChild(activeOutput);
  }
  
  // Convert ANSI colors to HTML
  let html = ansiToHtml(text);
  
  // Make paths clickable
  html = html.replace(/(\/|~)[a-zA-Z0-9\._\-\/]+/g, (match) => {
    return `<span class="clickable-path" onclick="jumpToPath('${match}')">${match}</span>`;
  });

  const span = document.createElement('span');
  span.innerHTML = html;
  activeOutput.appendChild(span);
  
  terminalScreen.scrollTop = terminalScreen.scrollHeight;
}

function jumpToPath(path) {
    if (!selectedAgentId) return;
    switchTab('files');
    fetchDirectoryContents(path);
}

function ansiToHtml(text) {
  const colors = {
    '0': '', // Reset
    '30': 'color: #1a1b26', // Black
    '31': 'color: #f7768e', // Red
    '32': 'color: #9ece6a', // Green
    '33': 'color: #e0af68', // Yellow
    '34': 'color: #7aa2f7', // Blue
    '35': 'color: #bb9af7', // Magenta
    '36': 'color: #7dcfff', // Cyan
    '37': 'color: #a9b1d6', // White
    '90': 'color: #565f89', // Bright Black
    '91': 'color: #ff9e64', // Bright Red
  };

  return text
    .replace(/\x1B\[(\d+)m/g, (match, code) => {
      if (code === '0') return '</span>';
      const style = colors[code] || '';
      return `<span style="${style}">`;
    })
    .replace(/\n/g, '<br>');
}

// Send Command via Single Terminal UI
function submitCommand() {
  const cmd = terminalInput.value.trim();
  if (!cmd || !selectedAgentId) return;

  // Clear previous output marker so a new stream block is built
  const activeOutput = terminalScreen.querySelector('.terminal-line.streaming-output');
  if (activeOutput) {
    activeOutput.classList.remove('streaming-output');
  }

  if (dashboardSettings.autoClear) {
    terminalScreen.innerHTML = '';
    appendTerminalLine('Terminal cleared (Auto-clear enabled).', 'system-msg');
  }

  // Save to history
  if (cmd && (commandHistory.length === 0 || commandHistory[0] !== cmd)) {
    commandHistory.unshift(cmd);
    const limit = parseInt(dashboardSettings.historyLimit) || 100;
    if (commandHistory.length > limit) {
      commandHistory = commandHistory.slice(0, limit);
    }
    localStorage.setItem('commandHistory', JSON.stringify(commandHistory));
  }
  historyIndex = -1;

  socket.emit('execute-command', { agentId: selectedAgentId, cmd });
  terminalInput.value = '';
  terminalAutocomplete.classList.add('hidden');
}

// Event Listeners
terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitCommand();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      terminalInput.value = commandHistory[historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      terminalInput.value = commandHistory[historyIndex];
    } else if (historyIndex === 0) {
      historyIndex = -1;
      terminalInput.value = '';
    }
  }
});
btnSendCommand.addEventListener('click', submitCommand);

terminalInput.addEventListener('input', (e) => {
  const val = terminalInput.value.trim();
  if (!val || commandHistory.length === 0) {
    terminalAutocomplete.classList.add('hidden');
    return;
  }

  const suggestions = [...new Set(commandHistory)].filter(cmd => 
    cmd.toLowerCase().startsWith(val.toLowerCase()) && cmd !== val
  ).slice(0, 5);

  if (suggestions.length > 0) {
    terminalAutocomplete.innerHTML = suggestions.map(s => 
      `<div class="autocomplete-item">${s}</div>`
    ).join('');
    terminalAutocomplete.classList.remove('hidden');
    
    terminalAutocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        terminalInput.value = item.textContent;
        terminalAutocomplete.classList.add('hidden');
        terminalInput.focus();
      });
    });
  } else {
    terminalAutocomplete.classList.add('hidden');
  }
});

// Close autocomplete on blur
terminalInput.addEventListener('blur', () => {
  setTimeout(() => terminalAutocomplete.classList.add('hidden'), 200);
});

const btnStopCommand = document.getElementById('btn-stop-command');
if (btnStopCommand) {
  btnStopCommand.addEventListener('click', () => {
    if (selectedAgentId && currentCommandId) {
      socket.emit('kill-command', { agentId: selectedAgentId });
      appendTerminalLine('[Sending terminate signal (Ctrl+C)...]', 'system-msg');
      btnStopCommand.setAttribute('disabled', 'true');
    }
  });
}

btnClearTerminal.addEventListener('click', () => {
  terminalScreen.innerHTML = '';
  appendTerminalLine('Terminal cleared.', 'system-msg');
});

// ----------------------------------------------------
// Broadcast Panel Mechanics
// ----------------------------------------------------
btnBroadcastMode.addEventListener('click', () => {
  broadcastModal.classList.remove('hidden');
  updateBroadcastModalTargets();
});

btnCloseBroadcast.addEventListener('click', () => {
  broadcastModal.classList.add('hidden');
  broadcastCommandIds = {};
});

// Update standard display list in broadcast view
function updateBroadcastModalTargets() {
  const onlineAgents = agentsList.filter(a => a.status === 'online');
  
  if (onlineAgents.length === 0) {
    broadcastGridResults.innerHTML = `
      <div class="no-agents-modal">
        No online agents available to receive broadcast commands.
      </div>
    `;
    return;
  }

  // Keep existing terminals in the overlay but update connections
  // We recreate the grid but preserve history if running
  const activeInput = broadcastInput.value;
  
  // Create grids
  const currentRenderedIds = Array.from(broadcastGridResults.querySelectorAll('.broadcast-agent-card')).map(card => card.dataset.id);
  const onlineIds = onlineAgents.map(a => a.id);
  
  // Check if structure matches exactly, otherwise rebuild
  const matches = currentRenderedIds.length === onlineIds.length && currentRenderedIds.every((v,i) => v === onlineIds[i]);
  
  if (!matches) {
    broadcastGridResults.innerHTML = '';
    onlineAgents.forEach(agent => {
      const card = document.createElement('div');
      card.className = 'broadcast-agent-card';
      card.dataset.id = agent.id;
      card.innerHTML = `
        <div class="broadcast-agent-card-header">
          <span>${agent.hostname} (${agent.platform})</span>
          <span class="badge ${agent.type}">${agent.type}</span>
        </div>
        <div class="broadcast-agent-card-terminal" id="broadcast-term-${agent.id}">Ready for broadcast...</div>
      `;
      broadcastGridResults.appendChild(card);
    });
  }
}

// Trigger Broadcast Command Execution
btnSendBroadcast.addEventListener('click', () => {
  const cmd = broadcastInput.value.trim();
  if (!cmd) return;

  const onlineAgents = agentsList.filter(a => a.status === 'online');
  if (onlineAgents.length === 0) return;

  broadcastCommandIds = {}; // reset

  // Disable button temporarily during triggering
  btnSendBroadcast.setAttribute('disabled', 'true');
  
  onlineAgents.forEach(agent => {
    const termEl = document.getElementById(`broadcast-term-${agent.id}`);
    if (termEl) {
      termEl.textContent = `$ ${cmd}\n`;
    }

    // Set up unique listeners for each trigger
    // Since execute-command triggers command-started containing the commandId and agentId,
    // we catch this via the socket listener to pair them.
  });

  // Temporarily bind a listener to capture command IDs
  const captureStartedHandler = ({ commandId, agentId, cmd: sentCmd }) => {
    if (sentCmd === cmd) {
      broadcastCommandIds[agentId] = commandId;
    }
  };

  socket.on('command-started', captureStartedHandler);

  // Send request for each agent
  onlineAgents.forEach(agent => {
    socket.emit('execute-command', { agentId: agent.id, cmd });
  });

  // Cleanup temporary listener after a second
  setTimeout(() => {
    socket.off('command-started', captureStartedHandler);
    btnSendBroadcast.removeAttribute('disabled');
  }, 1000);
});

// Setup Initial View
renderAgentsList();
lucide.createIcons();

// ----------------------------------------------------
// Add Agent Modal & Installer Generation Mechanics
// ----------------------------------------------------
const addAgentModal = document.getElementById('add-agent-modal');
const btnAddAgentModal = document.getElementById('btn-add-agent-modal');
const btnCloseAddAgent = document.getElementById('btn-close-add-agent');
const agentServerHostInput = document.getElementById('agent-server-host');
const agentRunBackgroundInput = document.getElementById('agent-run-background');

const tabBtnBash = document.getElementById('tab-btn-bash');
const tabBtnPython = document.getElementById('tab-btn-python');
const tabContentBash = document.getElementById('tab-content-bash');
const tabContentPython = document.getElementById('tab-content-python');

const bashInstallCmd = document.getElementById('bash-install-cmd');
const pythonInstallCmd = document.getElementById('python-install-cmd');

const btnCopyBash = document.getElementById('btn-copy-bash');
const btnCopyPython = document.getElementById('btn-copy-python');

// Generate Installer commands
function updateInstallerCommands() {
  let serverHost = agentServerHostInput.value.trim();
  if (!serverHost) {
    serverHost = window.location.origin;
  }
  // Ensure protocol is present
  if (!/^https?:\/\//i.test(serverHost)) {
    serverHost = 'http://' + serverHost;
  }
  
  // Clean trailing slashes
  serverHost = serverHost.replace(/\/+$/, "");

  const runBg = agentRunBackgroundInput ? agentRunBackgroundInput.checked : true;

  // Update textareas
  if (runBg) {
    bashInstallCmd.value = `curl -sSL ${serverHost}/install-bash > agent.sh && chmod +x agent.sh && nohup ./agent.sh > /dev/null 2>&1 &`;
    pythonInstallCmd.value = `curl -sSL ${serverHost}/install-python > agent.py && pip3 install "python-socketio[client]" psutil --prefer-binary && nohup python3 agent.py > /dev/null 2>&1 &`;
  } else {
    bashInstallCmd.value = `curl -sSL ${serverHost}/install-bash > agent.sh && chmod +x agent.sh && ./agent.sh`;
    pythonInstallCmd.value = `curl -sSL ${serverHost}/install-python > agent.py && pip3 install "python-socketio[client]" psutil --prefer-binary && python3 agent.py`;
  }
}

// Show/Hide Modal
btnAddAgentModal.addEventListener('click', async () => {
  // Pre-fill server address with configured server_url or window's loaded location origin
  try {
    const res = await apiFetch('/api/config');
    if (!res) return;
    const config = await res.json();
    agentServerHostInput.value = config.serverUrl || window.location.origin;
  } catch (err) {
    console.error('Failed to load server config for installer:', err);
    agentServerHostInput.value = window.location.origin;
  }
  updateInstallerCommands();
  addAgentModal.classList.remove('hidden');
});

btnCloseAddAgent.addEventListener('click', () => {
  addAgentModal.classList.add('hidden');
});

// Host Address and Run Mode Change Listeners
agentServerHostInput.addEventListener('input', updateInstallerCommands);
if (agentRunBackgroundInput) {
  agentRunBackgroundInput.addEventListener('change', updateInstallerCommands);
}

// Tab switching
tabBtnBash.addEventListener('click', () => {
  tabBtnBash.classList.add('active');
  tabBtnPython.classList.remove('active');
  tabContentBash.classList.remove('hidden');
  tabContentPython.classList.add('hidden');
});

tabBtnPython.addEventListener('click', () => {
  tabBtnPython.classList.add('active');
  tabBtnBash.classList.remove('active');
  tabContentPython.classList.remove('hidden');
  tabContentBash.classList.add('hidden');
});

// Copy to Clipboard helpers
function copyTextToClipboard(textareaElement, buttonElement) {
  textareaElement.select();
  textareaElement.setSelectionRange(0, 99999); // for mobile

  try {
    navigator.clipboard.writeText(textareaElement.value).then(() => {
      showCopiedFeedback(buttonElement);
    }).catch(() => {
      // Fallback if Clipboard API fails
      document.execCommand('copy');
      showCopiedFeedback(buttonElement);
    });
  } catch (err) {
    // Fallback
    document.execCommand('copy');
    showCopiedFeedback(buttonElement);
  }
}

function showCopiedFeedback(button) {
  const originalHTML = button.innerHTML;
  button.innerHTML = `<i data-lucide="check" class="icon-sm"></i> Copied!`;
  lucide.createIcons();
  
  setTimeout(() => {
    button.innerHTML = originalHTML;
    lucide.createIcons();
  }, 2000);
}

btnCopyBash.addEventListener('click', () => {
  copyTextToClipboard(bashInstallCmd, btnCopyBash);
});

btnCopyPython.addEventListener('click', () => {
  copyTextToClipboard(pythonInstallCmd, btnCopyPython);
});

// File Browser Helpers and Listeners
tabBtnTerminal.addEventListener('click', () => switchTab('terminal'));
tabBtnFiles.addEventListener('click', () => switchTab('files'));
tabBtnDocker.addEventListener('click', () => switchTab('docker'));

dockerBtnRefresh.addEventListener('click', () => fetchDockerContainers());

function switchTab(tab) {
  activeTab = tab;
  
  // Update Buttons
  tabBtnTerminal.classList.toggle('active', tab === 'terminal');
  tabBtnFiles.classList.toggle('active', tab === 'files');
  tabBtnDocker.classList.toggle('active', tab === 'docker');
  
  // Update Content
  terminalTabContent.classList.toggle('hidden', tab !== 'terminal');
  fileBrowserTabContent.classList.toggle('hidden', tab !== 'files');
  dockerTabContent.classList.toggle('hidden', tab !== 'docker');
  
  // Common visibility
  btnClearTerminal.classList.toggle('hidden', tab !== 'terminal');
  
  if (tab === 'files' && selectedAgentId) {
    const currentPath = agentPaths[selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  } else if (tab === 'docker' && selectedAgentId) {
    fetchDockerContainers();
  }
}

function fetchDockerContainers() {
  if (!selectedAgentId) return;
  const agent = agentsList.find(a => a.id === selectedAgentId);
  if (!agent || agent.docker !== 'connected') return;

  showDockerLoading(true);
  dockerContainersBody.innerHTML = '';
  dockerEmptyState.classList.add('hidden');
  
  socket.emit('docker-list', { agentId: selectedAgentId });
}

function renderDockerList(containers) {
  dockerContainersBody.innerHTML = '';
  
  if (!containers || containers.length === 0) {
    dockerEmptyState.classList.remove('hidden');
    return;
  }
  
  dockerEmptyState.classList.add('hidden');
  
  containers.forEach(container => {
    const tr = document.createElement('tr');
    
    const isUp = container.status.toLowerCase().includes('up');
    const statusClass = isUp ? 'up' : 'exited';
    
    tr.innerHTML = `
      <td><span class="container-id">${container.id}</span></td>
      <td><strong>${container.name}</strong></td>
      <td><span class="container-status ${statusClass}">${container.status}</span></td>
      <td><code style="font-size: 0.8rem; color: var(--text-muted);">${container.image}</code></td>
      <td class="docker-actions-cell">
        <button class="btn btn-secondary btn-sm" onclick="alert('Control features coming soon')">
          <i data-lucide="play" class="icon-sm"></i>
        </button>
      </td>
    `;
    
    dockerContainersBody.appendChild(tr);
  });
  
  lucide.createIcons();
}

function showDockerLoading(show) {
  if (show) {
    dockerLoading.classList.remove('hidden');
  } else {
    dockerLoading.classList.add('hidden');
  }
}

function fetchDirectoryContents(path) {
  if (!selectedAgentId) return;
  showFbLoading(true);
  socket.emit('file-browse-list', { agentId: selectedAgentId, path: path });
}

function showFbLoading(show) {
  if (show) {
    fbLoading.classList.remove('hidden');
  } else {
    fbLoading.classList.add('hidden');
  }
}

function renderFileList(items) {
  fbFilesBody.innerHTML = '';
  fbGridView.innerHTML = '';
  
  if (!items || items.length === 0) {
    fbEmptyState.classList.remove('hidden');
    return;
  }
  
  fbEmptyState.classList.add('hidden');
  
  // Update view toggle icon
  fbViewIcon.setAttribute('data-lucide', fbViewMode === 'list' ? 'layout-grid' : 'list');
  if (fbViewMode === 'list') {
    fbTableView.classList.remove('hidden');
    fbGridView.classList.add('hidden');
  } else {
    fbTableView.classList.add('hidden');
    fbGridView.classList.remove('hidden');
  }
  
  // Sort items: folders first, then files (alphabetical)
  items.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  
  items.forEach(item => {
    const iconData = getFileIcon(item.name, item.isDir);
    const sizeText = item.isDir ? '-' : formatBytes(item.size);
    const dateText = item.mtime ? new Date(item.mtime).toLocaleString() : '-';

    if (fbViewMode === 'list') {
      const tr = document.createElement('tr');
      const nameHtml = item.isDir 
        ? `<span class="fb-folder-link" data-name="${item.name}">${item.name}</span>`
        : `<span class="fb-file-name">${item.name}</span>`;
      
      const actionHtml = item.isDir 
        ? '' 
        : `
          <div class="fb-actions-group">
            <button class="fb-action-btn btn-preview-file" data-name="${item.name}" title="Preview file">
              <i data-lucide="eye"></i>
              <span>Preview</span>
            </button>
            <button class="fb-action-btn btn-download-file" data-name="${item.name}" title="Download file">
              <i data-lucide="download"></i>
              <span>Get</span>
            </button>
          </div>
        `;
        
      tr.innerHTML = `
        <td class="col-name">
          <div class="fb-item-name-wrapper">
            <i data-lucide="${iconData.icon}" class="${iconData.class}" style="width:16px;height:16px;"></i>
            ${nameHtml}
          </div>
        </td>
        <td class="col-size">${sizeText}</td>
        <td class="col-mtime">${dateText}</td>
        <td class="col-actions">${actionHtml}</td>
      `;
      
      // Event Listeners for List View
      if (item.isDir) {
        tr.querySelector('.fb-folder-link').addEventListener('click', () => navigateToFolder(item.name));
      } else {
        tr.querySelector('.btn-download-file').addEventListener('click', () => downloadFile(item.name));
        tr.querySelector('.btn-preview-file').addEventListener('click', () => previewFile(item.name, item.size));
      }
      fbFilesBody.appendChild(tr);
    } else {
      // Grid View Rendering
      const gridItem = document.createElement('div');
      gridItem.className = 'fb-grid-item';
      
      const isImg = !item.isDir && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(item.name.split('.').pop().toLowerCase());
      
      let visualHtml = `
        <div class="fb-grid-icon-wrapper">
          <i data-lucide="${iconData.icon}" class="${iconData.class}"></i>
        </div>
      `;
      
      if (isImg) {
        visualHtml = `
          <img class="fb-grid-thumbnail" id="thumb-${item.name.replace(/[^a-zA-Z0-9]/g, '-')}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23242924'/%3E%3Cpath d='M30 40 L70 40 L50 70 Z' fill='%23444'/%3E%3C/svg%3E" alt="${item.name}">
        `;
        // Trigger thumbnail loading
        loadThumbnail(item.name);
      }

      gridItem.innerHTML = `
        ${visualHtml}
        <div class="fb-grid-name" title="${item.name}">${item.name}</div>
        <div class="fb-grid-meta">${item.isDir ? 'Folder' : sizeText}</div>
        <div class="fb-grid-actions ${item.isDir ? 'hidden' : ''}">
          <button class="fb-grid-action-btn btn-preview-file" title="Preview">
            <i data-lucide="eye" style="width:14px;height:14px;"></i>
          </button>
          <button class="fb-grid-action-btn btn-download-file" title="Download">
            <i data-lucide="download" style="width:14px;height:14px;"></i>
          </button>
        </div>
      `;
      
      gridItem.addEventListener('click', (e) => {
        if (e.target.closest('.fb-grid-action-btn')) return;
        if (item.isDir) navigateToFolder(item.name);
        else previewFile(item.name, item.size);
      });
      
      if (!item.isDir) {
        gridItem.querySelector('.btn-download-file').addEventListener('click', (e) => {
          e.stopPropagation();
          downloadFile(item.name);
        });
        gridItem.querySelector('.btn-preview-file').addEventListener('click', (e) => {
          e.stopPropagation();
          previewFile(item.name, item.size);
        });
      }
      
      fbGridView.appendChild(gridItem);
    }
  });
  
  lucide.createIcons();
}

// Helper functions extracted for reuse
function navigateToFolder(folderName) {
  const currentPath = agentPaths[selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let newPath = currentPath;
  if (newPath.endsWith(sep)) newPath = newPath.slice(0, -1);
  newPath = newPath + sep + folderName;
  fetchDirectoryContents(newPath);
}

function downloadFile(filename) {
  if (!selectedAgentId) return;
  const currentPath = agentPaths[selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  
  // Use the new streaming download endpoint
  const downloadUrl = `/api/download/stream?agentId=${selectedAgentId}&path=${encodeURIComponent(filePath)}`;
  window.open(downloadUrl, '_blank');
}

function previewFile(filename, size) {
  // Limit preview to 2MB to prevent browser lag
  const PREVIEW_LIMIT = 2 * 1024 * 1024;
  if (size > PREVIEW_LIMIT) {
    alert(`File is too large to preview (${formatBytes(size)}). Please use the Download button instead.`);
    return;
  }

  const currentPath = agentPaths[selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  previewTargetFilePath = filePath;
  showFbLoading(true);
  socket.emit('file-browse-download', { agentId: selectedAgentId, path: filePath });
}

function loadThumbnail(filename) {
  const currentPath = agentPaths[selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  
  // We use the same download event but handle it specifically for thumbnails if we want
  // To keep it simple for now, we just use the existing download event.
  // In a real app, we'd have a separate thumbnail event to avoid full file download.
  socket.emit('file-browse-download', { agentId: selectedAgentId, path: filePath, isThumbnail: true });
}

// Modify the socket listener for file-browse-download-response to handle thumbnails
// We need to update the existing listener. I'll do that in a separate chunk or chunk below.

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function base64ToBlob(base64, contentType = '') {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  return new Blob(byteArrays, {type: contentType});
}

// Navigation button handlers
fbBtnRefresh.addEventListener('click', () => {
  const currentPath = agentPaths[selectedAgentId] || '.';
  fetchDirectoryContents(currentPath);
});

fbBtnHome.addEventListener('click', () => {
  fetchDirectoryContents('~');
});

fbBtnGo.addEventListener('click', () => {
  const path = fbPathInput.value.trim();
  if (path) {
    fetchDirectoryContents(path);
  }
});

fbPathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const path = fbPathInput.value.trim();
    if (path) {
      fetchDirectoryContents(path);
    }
  }
});

fbBtnViewToggle.addEventListener('click', () => {
  fbViewMode = fbViewMode === 'list' ? 'grid' : 'list';
  localStorage.setItem('fbViewMode', fbViewMode);
  
  const currentPath = agentPaths[selectedAgentId] || '.';
  fetchDirectoryContents(currentPath);
});

fbBtnUp.addEventListener('click', () => {
  const currentPath = agentPaths[selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  
  // Resolve parent path
  const parts = currentPath.split(sep).filter(p => p.length > 0);
  if (parts.length > 0) {
    parts.pop();
    let parentPath = parts.join(sep);
    if (currentPath.startsWith('/') && !parentPath.startsWith('/')) {
      parentPath = '/' + parentPath;
    }
    if (currentPath.startsWith('\\\\') && !parentPath.startsWith('\\\\')) {
      parentPath = '\\\\' + parentPath;
    }
    if (parentPath === '') {
      parentPath = sep;
    }
    fetchDirectoryContents(parentPath);
  }
});

// Initialize files tab as disabled on startup since no agent is selected
tabBtnFiles.setAttribute('disabled', 'true');

// Toggle button click events
btnPreviewModeCode.addEventListener('click', () => {
  btnPreviewModeCode.classList.add('active');
  btnPreviewModeRender.classList.remove('active');
  previewContent.classList.remove('hidden');
  previewContentHtml.classList.add('hidden');
  setTimeout(() => {
    editor.resize();
    editor.renderer.updateFull();
  }, 50);
});

btnPreviewModeRender.addEventListener('click', () => {
  btnPreviewModeRender.classList.add('active');
  btnPreviewModeCode.classList.remove('active');
  previewContentHtml.classList.remove('hidden');
  previewContent.classList.add('hidden');
  
  if (typeof marked !== 'undefined') {
    previewContentHtml.innerHTML = marked.parse(previewRawContent);
  } else {
    previewContentHtml.innerHTML = "<p>Markdown renderer not loaded.</p>";
  }
});

// Preview Modal Close event
btnClosePreview.addEventListener('click', () => {
  previewModal.classList.add('hidden');
  editor.setValue('');
  previewContentHtml.innerHTML = '';
  previewRawContent = '';
  previewFilename.textContent = '';
});

// -----------------------------------------------
// Settings Modal
// -----------------------------------------------
const settingsModal = document.getElementById('settings-modal');
const btnSettingsModal = document.getElementById('btn-settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsServerUrl = document.getElementById('settings-server-url');
const settingsSecretToken = document.getElementById('settings-secret-token');
const settingsDashboardPassword = document.getElementById('settings-dashboard-password');

// New Settings UI Elements
const settingsTabBtns = document.querySelectorAll('.settings-tab-btn');
const settingsPanes = document.querySelectorAll('.settings-pane');

// Appearance Form Elements
const settingsTheme = document.getElementById('settings-theme');
const settingsCustomThemeSection = document.getElementById('settings-custom-theme-section');
const settingsCustomPrimary = document.getElementById('settings-custom-primary');
const settingsCustomBg = document.getElementById('settings-custom-bg');
const settingsTerminalFontSize = document.getElementById('settings-terminal-font-size');
const settingsTerminalFontFamily = document.getElementById('settings-terminal-font-family');
const settingsTerminalOpacity = document.getElementById('settings-terminal-opacity');

function toggleSettingsCustomThemeVisibility() {
  if (settingsTheme && settingsTheme.value === 'custom') {
    settingsCustomThemeSection.style.display = 'block';
  } else {
    settingsCustomThemeSection.style.display = 'none';
  }
}

if (settingsTheme) {
  settingsTheme.addEventListener('change', toggleSettingsCustomThemeVisibility);
}

// Behavior Form Elements
const settingsSoundEnabled = document.getElementById('settings-sound-enabled');
const settingsAutoClear = document.getElementById('settings-auto-clear');
const settingsHistoryLimit = document.getElementById('settings-history-limit');

// Settings Tab Logic
settingsTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    
    // Update buttons
    settingsTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update panes
    settingsPanes.forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });
  });
});

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }
  return response;
}

async function loadSettings() {
  try {
    // Load Server Settings
    const res = await apiFetch('/api/config');
    if (!res) return;
    const config = await res.json();
    settingsServerUrl.value = config.serverUrl || '';
    settingsSecretToken.value = config.secretToken || '';
    settingsDashboardPassword.value = ''; // Reset password field

    // Load Client Settings into form
    settingsTheme.value = dashboardSettings.theme;
    settingsTerminalFontSize.value = dashboardSettings.terminalFontSize;
    settingsTerminalFontFamily.value = dashboardSettings.terminalFontFamily;
    settingsTerminalOpacity.value = dashboardSettings.terminalOpacity;
    settingsSoundEnabled.checked = dashboardSettings.soundEnabled;
    settingsAutoClear.checked = dashboardSettings.autoClear;
    settingsHistoryLimit.value = dashboardSettings.historyLimit;
    
    // Load Custom Theme values if set
    if (settingsCustomPrimary && settingsCustomBg) {
      settingsCustomPrimary.value = localStorage.getItem('custom-theme-primary') || '#00b4d8';
      settingsCustomBg.value = localStorage.getItem('custom-theme-bg') || '#0a0b10';
    }
    toggleSettingsCustomThemeVisibility();
    
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

btnSettingsModal.addEventListener('click', () => {
  loadSettings();
  settingsModal.classList.remove('hidden');
  lucide.createIcons();
});

function closeSettings() {
  settingsModal.classList.add('hidden');
}

btnCloseSettings.addEventListener('click', closeSettings);
btnCancelSettings.addEventListener('click', closeSettings);

btnSaveSettings.addEventListener('click', async () => {
  btnSaveSettings.textContent = 'Saving...';
  btnSaveSettings.disabled = true;

  try {
    // 1. Save Server Settings
    const res = await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: settingsServerUrl.value.trim(),
        secretToken: settingsSecretToken.value.trim(),
        dashboardPassword: settingsDashboardPassword.value.trim()
      })
    });

    if (!res) return;
    const result = await res.json();
    
    if (result.status === 'success') {
      // 2. Save Client Settings to dashboardSettings object and localStorage
      dashboardSettings.theme = settingsTheme.value;
      dashboardSettings.terminalFontSize = settingsTerminalFontSize.value;
      dashboardSettings.terminalFontFamily = settingsTerminalFontFamily.value;
      dashboardSettings.terminalOpacity = settingsTerminalOpacity.value;
      dashboardSettings.soundEnabled = settingsSoundEnabled.checked;
      dashboardSettings.autoClear = settingsAutoClear.checked;
      dashboardSettings.historyLimit = settingsHistoryLimit.value;

      localStorage.setItem('theme', dashboardSettings.theme);
      localStorage.setItem('terminalFontSize', dashboardSettings.terminalFontSize);
      localStorage.setItem('terminalFontFamily', dashboardSettings.terminalFontFamily);
      localStorage.setItem('terminalOpacity', dashboardSettings.terminalOpacity);
      localStorage.setItem('soundEnabled', dashboardSettings.soundEnabled);
      localStorage.setItem('autoClear', dashboardSettings.autoClear);
      localStorage.setItem('historyLimit', dashboardSettings.historyLimit);

      // Save custom theme colors if custom is selected
      if (settingsTheme.value === 'custom') {
        localStorage.setItem('custom-theme-primary', settingsCustomPrimary.value);
        localStorage.setItem('custom-theme-bg', settingsCustomBg.value);
        
        // Sync color picker dropdown controls
        if (dropdownCustomPrimary && dropdownCustomBg) {
          dropdownCustomPrimary.value = settingsCustomPrimary.value;
          dropdownCustomBg.value = settingsCustomBg.value;
        }
      }

      // 3. Apply appearance changes instantly
      applyDashboardSettings();

      btnSaveSettings.textContent = '✓ Saved!';
      setTimeout(() => {
        btnSaveSettings.textContent = 'Save Settings';
        btnSaveSettings.disabled = false;
        closeSettings();
      }, 1200);
    } else {
      alert('Error saving settings: ' + (result.message || 'Unknown error'));
      btnSaveSettings.textContent = 'Save Settings';
      btnSaveSettings.disabled = false;
    }
  } catch (err) {
    alert('Network error: ' + err.message);
    btnSaveSettings.textContent = 'Save Settings';
    btnSaveSettings.disabled = false;
  }
});

// Logout Logic
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout failed:', err);
      window.location.href = '/login';
    }
  });
}

// Mobile Sidebar Toggle event listeners
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const sidebar = document.querySelector('.sidebar');

if (btnToggleSidebar && sidebar && sidebarBackdrop) {
  const toggleSidebar = () => {
    sidebar.classList.toggle('open');
    sidebarBackdrop.classList.toggle('hidden');
  };

  btnToggleSidebar.addEventListener('click', toggleSidebar);
  sidebarBackdrop.addEventListener('click', toggleSidebar);
}

function renderBreadcrumbs(path) {
  fbBreadcrumbs.innerHTML = '';
  fbBreadcrumbs.classList.remove('hidden');
  fbPathInput.classList.add('hidden');
  
  if (!path) return;
  
  // Handle both Windows and Linux separators
  const isWindows = path.includes('\\') || /^[a-zA-Z]:/.test(path);
  const sep = isWindows ? '\\' : '/';
  
  // Split path into parts, preserving the root/drive
  let parts = path.split(sep).filter(p => p !== '');
  let currentAccumulatedPath = '';
  
  // If it's a linux absolute path, add a root item
  if (path.startsWith('/') && !isWindows) {
    const rootItem = createBreadcrumbItem('/', '/');
    fbBreadcrumbs.appendChild(rootItem);
    currentAccumulatedPath = '/';
  } else if (isWindows && path.length >= 2 && path[1] === ':') {
    // Keep drive letter as a part if it's there
  }
  
  parts.forEach((part, index) => {
    if (fbBreadcrumbs.children.length > 0) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = sep;
      fbBreadcrumbs.appendChild(separator);
    }
    
    if (isWindows && index === 0 && part.includes(':')) {
        currentAccumulatedPath = part;
    } else {
        if (currentAccumulatedPath && !currentAccumulatedPath.endsWith(sep)) {
            currentAccumulatedPath += sep;
        }
        currentAccumulatedPath += part;
    }
    
    const item = createBreadcrumbItem(part, currentAccumulatedPath);
    fbBreadcrumbs.appendChild(item);
  });
}

function createBreadcrumbItem(name, targetPath) {
  const span = document.createElement('span');
  span.className = 'breadcrumb-item';
  span.textContent = name;
  span.addEventListener('click', (e) => {
    e.stopPropagation();
    fetchDirectoryContents(targetPath);
  });
  return span;
}

// Click container to edit path manually
if (fbPathContainer) {
  fbPathContainer.addEventListener('click', () => {
    fbBreadcrumbs.classList.add('hidden');
    fbPathInput.classList.remove('hidden');
    fbPathInput.focus();
    fbPathInput.select();
  });
}

// Blur or Enter to save path
if (fbPathInput) {
  fbPathInput.addEventListener('blur', () => {
    setTimeout(() => {
        if (fbPathInput.classList.contains('hidden')) return;
        fbBreadcrumbs.classList.remove('hidden');
        fbPathInput.classList.add('hidden');
    }, 200);
  });

  fbPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      fetchDirectoryContents(fbPathInput.value);
    } else if (e.key === 'Escape') {
        fbBreadcrumbs.classList.remove('hidden');
        fbPathInput.classList.add('hidden');
        fbPathInput.value = agentPaths[selectedAgentId];
    }
  });
}

