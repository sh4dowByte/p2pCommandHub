// App State
export const state = {
  agentsList: [],
  selectedAgentId: null,
  currentCommandId: null,
  broadcastCommandIds: {}, // agentId -> commandId for active broadcast
  commandOutputs: {}, // commandId -> string buffer of outputs
  activeTab: 'terminal', // 'terminal' | 'files'
  agentPaths: {}, // agentId -> current path string
  currentTheme: localStorage.getItem('theme') || 'dark', // 'dark' | 'light'
  fbViewMode: localStorage.getItem('fbViewMode') || 'list', // 'list' | 'grid'

  // Terminal History
  commandHistory: JSON.parse(localStorage.getItem('commandHistory') || '[]'),
  historyIndex: -1,

  // New Dashboard Settings (Client-side)
  dashboardSettings: {
    theme: localStorage.getItem('theme') || 'dark',
    terminalFontSize: localStorage.getItem('terminalFontSize') || '14',
    terminalFontFamily: localStorage.getItem('terminalFontFamily') || "'Fira Code', monospace",
    terminalOpacity: localStorage.getItem('terminalOpacity') || '1',
    soundEnabled: localStorage.getItem('soundEnabled') === 'true',
    autoClear: localStorage.getItem('autoClear') === 'true',
    historyLimit: localStorage.getItem('historyLimit') || '100'
  }
};
