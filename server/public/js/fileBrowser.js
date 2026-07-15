import { socket } from './socket.js';
import { state } from './state.js';
import { editor } from './editor.js';
import { getFileIcon, setEditorMode, formatBytes, base64ToBlob } from './utils.js';

// DOM Elements
const tabBtnFiles = document.getElementById('tab-btn-files');
const tabBtnDocker = document.getElementById('tab-btn-docker');
const dockerContainersBody = document.getElementById('docker-containers-body');
const dockerLoading = document.getElementById('docker-loading');
const dockerEmptyState = document.getElementById('docker-empty-state');
const dockerStatusText = document.getElementById('docker-status-text');

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

const previewModal = document.getElementById('preview-modal');
const btnClosePreview = document.getElementById('btn-close-preview');
const previewFilename = document.getElementById('preview-filename');
const previewContent = document.getElementById('preview-content');
const previewToggleContainer = document.getElementById('preview-toggle-container');
const btnPreviewModeCode = document.getElementById('btn-preview-mode-code');
const btnPreviewModeRender = document.getElementById('btn-preview-mode-render');
const previewContentHtml = document.getElementById('preview-content-html');

let previewTargetFilePath = null;
let previewRawContent = "";

// Actions
export function fetchDockerContainers() {
  if (!state.selectedAgentId) return;
  const agent = state.agentsList.find(a => a.id === state.selectedAgentId);
  if (!agent || agent.docker !== 'connected') return;

  showDockerLoading(true);
  dockerContainersBody.innerHTML = '';
  dockerEmptyState.classList.add('hidden');
  
  socket.emit('docker-list', { agentId: state.selectedAgentId });
}

export function renderDockerList(containers) {
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
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

export function showDockerLoading(show) {
  if (show) {
    dockerLoading.classList.remove('hidden');
  } else {
    dockerLoading.classList.add('hidden');
  }
}

export function fetchDirectoryContents(path) {
  if (!state.selectedAgentId) return;
  showFbLoading(true);
  socket.emit('file-browse-list', { agentId: state.selectedAgentId, path: path });
}

export function showFbLoading(show) {
  if (show) {
    fbLoading.classList.remove('hidden');
  } else {
    fbLoading.classList.add('hidden');
  }
}

export function renderFileList(items) {
  fbFilesBody.innerHTML = '';
  fbGridView.innerHTML = '';
  
  if (!items || items.length === 0) {
    fbEmptyState.classList.remove('hidden');
    return;
  }
  
  fbEmptyState.classList.add('hidden');
  
  // Update view toggle icon
  fbViewIcon.setAttribute('data-lucide', state.fbViewMode === 'list' ? 'layout-grid' : 'list');
  if (state.fbViewMode === 'list') {
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

    if (state.fbViewMode === 'list') {
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
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function navigateToFolder(folderName) {
  const currentPath = state.agentPaths[state.selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let newPath = currentPath;
  if (newPath.endsWith(sep)) newPath = newPath.slice(0, -1);
  newPath = newPath + sep + folderName;
  fetchDirectoryContents(newPath);
}

function downloadFile(filename) {
  if (!state.selectedAgentId) return;
  const currentPath = state.agentPaths[state.selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  
  const downloadUrl = `/api/download/stream?agentId=${state.selectedAgentId}&path=${encodeURIComponent(filePath)}`;
  window.open(downloadUrl, '_blank');
}

function previewFile(filename, size) {
  const PREVIEW_LIMIT = 2 * 1024 * 1024;
  if (size > PREVIEW_LIMIT) {
    alert(`File is too large to preview (${formatBytes(size)}). Please use the Download button instead.`);
    return;
  }

  const currentPath = state.agentPaths[state.selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  previewTargetFilePath = filePath;
  showFbLoading(true);
  socket.emit('file-browse-download', { agentId: state.selectedAgentId, path: filePath });
}

function loadThumbnail(filename) {
  const currentPath = state.agentPaths[state.selectedAgentId] || '.';
  const sep = currentPath.includes('\\') ? '\\' : '/';
  let filePath = currentPath;
  if (filePath.endsWith(sep)) filePath = filePath.slice(0, -1);
  filePath = filePath + sep + filename;
  
  socket.emit('file-browse-download', { agentId: state.selectedAgentId, path: filePath, isThumbnail: true });
}

export function renderBreadcrumbs(path) {
  fbBreadcrumbs.innerHTML = '';
  fbBreadcrumbs.classList.remove('hidden');
  fbPathInput.classList.add('hidden');
  
  if (!path) return;
  
  const isWindows = path.includes('\\') || /^[a-zA-Z]:/.test(path);
  const sep = isWindows ? '\\' : '/';
  
  let parts = path.split(sep).filter(p => p !== '');
  let currentAccumulatedPath = '';
  
  if (path.startsWith('/') && !isWindows) {
    const rootItem = createBreadcrumbItem('/', '/');
    fbBreadcrumbs.appendChild(rootItem);
    currentAccumulatedPath = '/';
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

// Socket response callbacks called by app.js orchestration
export function handleFileBrowseResponse(response) {
  showFbLoading(false);
  if (response.status === 'success') {
    state.agentPaths[state.selectedAgentId] = response.path;
    fbPathInput.value = response.path;
    renderBreadcrumbs(response.path);
    renderFileList(response.items);
  } else {
    alert(`Error: ${response.message || 'Failed to list directory'}`);
  }
}

export function handleDockerListResponse(response) {
  showDockerLoading(false);
  if (response.status === 'success') {
    renderDockerList(response.containers);
  } else {
    alert(`Error: ${response.message || 'Failed to list Docker containers'}`);
  }
}

export function handleFileBrowseDownloadResponse(response) {
  showFbLoading(false);
  if (response.status === 'success') {
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
      setEditorMode(editor, response.name);
      editor.setValue(decoded);
      editor.clearSelection();
      editor.gotoLine(1);
      
      const isMd = response.name.endsWith('.md') || response.name.endsWith('.markdown');
      if (isMd) {
        previewToggleContainer.classList.remove('hidden');
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
      
      setTimeout(() => {
        editor.resize();
        editor.renderer.updateFull();
      }, 100);
    } else {
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
    if (!document.getElementById(`thumb-${response.name?.replace(/[^a-zA-Z0-9]/g, '-')}`)) {
        alert(`Error: ${response.message || 'Failed to process file'}`);
    }
  }
}

// Event Listeners for File Browser UI
if (fbBtnRefresh) {
  fbBtnRefresh.addEventListener('click', () => {
    const currentPath = state.agentPaths[state.selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  });
}

if (fbBtnHome) {
  fbBtnHome.addEventListener('click', () => {
    fetchDirectoryContents('~');
  });
}

if (fbBtnGo) {
  fbBtnGo.addEventListener('click', () => {
    const path = fbPathInput.value.trim();
    if (path) {
      fetchDirectoryContents(path);
    }
  });
}

if (fbPathInput) {
  fbPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const path = fbPathInput.value.trim();
      if (path) {
        fetchDirectoryContents(path);
      }
    }
  });
}

if (fbBtnViewToggle) {
  fbBtnViewToggle.addEventListener('click', () => {
    state.fbViewMode = state.fbViewMode === 'list' ? 'grid' : 'list';
    localStorage.setItem('fbViewMode', state.fbViewMode);
    
    const currentPath = state.agentPaths[state.selectedAgentId] || '.';
    fetchDirectoryContents(currentPath);
  });
}

if (fbBtnUp) {
  fbBtnUp.addEventListener('click', () => {
    const currentPath = state.agentPaths[state.selectedAgentId] || '.';
    const sep = currentPath.includes('\\') ? '\\' : '/';
    
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
}

if (btnPreviewModeCode) {
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
}

if (btnPreviewModeRender) {
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
}

if (btnClosePreview) {
  btnClosePreview.addEventListener('click', () => {
    previewModal.classList.add('hidden');
    editor.setValue('');
    previewContentHtml.innerHTML = '';
    previewRawContent = '';
    previewFilename.textContent = '';
  });
}

if (fbPathContainer) {
  fbPathContainer.addEventListener('click', () => {
    fbBreadcrumbs.classList.add('hidden');
    fbPathInput.classList.remove('hidden');
    fbPathInput.focus();
    fbPathInput.select();
  });
}

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
        fbPathInput.value = state.agentPaths[state.selectedAgentId];
    }
  });
}
