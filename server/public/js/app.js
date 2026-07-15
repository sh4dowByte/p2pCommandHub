import { socket } from './socket.js';
import { state } from './state.js';
import { editor } from './editor.js';
import { apiFetch, playNotificationSound, ansiToHtml } from './utils.js';
import { updateThemeUI, applyThemeClass, applyCustomTheme } from './theme.js';
import {
  handleFileBrowseResponse,
  handleDockerListResponse,
  handleFileBrowseDownloadResponse,
  fetchDirectoryContents,
  fetchDockerContainers
} from './fileBrowser.js';

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
const dockerBtnRefresh = document.getElementById('docker-btn-refresh');
const dockerEmptyState = document.getElementById('docker-empty-state');
const dockerStatusText = document.getElementById('docker-status-text');

// Broadcast Elements
const btnBroadcastMode = document.getElementById('btn-broadcast-mode');
const broadcastModal = document.getElementById('broadcast-modal');
const btnCloseBroadcast = document.getElementById('btn-close-broadcast');
const broadcastInput = document.getElementById('broadcast-input');
const btnSendBroadcast = document.getElementById('btn-send-broadcast');
const broadcastGridResults = document.getElementById('broadcast-grid-results');

// Theme Switcher & Toggle Handler
const themeDropdown = document.getElementById('theme-dropdown');
const dropdownCustomPrimary = document.getElementById('dropdown-custom-primary');
const dropdownCustomBg = document.getElementById('dropdown-custom-bg');
const btnApplyDropdownCustom = document.getElementById('btn-apply-dropdown-custom');

// Settings DOM Elements
const settingsModal = document.getElementById('settings-modal');
const btnSettingsModal = document.getElementById('btn-settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsServerUrl = document.getElementById('settings-server-url');
const settingsSecretToken = document.getElementById('settings-secret-token');
const settingsDashboardPassword = document.getElementById('settings-dashboard-password');
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

// Behavior Form Elements
const settingsSoundEnabled = document.getElementById('settings-sound-enabled');
const settingsAutoClear = document.getElementById('settings-auto-clear');
const settingsHistoryLimit = document.getElementById('settings-history-limit');

// Add Agent Modal Elements
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

// Set initial dropdown values from localStorage
if (dropdownCustomPrimary && dropdownCustomBg) {
  dropdownCustomPrimary.value = localStorage.getItem('custom-theme-primary') || '#00b4d8';
  dropdownCustomBg.value = localStorage.getItem('custom-theme-bg') || '#0a0b10';
}

// Initial theme UI update
updateThemeUI(editor);

// Apply initial dashboard settings
export function applyDashboardSettings() {
  // Theme
  updateThemeUI(editor);
  
  // Terminal Font Size
  terminalScreen.style.fontSize = `${state.dashboardSettings.terminalFontSize}px`;
  
  // Terminal Font Family
  terminalScreen.style.fontFamily = state.dashboardSettings.terminalFontFamily;
  
  // Terminal Opacity
  terminalScreen.style.opacity = state.dashboardSettings.terminalOpacity;
  
  // Ace Editor Preview Settings
  if (typeof editor !== 'undefined') {
    editor.setOptions({
      fontSize: `${state.dashboardSettings.terminalFontSize}px`,
      fontFamily: state.dashboardSettings.terminalFontFamily
    });
  }
}
applyDashboardSettings();

// Socket Events
socket.on('connect', () => {
  console.log('Connected to server websocket');
});

socket.on('file-browse-response', handleFileBrowseResponse);
socket.on('docker-list-response', handleDockerListResponse);
socket.on('file-browse-download-response', handleFileBrowseDownloadResponse);

socket.on('agents-update', (agents) => {
  const oldOnlineCount = state.agentsList.filter(a => a.status === 'online').length;
  const newOnlineCount = agents.filter(a => a.status === 'online').length;
  
  if (newOnlineCount > oldOnlineCount) {
    playNotificationSound('connect');
  } else if (newOnlineCount < oldOnlineCount) {
    playNotificationSound('disconnect');
  }

  state.agentsList = agents;
  renderAgentsList();
  updateSelectedAgentData();
  updateBroadcastModalTargets();
});

socket.on('command-started', ({ commandId, agentId, cmd }) => {
  if (agentId === state.selectedAgentId) {
    state.currentCommandId = commandId;
    state.commandOutputs[commandId] = "";
    
    appendTerminalLine(`$ ${cmd}`, 'cmd-input-line');
    setTerminalInputState(false);
  }
});

socket.on('command-output', ({ commandId, output, isEof, exitCode }) => {
  // 1. Single Agent Terminal Logic
  if (commandId === state.currentCommandId) {
    appendTerminalOutput(output);
    if (isEof) {
      appendTerminalLine(`[Process exited with code ${exitCode}]`, 'system-msg');
      setTerminalInputState(true);
      state.currentCommandId = null;
    }
  }

  // 2. Broadcast Terminal Logic
  for (const [agentId, bCmdId] of Object.entries(state.broadcastCommandIds)) {
    if (bCmdId === commandId) {
      const termEl = document.getElementById(`broadcast-term-${agentId}`);
      if (termEl) {
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
  state.currentCommandId = null;
});

// Render Sidebar List
export function renderAgentsList() {
  if (state.agentsList.length === 0) {
    agentsContainer.innerHTML = `
      <div class="no-agents">
        <i data-lucide="wifi-off"></i>
        <p>No agents connected yet</p>
      </div>
    `;
    agentCount.textContent = "0";
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    return;
  }

  agentCount.textContent = state.agentsList.length;
  agentsContainer.innerHTML = '';

  state.agentsList.forEach(agent => {
    const isSelected = agent.id === state.selectedAgentId;
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

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Select an Agent
export function selectAgent(agentId) {
  state.selectedAgentId = agentId;
  state.currentCommandId = null;
  
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

  if (state.activeTab === 'files') {
    const currentPath = state.agentPaths[state.selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  } else if (state.activeTab === 'docker') {
    fetchDockerContainers();
  }
}

// Update Active Details Panel
export function updateSelectedAgentData() {
  const agent = state.agentsList.find(a => a.id === state.selectedAgentId);
  
  if (!agent) {
    selectedHostname.textContent = 'Select an Agent';
    selectedAgentTags.innerHTML = `<span class="tag placeholder-tag">Connect an agent to start remote shell execution</span>`;
    metricsPanel.classList.add('hidden');
    setTerminalInputState(false);
    inputPrompt.textContent = '$';
    tabBtnFiles.setAttribute('disabled', 'true');
    switchTab('terminal');
    return;
  }

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
    cpuProgress.style.width = `${agent.metrics.cpu}%`;
    cpuValue.textContent = `${agent.metrics.cpu.toFixed(0)}%`;
    ramProgress.style.width = `${agent.metrics.ram}%`;
    ramValue.textContent = `${agent.metrics.ram.toFixed(0)}%`;
    platformText.textContent = agent.platform;
    ipText.textContent = agent.ip;
    
    if (!state.currentCommandId) {
      setTerminalInputState(true);
    }

    if (agent.docker && agent.docker !== 'none') {
      tabBtnDocker.classList.remove('hidden');
      dockerStatusText.textContent = agent.docker === 'connected' ? 'Docker Connected' : 'Docker Installed (Service Not Running)';
      const dot = document.querySelector('.docker-status-indicator .status-dot');
      if (dot) {
        dot.className = `status-dot ${agent.docker === 'connected' ? 'online' : 'offline'}`;
      }
    } else {
      tabBtnDocker.classList.add('hidden');
      if (state.activeTab === 'docker') switchTab('terminal');
    }
  } else {
    metricsPanel.classList.add('hidden');
    setTerminalInputState(false);
    tabBtnFiles.setAttribute('disabled', 'true');
    switchTab('terminal');
    appendTerminalLine(`Agent is offline. Terminal connection paused.`, 'error-msg');
  }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Enable/Disable single terminal input and control button visibility
export function setTerminalInputState(enabled) {
  const btnStopCommand = document.getElementById('btn-stop-command');
  if (!btnStopCommand) return;
  
  if (enabled && state.selectedAgentId) {
    const agent = state.agentsList.find(a => a.id === state.selectedAgentId);
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
  
  if (state.currentCommandId && state.selectedAgentId) {
    btnSendCommand.classList.add('hidden');
    btnStopCommand.classList.remove('hidden');
    btnStopCommand.removeAttribute('disabled');
  } else {
    btnSendCommand.classList.remove('hidden');
    btnStopCommand.classList.add('hidden');
  }
}

// Write line helper to terminal UI
export function appendTerminalLine(text, className = '') {
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
export function appendTerminalOutput(text) {
  let activeOutput = terminalScreen.querySelector('.terminal-line.streaming-output');
  if (!activeOutput) {
    activeOutput = document.createElement('div');
    activeOutput.className = 'terminal-line streaming-output';
    terminalScreen.appendChild(activeOutput);
  }
  
  let html = ansiToHtml(text);
  
  // Make paths clickable
  html = html.replace(/(\/|~)[a-zA-Z0-9\._\-\/]+/g, (match) => {
    return `<span class="clickable-path">${match}</span>`;
  });

  const span = document.createElement('span');
  span.innerHTML = html;
  activeOutput.appendChild(span);
  
  terminalScreen.scrollTop = terminalScreen.scrollHeight;
}

// Send Command via Single Terminal UI
export function submitCommand() {
  const cmd = terminalInput.value.trim();
  if (!cmd || !state.selectedAgentId) return;

  const activeOutput = terminalScreen.querySelector('.terminal-line.streaming-output');
  if (activeOutput) {
    activeOutput.classList.remove('streaming-output');
  }

  if (state.dashboardSettings.autoClear) {
    terminalScreen.innerHTML = '';
    appendTerminalLine('Terminal cleared (Auto-clear enabled).', 'system-msg');
  }

  // Save to history
  if (cmd && (state.commandHistory.length === 0 || state.commandHistory[0] !== cmd)) {
    state.commandHistory.unshift(cmd);
    const limit = parseInt(state.dashboardSettings.historyLimit) || 100;
    if (state.commandHistory.length > limit) {
      state.commandHistory = state.commandHistory.slice(0, limit);
    }
    localStorage.setItem('commandHistory', JSON.stringify(state.commandHistory));
  }
  state.historyIndex = -1;

  socket.emit('execute-command', { agentId: state.selectedAgentId, cmd });
  terminalInput.value = '';
  terminalAutocomplete.classList.add('hidden');
}

// Event Listeners for Terminal
terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitCommand();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.historyIndex < state.commandHistory.length - 1) {
      state.historyIndex++;
      terminalInput.value = state.commandHistory[state.historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.historyIndex > 0) {
      state.historyIndex--;
      terminalInput.value = state.commandHistory[state.historyIndex];
    } else if (state.historyIndex === 0) {
      state.historyIndex = -1;
      terminalInput.value = '';
    }
  }
});
btnSendCommand.addEventListener('click', submitCommand);

terminalInput.addEventListener('input', (e) => {
  const val = terminalInput.value.trim();
  if (!val || state.commandHistory.length === 0) {
    terminalAutocomplete.classList.add('hidden');
    return;
  }

  const suggestions = [...new Set(state.commandHistory)].filter(cmd => 
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

terminalInput.addEventListener('blur', () => {
  setTimeout(() => terminalAutocomplete.classList.add('hidden'), 200);
});

const btnStopCommand = document.getElementById('btn-stop-command');
if (btnStopCommand) {
  btnStopCommand.addEventListener('click', () => {
    if (state.selectedAgentId && state.currentCommandId) {
      socket.emit('kill-command', { agentId: state.selectedAgentId });
      appendTerminalLine('[Sending terminate signal (Ctrl+C)...]', 'system-msg');
      btnStopCommand.setAttribute('disabled', 'true');
    }
  });
}

btnClearTerminal.addEventListener('click', () => {
  terminalScreen.innerHTML = '';
  appendTerminalLine('Terminal cleared.', 'system-msg');
});

// Event delegation for clickable terminal paths
terminalScreen.addEventListener('click', (e) => {
  if (e.target.classList.contains('clickable-path')) {
    const path = e.target.textContent;
    if (!state.selectedAgentId) return;
    switchTab('files');
    fetchDirectoryContents(path);
  }
});

// Broadcast Panel Mechanics
btnBroadcastMode.addEventListener('click', () => {
  broadcastModal.classList.remove('hidden');
  updateBroadcastModalTargets();
});

btnCloseBroadcast.addEventListener('click', () => {
  broadcastModal.classList.add('hidden');
  state.broadcastCommandIds = {};
});

export function updateBroadcastModalTargets() {
  const onlineAgents = state.agentsList.filter(a => a.status === 'online');
  
  if (onlineAgents.length === 0) {
    broadcastGridResults.innerHTML = `
      <div class="no-agents-modal">
        No online agents available to receive broadcast commands.
      </div>
    `;
    return;
  }

  const currentRenderedIds = Array.from(broadcastGridResults.querySelectorAll('.broadcast-agent-card')).map(card => card.dataset.id);
  const onlineIds = onlineAgents.map(a => a.id);
  
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

btnSendBroadcast.addEventListener('click', () => {
  const cmd = broadcastInput.value.trim();
  if (!cmd) return;

  const onlineAgents = state.agentsList.filter(a => a.status === 'online');
  if (onlineAgents.length === 0) return;

  state.broadcastCommandIds = {};

  btnSendBroadcast.setAttribute('disabled', 'true');
  
  onlineAgents.forEach(agent => {
    const termEl = document.getElementById(`broadcast-term-${agent.id}`);
    if (termEl) {
      termEl.textContent = `$ ${cmd}\n`;
    }
  });

  const captureStartedHandler = ({ commandId, agentId, cmd: sentCmd }) => {
    if (sentCmd === cmd) {
      state.broadcastCommandIds[agentId] = commandId;
    }
  };

  socket.on('command-started', captureStartedHandler);

  onlineAgents.forEach(agent => {
    socket.emit('execute-command', { agentId: agent.id, cmd });
  });

  setTimeout(() => {
    socket.off('command-started', captureStartedHandler);
    btnSendBroadcast.removeAttribute('disabled');
  }, 1000);
});

// Add Agent Modal & Installer Generation
export function updateInstallerCommands() {
  let serverHost = agentServerHostInput.value.trim();
  if (!serverHost) {
    serverHost = window.location.origin;
  }
  if (!/^https?:\/\//i.test(serverHost)) {
    serverHost = 'http://' + serverHost;
  }
  serverHost = serverHost.replace(/\/+$/, "");

  const runBg = agentRunBackgroundInput ? agentRunBackgroundInput.checked : true;

  if (runBg) {
    bashInstallCmd.value = `curl -sSL ${serverHost}/install-bash > agent.sh && chmod +x agent.sh && nohup ./agent.sh > /dev/null 2>&1 &`;
    pythonInstallCmd.value = `curl -sSL ${serverHost}/install-python > agent.py && pip3 install "python-socketio[client]" psutil --prefer-binary && nohup python3 agent.py > /dev/null 2>&1 &`;
  } else {
    bashInstallCmd.value = `curl -sSL ${serverHost}/install-bash > agent.sh && chmod +x agent.sh && ./agent.sh`;
    pythonInstallCmd.value = `curl -sSL ${serverHost}/install-python > agent.py && pip3 install "python-socketio[client]" psutil --prefer-binary && python3 agent.py`;
  }
}

btnAddAgentModal.addEventListener('click', async () => {
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

agentServerHostInput.addEventListener('input', updateInstallerCommands);
if (agentRunBackgroundInput) {
  agentRunBackgroundInput.addEventListener('change', updateInstallerCommands);
}

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

function copyTextToClipboard(textareaElement, buttonElement) {
  textareaElement.select();
  textareaElement.setSelectionRange(0, 99999);

  try {
    navigator.clipboard.writeText(textareaElement.value).then(() => {
      showCopiedFeedback(buttonElement);
    }).catch(() => {
      document.execCommand('copy');
      showCopiedFeedback(buttonElement);
    });
  } catch (err) {
    document.execCommand('copy');
    showCopiedFeedback(buttonElement);
  }
}

function showCopiedFeedback(button) {
  const originalHTML = button.innerHTML;
  button.innerHTML = `<i data-lucide="check" class="icon-sm"></i> Copied!`;
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  setTimeout(() => {
    button.innerHTML = originalHTML;
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }, 2000);
}

btnCopyBash.addEventListener('click', () => {
  copyTextToClipboard(bashInstallCmd, btnCopyBash);
});

btnCopyPython.addEventListener('click', () => {
  copyTextToClipboard(pythonInstallCmd, btnCopyPython);
});

// Tabs UI Event Listeners
tabBtnTerminal.addEventListener('click', () => switchTab('terminal'));
tabBtnFiles.addEventListener('click', () => switchTab('files'));
tabBtnDocker.addEventListener('click', () => switchTab('docker'));
dockerBtnRefresh.addEventListener('click', () => fetchDockerContainers());

export function switchTab(tab) {
  state.activeTab = tab;
  
  tabBtnTerminal.classList.toggle('active', tab === 'terminal');
  tabBtnFiles.classList.toggle('active', tab === 'files');
  tabBtnDocker.classList.toggle('active', tab === 'docker');
  
  terminalTabContent.classList.toggle('hidden', tab !== 'terminal');
  fileBrowserTabContent.classList.toggle('hidden', tab !== 'files');
  dockerTabContent.classList.toggle('hidden', tab !== 'docker');
  
  btnClearTerminal.classList.toggle('hidden', tab !== 'terminal');
  
  if (tab === 'files' && state.selectedAgentId) {
    const currentPath = state.agentPaths[state.selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  } else if (tab === 'docker' && state.selectedAgentId) {
    fetchDockerContainers();
  }
}

// Setup Initial View
renderAgentsList();
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
}
tabBtnFiles.setAttribute('disabled', 'true');

// Theme Switcher events
btnThemeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  themeDropdown.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (themeDropdown && !themeDropdown.classList.contains('hidden') && !e.target.closest('.theme-switcher-container')) {
    themeDropdown.classList.add('hidden');
  }
});

document.querySelectorAll('.theme-opt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedTheme = btn.getAttribute('data-theme');
    state.currentTheme = selectedTheme;
    state.dashboardSettings.theme = state.currentTheme;
    localStorage.setItem('theme', state.currentTheme);
    updateThemeUI(editor);
    
    if (settingsTheme) {
      settingsTheme.value = state.currentTheme;
      toggleSettingsCustomThemeVisibility();
    }
    
    themeDropdown.classList.add('hidden');
  });
});

if (btnApplyDropdownCustom) {
  btnApplyDropdownCustom.addEventListener('click', () => {
    const prim = dropdownCustomPrimary.value;
    const bg = dropdownCustomBg.value;
    
    localStorage.setItem('custom-theme-primary', prim);
    localStorage.setItem('custom-theme-bg', bg);
    
    state.currentTheme = 'custom';
    state.dashboardSettings.theme = 'custom';
    localStorage.setItem('theme', 'custom');
    
    updateThemeUI(editor);
    
    if (settingsTheme) {
      settingsTheme.value = 'custom';
      toggleSettingsCustomThemeVisibility();
    }
    if (settingsCustomPrimary && settingsCustomBg) {
      settingsCustomPrimary.value = prim;
      settingsCustomBg.value = bg;
    }
    
    themeDropdown.classList.add('hidden');
  });
}

// Settings Modal logic
export function toggleSettingsCustomThemeVisibility() {
  if (settingsTheme && settingsTheme.value === 'custom') {
    settingsCustomThemeSection.style.display = 'block';
  } else {
    settingsCustomThemeSection.style.display = 'none';
  }
}

if (settingsTheme) {
  settingsTheme.addEventListener('change', toggleSettingsCustomThemeVisibility);
}

settingsTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    settingsTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    settingsPanes.forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });
  });
});

export async function loadSettings() {
  try {
    const res = await apiFetch('/api/config');
    if (!res) return;
    const config = await res.json();
    settingsServerUrl.value = config.serverUrl || '';
    settingsSecretToken.value = config.secretToken || '';
    settingsDashboardPassword.value = '';

    settingsTheme.value = state.dashboardSettings.theme;
    settingsTerminalFontSize.value = state.dashboardSettings.terminalFontSize;
    settingsTerminalFontFamily.value = state.dashboardSettings.terminalFontFamily;
    settingsTerminalOpacity.value = state.dashboardSettings.terminalOpacity;
    settingsSoundEnabled.checked = state.dashboardSettings.soundEnabled;
    settingsAutoClear.checked = state.dashboardSettings.autoClear;
    settingsHistoryLimit.value = state.dashboardSettings.historyLimit;
    
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
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

export function closeSettings() {
  settingsModal.classList.add('hidden');
}

btnCloseSettings.addEventListener('click', closeSettings);
btnCancelSettings.addEventListener('click', closeSettings);

btnSaveSettings.addEventListener('click', async () => {
  btnSaveSettings.textContent = 'Saving...';
  btnSaveSettings.disabled = true;

  try {
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
      state.dashboardSettings.theme = settingsTheme.value;
      state.dashboardSettings.terminalFontSize = settingsTerminalFontSize.value;
      state.dashboardSettings.terminalFontFamily = settingsTerminalFontFamily.value;
      state.dashboardSettings.terminalOpacity = settingsTerminalOpacity.value;
      state.dashboardSettings.soundEnabled = settingsSoundEnabled.checked;
      state.dashboardSettings.autoClear = settingsAutoClear.checked;
      state.dashboardSettings.historyLimit = settingsHistoryLimit.value;

      localStorage.setItem('theme', state.dashboardSettings.theme);
      localStorage.setItem('terminalFontSize', state.dashboardSettings.terminalFontSize);
      localStorage.setItem('terminalFontFamily', state.dashboardSettings.terminalFontFamily);
      localStorage.setItem('terminalOpacity', state.dashboardSettings.terminalOpacity);
      localStorage.setItem('soundEnabled', state.dashboardSettings.soundEnabled);
      localStorage.setItem('autoClear', state.dashboardSettings.autoClear);
      localStorage.setItem('historyLimit', state.dashboardSettings.historyLimit);

      if (settingsTheme.value === 'custom') {
        localStorage.setItem('custom-theme-primary', settingsCustomPrimary.value);
        localStorage.setItem('custom-theme-bg', settingsCustomBg.value);
        
        if (dropdownCustomPrimary && dropdownCustomBg) {
          dropdownCustomPrimary.value = settingsCustomPrimary.value;
          dropdownCustomBg.value = settingsCustomBg.value;
        }
      }

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

// Mobile Sidebar Toggle
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
