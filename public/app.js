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

// Tabs DOM Elements
const tabBtnTerminal = document.getElementById('tab-btn-terminal');
const tabBtnFiles = document.getElementById('tab-btn-files');
const terminalTabContent = document.getElementById('terminal-tab-content');
const fileBrowserTabContent = document.getElementById('file-browser-tab-content');

// File Browser DOM Elements
const fbBtnUp = document.getElementById('fb-btn-up');
const fbBtnHome = document.getElementById('fb-btn-home');
const fbPathInput = document.getElementById('fb-path-input');
const fbBtnGo = document.getElementById('fb-btn-go');
const fbBtnRefresh = document.getElementById('fb-btn-refresh');
const fbFilesBody = document.getElementById('fb-files-body');
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
const btnSendBroadcast = document.getElementById('btn-send-broadcast');
const broadcastGridResults = document.getElementById('broadcast-grid-results');

// Socket Events
socket.on('connect', () => {
  console.log('Connected to server websocket');
});

socket.on('file-browse-response', (response) => {
  showFbLoading(false);
  if (response.status === 'success') {
    agentPaths[selectedAgentId] = response.path;
    fbPathInput.value = response.path;
    renderFileList(response.items);
  } else {
    alert(`Error: ${response.message || 'Failed to list directory'}`);
  }
});

socket.on('file-browse-download-response', (response) => {
  showFbLoading(false);
  if (response.status === 'success') {
    if (previewTargetFilePath && response.path === previewTargetFilePath) {
      previewTargetFilePath = null;
      previewFilename.textContent = response.name;
      
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
        previewContentHtml.classList.add('hidden');
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
    alert(`Error: ${response.message || 'Failed to process file'}`);
  }
});

socket.on('agents-update', (agents) => {
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
      platformIcon = 'windows'; // Note: Lucide fallback to monitor if windows isn't loaded, let's use check or simple icons
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

  // Load files for new agent if already on the Files tab
  if (activeTab === 'files') {
    const currentPath = agentPaths[selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
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
  
  activeOutput.textContent += text;
  terminalScreen.scrollTop = terminalScreen.scrollHeight;
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

  socket.emit('execute-command', { agentId: selectedAgentId, cmd });
  terminalInput.value = '';
}

// Event Listeners
terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitCommand();
  }
});
btnSendCommand.addEventListener('click', submitCommand);

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

  // Update textareas
  bashInstallCmd.value = `curl -sSL ${serverHost}/install-bash | bash`;
  pythonInstallCmd.value = `curl -sSL ${serverHost}/install-python > agent.py && pip3 install "python-socketio[client]"  psutil --prefer-binary && python3 agent.py`;
}

// Show/Hide Modal
btnAddAgentModal.addEventListener('click', async () => {
  // Pre-fill server address with configured server_url or window's loaded location origin
  try {
    const res = await fetch('/api/config');
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

// Host Address Input Listener
agentServerHostInput.addEventListener('input', updateInstallerCommands);

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

function switchTab(tab) {
  activeTab = tab;
  if (tab === 'terminal') {
    tabBtnTerminal.classList.add('active');
    tabBtnFiles.classList.remove('active');
    terminalTabContent.classList.remove('hidden');
    fileBrowserTabContent.classList.add('hidden');
    btnClearTerminal.classList.remove('hidden');
  } else {
    tabBtnFiles.classList.add('active');
    tabBtnTerminal.classList.remove('active');
    fileBrowserTabContent.classList.remove('hidden');
    terminalTabContent.classList.add('hidden');
    btnClearTerminal.classList.add('hidden');
    
    if (selectedAgentId) {
      const currentPath = agentPaths[selectedAgentId] || '.';
      fetchDirectoryContents(currentPath);
    }
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
  
  if (!items || items.length === 0) {
    fbEmptyState.classList.remove('hidden');
    return;
  }
  
  fbEmptyState.classList.add('hidden');
  
  // Sort items: folders first, then files (alphabetical)
  items.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  
  items.forEach(item => {
    const tr = document.createElement('tr');
    
    // File Size Formatting
    let sizeText = '-';
    if (!item.isDir) {
      sizeText = formatBytes(item.size);
    }
    
    // Modified Date Formatting
    let dateText = '-';
    if (item.mtime) {
      const d = new Date(item.mtime);
      dateText = d.toLocaleString();
    }
    
    const icon = item.isDir ? 'folder' : 'file';
    const iconClass = item.isDir ? 'fb-icon-folder' : 'fb-icon-file';
    
    const nameHtml = item.isDir 
      ? `<span class="fb-folder-link" data-name="${item.name}">${item.name}</span>`
      : `<span class="fb-file-name">${item.name}</span>`;
    
    const actionHtml = item.isDir 
      ? '' 
      : `<button class="btn btn-secondary btn-icon-only btn-preview-file" data-name="${item.name}" title="Preview file" style="margin-right: 6px;"><i data-lucide="eye" style="width:14px;height:14px;"></i></button><button class="btn btn-secondary btn-icon-only btn-download-file" data-name="${item.name}" title="Download file"><i data-lucide="download" style="width:14px;height:14px;"></i></button>`;
      
    tr.innerHTML = `
      <td class="col-name">
        <div class="fb-item-name-wrapper">
          <i data-lucide="${icon}" class="${iconClass}" style="width:16px;height:16px;"></i>
          ${nameHtml}
        </div>
      </td>
      <td class="col-size">${sizeText}</td>
      <td class="col-mtime">${dateText}</td>
      <td class="col-actions">${actionHtml}</td>
    `;
    
    // Click handler for folders
    if (item.isDir) {
      const link = tr.querySelector('.fb-folder-link');
      link.addEventListener('click', () => {
        const currentPath = agentPaths[selectedAgentId] || '.';
        const sep = currentPath.includes('\\') ? '\\' : '/';
        let newPath = currentPath;
        
        // Clean trailing slash
        if (newPath.endsWith(sep)) {
          newPath = newPath.slice(0, -1);
        }
        newPath = newPath + sep + item.name;
        fetchDirectoryContents(newPath);
      });
    } else {
      const dlBtn = tr.querySelector('.btn-download-file');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => {
          const currentPath = agentPaths[selectedAgentId] || '.';
          const sep = currentPath.includes('\\') ? '\\' : '/';
          let filePath = currentPath;
          if (filePath.endsWith(sep)) {
            filePath = filePath.slice(0, -1);
          }
          filePath = filePath + sep + item.name;
          
          showFbLoading(true);
          socket.emit('file-browse-download', { agentId: selectedAgentId, path: filePath });
        });
      }
      
      const previewBtn = tr.querySelector('.btn-preview-file');
      if (previewBtn) {
        previewBtn.addEventListener('click', () => {
          const currentPath = agentPaths[selectedAgentId] || '.';
          const sep = currentPath.includes('\\') ? '\\' : '/';
          let filePath = currentPath;
          if (filePath.endsWith(sep)) {
            filePath = filePath.slice(0, -1);
          }
          filePath = filePath + sep + item.name;
          
          previewTargetFilePath = filePath;
          showFbLoading(true);
          socket.emit('file-browse-download', { agentId: selectedAgentId, path: filePath });
        });
      }
    }
    
    fbFilesBody.appendChild(tr);
  });
  
  lucide.createIcons();
}

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
const settingsPort = document.getElementById('settings-port');

async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    settingsServerUrl.value = config.serverUrl || '';
    settingsSecretToken.value = config.secretToken || '';
    settingsPort.value = config.port || 3000;
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
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: settingsServerUrl.value.trim(),
        secretToken: settingsSecretToken.value.trim(),
        port: parseInt(settingsPort.value, 10) || 3000
      })
    });

    const result = await res.json();
    if (result.status === 'success') {
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

