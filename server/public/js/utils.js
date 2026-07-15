import { state } from './state.js';

// Color generation helpers for custom theme picker
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function adjustColorBrightness(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, Math.max(0, rgb.r + (percent * 2.55)));
  const g = Math.min(255, Math.max(0, rgb.g + (percent * 2.55)));
  const b = Math.min(255, Math.max(0, rgb.b + (percent * 2.55)));
  return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
}

export function hexToRgbaStr(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// File icon mapping
export function getFileIcon(filename, isDir) {
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

// Ace editor mode detection
export function setEditorMode(editor, filename) {
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

// Helper to play notification sound
export function playNotificationSound(type = 'connect') {
  if (!state.dashboardSettings.soundEnabled) return;
  
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

// Base64 helper
export function base64ToBlob(base64, contentType = '') {
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

// Bytes formatting helper
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ANSI to HTML helper
export function ansiToHtml(text) {
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

// API fetch helper
export async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }
  return response;
}
