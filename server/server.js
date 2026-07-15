const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');

// Load configurations
let CONFIG = {
  secret_token: "p2p_secure_agent_token_2026",
  server_url: "",
  dashboard_password: "admin" // Default password
};

try {
  const configFile = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8');
  const fileConfig = JSON.parse(configFile);
  CONFIG = { ...CONFIG, ...fileConfig };
} catch (err) {
  console.warn('Could not read config.json, using defaults:', err.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const sessionMiddleware = session({
  secret: 'p2p-hub-secret-key-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
// Session middleware is already applied above for both app and io

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path === '/' || req.path === '/login' || req.path === '/api/login' || req.path.startsWith('/install-') || req.path.startsWith('/api/agent/')) {
    return next();
  }
  if (req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.png') || req.path.endsWith('.jpg') || req.path.endsWith('.svg') || req.path.endsWith('.ico')) {
    return next();
  }
  
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  } else {
    const reactIndex = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    if (fs.existsSync(reactIndex)) {
      return res.sendFile(reactIndex);
    }
    return res.redirect('/login');
  }
};

app.use(isAuthenticated);

const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  const reactIndex = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (fs.existsSync(reactIndex)) {
    return res.sendFile(reactIndex);
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/install-')) {
    return next();
  }
  const reactIndex = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (fs.existsSync(reactIndex)) {
    return res.sendFile(reactIndex);
  }
  next();
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.dashboard_password) {
    req.session.authenticated = true;
    return res.json({ status: 'success' });
  }
  return res.status(401).json({ status: 'error', message: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ status: 'success' });
});

// Memory-based tracking
const agents = new Map(); // id -> agent data
const bashCommandQueues = new Map(); // agentId -> array of { commandId, cmd }
const activeCommands = new Map(); // commandId -> { agentId, dashboardSockets: Set }
const pendingFileBrowse = new Map(); // commandId -> { socketId, type, path, chunks: [] }
const pendingDockerList = new Map(); // commandId -> { socketId, chunks: [] }
const activeDownloadStreams = new Map(); // commandId -> express response object
const downloadBuffers = new Map(); // commandId -> Buffer

// Helper to cleanup stale poll-based agents (Bash/PowerShell) — no poll in 15 seconds
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, agent] of agents.entries()) {
    if ((agent.type === 'bash' || agent.type === 'powershell') && agent.status === 'online' && now - agent.lastSeen > 15000) {
      agent.status = 'offline';
      changed = true;
      console.log(`${agent.type} agent offline (timeout): ${agent.hostname} (${id})`);
    }
  }
  if (changed) {
    broadcastAgents();
  }
}, 5000);

// Helper to broadcast agent list to all dashboards
function broadcastAgents() {
  const agentList = Array.from(agents.values()).map(a => ({
    id: a.id,
    hostname: a.hostname,
    platform: a.platform,
    ip: a.ip,
    type: a.type,
    status: a.status,
    metrics: a.metrics,
    docker: a.docker,
    lastSeen: a.lastSeen
  }));
  io.to('dashboard').emit('agents-update', agentList);
}

// ----------------------------------------------------
// Dynamic Agent Installer Scripts
// ----------------------------------------------------
app.get('/install-bash', (req, res) => {
  const hostUrl = CONFIG.server_url || (req.protocol + '://' + req.get('host'));
  try {
    let script = fs.readFileSync(path.join(__dirname, '..', 'agents', 'bash', 'agent.sh'), 'utf8');
    script = script.replace(/SERVER_URL="http:\/\/localhost:3000"/g, `SERVER_URL="${hostUrl}"`);
    script = script.replace(/SECRET_TOKEN="p2p_secure_agent_token_2026"/g, `SECRET_TOKEN="${CONFIG.secret_token}"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(script);
  } catch (err) {
    console.error('Error serving install-bash:', err);
    return res.status(500).send('Error generating installer script: ' + err.message);
  }
});

app.get('/install-python', (req, res) => {
  const hostUrl = CONFIG.server_url || (req.protocol + '://' + req.get('host'));
  try {
    let script = fs.readFileSync(path.join(__dirname, '..', 'agents', 'python', 'agent.py'), 'utf8');
    script = script.replace(/SERVER_URL = "http:\/\/localhost:3000"/g, `SERVER_URL = "${hostUrl}"`);
    script = script.replace(/SECRET_TOKEN = "p2p_secure_agent_token_2026"/g, `SECRET_TOKEN = "${CONFIG.secret_token}"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(script);
  } catch (err) {
    console.error('Error serving install-python:', err);
    return res.status(500).send('Error generating installer script: ' + err.message);
  }
});

app.get('/install-powershell', (req, res) => {
  const hostUrl = CONFIG.server_url || (req.protocol + '://' + req.get('host'));
  try {
    let script = fs.readFileSync(path.join(__dirname, '..', 'agents', 'powershell', 'agent.ps1'), 'utf8');
    script = script.replace(/\$SERVER_URL = "http:\/\/localhost:3000"/g, `\$SERVER_URL = "${hostUrl}"`);
    script = script.replace(/\$SECRET_TOKEN = "p2p_secure_agent_token_2026"/g, `\$SECRET_TOKEN = "${CONFIG.secret_token}"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(script);
  } catch (err) {
    console.error('Error serving install-powershell:', err);
    return res.status(500).send('Error generating installer script: ' + err.message);
  }
});

// ----------------------------------------------------
// Bash / PowerShell Agent HTTP API
// ----------------------------------------------------
app.get('/api/agent/poll', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (token !== CONFIG.secret_token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let { id, hostname, platform, ip, cpu, ram, docker, agenttype } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing client id' });
  }
  id = id.trim();

  // Detect agent type from id prefix or explicit agenttype param
  const detectedType = agenttype || (id.startsWith('ps_') ? 'powershell' : 'bash');

  // Register or update poll-based agent status
  const isNew = !agents.has(id);
  const existingAgent = agents.get(id);
  const activeCommandId = existingAgent ? existingAgent.activeCommandId : null;

  agents.set(id, {
    id,
    hostname: hostname || (detectedType === 'powershell' ? 'Unknown-Windows' : 'Unknown-Bash'),
    platform: platform || (detectedType === 'powershell' ? 'Windows' : 'linux'),
    ip: ip || req.ip,
    type: detectedType,
    status: 'online',
    lastSeen: Date.now(),
    metrics: {
      cpu: parseFloat(cpu) || 0,
      ram: parseFloat(ram) || 0
    },
    docker: docker || 'none',
    activeCommandId
  });

  if (isNew) {
    console.log(`New ${detectedType} agent connected: ${hostname} (${id})`);  
  }

  if (isNew || agents.get(id).status === 'offline') {
    agents.get(id).status = 'online';
    broadcastAgents();
  } else {
    // Only broadcast updates occasionally, or every poll to keep metrics live
    agents.get(id).lastSeen = Date.now();
    broadcastAgents();
  }

  // Get next command in queue
  const queue = bashCommandQueues.get(id) || [];
  if (queue.length > 0) {
    const nextCmd = queue.shift();
    bashCommandQueues.set(id, queue);
    return res.json(nextCmd);
  }

  return res.json({ commandId: null });
});

app.post('/api/agent/response', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.body.token;
  if (token !== CONFIG.secret_token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let { id, commandId, output, exitCode, isEof } = req.body;
  if (!id || !commandId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  id = id.trim();

  const eof = isEof !== undefined ? (isEof === 'true' || isEof === true) : true;

  if (eof) {
    console.log(`Bash agent (${id}) completed command (${commandId}) with code ${exitCode}`);
    const agent = agents.get(id);
    if (agent && agent.activeCommandId === commandId) {
      agent.activeCommandId = null;
    }
  }

  // Intercept file browsing commands
  const isFb = pendingFileBrowse.has(commandId);
  const isDocker = pendingDockerList.has(commandId);
  const isStream = activeDownloadStreams.has(commandId);

  if (isFb) {
    const pending = pendingFileBrowse.get(commandId);
    if (output) {
      pending.chunks.push(output);
    }

    if (eof) {
      pendingFileBrowse.delete(commandId);
      const fullOutput = pending.chunks.join('');
      const dashSocket = io.sockets.sockets.get(pending.socketId);
      const parsedExitCode = exitCode !== undefined ? parseInt(exitCode, 10) : 0;

      if (dashSocket) {
        if (pending.type === 'list') {
          const lines = fullOutput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length === 0 && parsedExitCode !== 0) {
            dashSocket.emit('file-browse-response', {
              status: 'error',
              message: `Failed to list directory (Exit code: ${parsedExitCode})`,
              path: pending.path
            });
          } else {
            let resolvedPath = pending.path || '.';
            let startIndex = 0;
            if (lines.length > 0 && lines[0].startsWith('/')) {
              resolvedPath = lines[0];
              startIndex = 1;
            }
            if (lines.length > 1 && lines[1].startsWith('/')) {
              resolvedPath = lines[1];
              startIndex = 2;
            }

            const items = [];
            for (let i = startIndex; i < lines.length; i++) {
              const parts = lines[i].split('|');
              if (parts.length >= 4) {
                const type = parts[0];
                const name = parts[1];
                const size = parseInt(parts[2], 10) || 0;
                const mtime = parseInt(parts[3], 10) || 0;
                items.push({
                  name,
                  isDir: type === 'd',
                  size,
                  mtime: mtime * 1000 // Convert Unix timestamp to ms
                });
              }
            }
            dashSocket.emit('file-browse-response', {
              status: 'success',
              path: resolvedPath,
              items,
              sep: '/'
            });
          }
        } else if (pending.type === 'download') {
          if (parsedExitCode !== 0) {
            dashSocket.emit('file-browse-download-response', {
              status: 'error',
              message: `Failed to read file (Exit code: ${parsedExitCode})`,
              path: pending.path
            });
          } else {
            const cleanContent = fullOutput.replace(/[\r\n]/g, '');
            const filename = pending.path.split('/').pop() || 'download';
            dashSocket.emit('file-browse-download-response', {
              status: 'success',
              name: filename,
              content: cleanContent,
              encoding: 'base64',
              path: pending.path
            });
          }
        }
      }
    }
    return res.json({ status: 'ok' });
  }


  if (isDocker) {
    const pending = pendingDockerList.get(commandId);
    if (output) {
      pending.chunks.push(output);
    }

    if (eof) {
      pendingDockerList.delete(commandId);
      const fullOutput = pending.chunks.join('');
      const dashSocket = io.sockets.sockets.get(pending.socketId);
      const parsedExitCode = exitCode !== undefined ? parseInt(exitCode, 10) : 0;

      if (dashSocket) {
        if (parsedExitCode !== 0) {
          dashSocket.emit('docker-list-response', {
            status: 'error',
            message: `Failed to list Docker containers (Exit code: ${parsedExitCode})`
          });
        } else {
          const lines = fullOutput.split('\n').filter(l => l.trim().length > 0);
          const containers = lines.map(line => {
            const parts = line.split('|');
            return {
              id: parts[0],
              name: parts[1],
              status: parts[2],
              image: parts[3]
            };
          });
          dashSocket.emit('docker-list-response', {
            status: 'success',
            containers
          });
        }
      }
    }
    return res.json({ status: 'ok' });
  }

  if (isStream) {
    const streamRes = activeDownloadStreams.get(commandId);
    if (output) {
      try {
        let bufferStr = (downloadBuffers.get(commandId) || '') + output.replace(/[\r\n\s]/g, '');
        const validLength = Math.floor(bufferStr.length / 4) * 4;
        
        if (validLength > 0) {
          const toDecode = bufferStr.substring(0, validLength);
          streamRes.write(Buffer.from(toDecode, 'base64'));
          downloadBuffers.set(commandId, bufferStr.substring(validLength));
        } else {
          downloadBuffers.set(commandId, bufferStr);
        }
      } catch (e) {
        console.error('Error writing chunk to stream:', e);
      }
    }

    if (eof) {
      const remaining = downloadBuffers.get(commandId);
      if (remaining && remaining.length > 0) {
        try {
          streamRes.write(Buffer.from(remaining, 'base64'));
        } catch (e) {}
      }
      activeDownloadStreams.delete(commandId);
      downloadBuffers.delete(commandId);
      streamRes.end();
    }
    return res.json({ status: 'ok' });
  }

  // Stream output chunk to dashboards
  io.to('dashboard').emit('command-output', {
    commandId,
    output: output || '',
    isEof: eof,
    exitCode: exitCode !== undefined ? parseInt(exitCode, 10) : 0
  });

  return res.json({ status: 'ok' });
});

// Get configuration settings
app.get('/api/config', (req, res) => {
  return res.json({
    serverUrl: CONFIG.server_url || '',
    secretToken: CONFIG.secret_token || '',
    hasPassword: !!CONFIG.dashboard_password
  });
});

// Update configuration settings
app.post('/api/config', (req, res) => {
  const { serverUrl, secretToken, dashboardPassword } = req.body;
  
  if (serverUrl !== undefined) CONFIG.server_url = serverUrl.trim();
  if (secretToken !== undefined) CONFIG.secret_token = secretToken.trim();
  if (dashboardPassword !== undefined && dashboardPassword.trim() !== "") {
    CONFIG.dashboard_password = dashboardPassword.trim();
  }
  
  const configToSave = {
    secret_token: CONFIG.secret_token,
    server_url: CONFIG.server_url,
    dashboard_password: CONFIG.dashboard_password
  };
  
  try {
    fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(configToSave, null, 2), 'utf8');
    console.log('Server configuration updated:', configToSave);
    return res.json({ status: 'success', message: 'Configuration saved successfully.' });
  } catch (err) {
    console.error('Failed to save config:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to write config.json file.' });
  }
});

// Streaming Download Endpoint
app.get('/api/download/stream', (req, res) => {
  const { agentId, path: filePath } = req.query;
  const agent = agents.get(agentId);
  
  if (!agent || agent.status !== 'online') {
    return res.status(404).send('Agent offline or not found.');
  }

  const filename = filePath.split('/').pop() || 'download';
  res.setHeader('Content-disposition', 'attachment; filename=' + filename);
  res.setHeader('Content-type', 'application/octet-stream');

  const commandId = 'stream_dl_' + Math.random().toString(36).substring(2, 11);
  activeDownloadStreams.set(commandId, res);

  // Tell agent to start streaming
  const escapedPath = filePath.replace(/"/g, '\\"');
  // Bash command to output base64 chunks line by line
  const cmd = `if [ ! -f "${escapedPath}" ]; then exit 1; fi; (if command -v base64 >/dev/null 2>&1; then base64 "${escapedPath}"; elif command -v openssl >/dev/null 2>&1; then openssl base64 -in "${escapedPath}"; elif command -v python3 >/dev/null 2>&1; then python3 -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()).decode())' "${escapedPath}"; elif command -v python >/dev/null 2>&1; then python -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()))' "${escapedPath}"; else echo "No base64 encoder found" >&2; exit 127; fi) | tr -d '\\r\\n' | fold -w 45000`;

  if (agent.type === 'python') {
    const pythonCmd = `__STREAM_FILE__:${filePath}`;
    const agentSocketId = agent.socketId || agentId;
    io.to(agentSocketId).emit('run-command', { cmd: pythonCmd, commandId });
  } else if (agent.type === 'bash') {
    if (!bashCommandQueues.has(agentId)) {
      bashCommandQueues.set(agentId, []);
    }
    bashCommandQueues.get(agentId).push({ commandId, cmd });
  }

  // Handle client disconnect
  req.on('close', () => {
    activeDownloadStreams.delete(commandId);
    // Optionally tell agent to kill the command
  });
});

// ----------------------------------------------------
// Socket.io for Python Agent & Web UI
// ----------------------------------------------------
io.on('connection', (socket) => {
  const { role, token } = socket.handshake.auth;

  if (role === 'dashboard') {
    // Check session authentication for dashboard role
    const session = socket.request.session;
    if (!session || !session.authenticated) {
      console.warn(`Unauthorized dashboard socket connection attempt from ${socket.id}`);
      socket.disconnect(true);
      return;
    }
    
    // Dashboard client joins dashboard room
    socket.join('dashboard');
    // Send list of current agents
    broadcastAgents();

    // Handle File Browsing requests
    socket.on('file-browse-list', ({ agentId, path }) => {
      const agent = agents.get(agentId);
      if (!agent || agent.status !== 'online') {
        socket.emit('file-browse-response', { status: 'error', message: 'Agent is offline or does not exist.' });
        return;
      }

      if (agent.type === 'python') {
        const agentSocketId = agent.socketId || agentId;
        const agentSocket = io.sockets.sockets.get(agentSocketId);
        if (agentSocket) {
          agentSocket.emit('file-browse-list', { path }, (response) => {
            socket.emit('file-browse-response', response);
          });
        } else {
          socket.emit('file-browse-response', { status: 'error', message: 'Agent socket not found.' });
        }
      } else if (agent.type === 'bash') {
        const commandId = 'fb_list_' + Math.random().toString(36).substring(2, 11);
        pendingFileBrowse.set(commandId, { socketId: socket.id, type: 'list', path, chunks: [] });
        
        agent.activeCommandId = commandId;
        
        // Construct compatible bash command for folder listing
        const escapedPath = path ? path.replace(/"/g, '\\"') : '.';
        const cmd = `pwd && cd "${escapedPath}" 2>/dev/null && pwd && for f in * .* ; do [ "$f" = "." ] || [ "$f" = ".." ] && continue; [ -e "$f" ] || [ -L "$f" ] || continue; if [ -d "$f" ]; then echo "d|$f|0|0"; else echo "f|$f|$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)|$(stat -c%Y "$f" 2>/dev/null || stat -f%m "$f" 2>/dev/null || echo 0)"; fi; done`;

        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      } else if (agent.type === 'powershell') {
        const commandId = 'fb_list_' + Math.random().toString(36).substring(2, 11);
        pendingFileBrowse.set(commandId, { socketId: socket.id, type: 'list', path, chunks: [], sep: '\\' });

        agent.activeCommandId = commandId;

        // PowerShell command for folder listing
        const psPath = (path || '.').replace(/'/g, "''");
        const cmd = `powershell -NoProfile -Command "$p = '${psPath}'; Write-Output $p; Get-ChildItem -Force -LiteralPath $p | ForEach-Object { $type = if ($_.PSIsContainer) { 'd' } else { 'f' }; $size = if ($_.PSIsContainer) { 0 } else { $_.Length }; $mtime = [int][double]::Parse(($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalSeconds.ToString('F0')); Write-Output ($type + '|' + $_.Name + '|' + $size + '|' + $mtime) }"`;

        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      }
    });

    socket.on('file-browse-download', ({ agentId, path }) => {
      const agent = agents.get(agentId);
      if (!agent || agent.status !== 'online') {
        socket.emit('file-browse-download-response', { status: 'error', message: 'Agent is offline or does not exist.' });
        return;
      }

      if (agent.type === 'python') {
        const agentSocketId = agent.socketId || agentId;
        const agentSocket = io.sockets.sockets.get(agentSocketId);
        if (agentSocket) {
          agentSocket.emit('file-browse-read', { path }, (response) => {
            if (response) {
              response.path = path;
            }
            socket.emit('file-browse-download-response', response);
          });
        } else {
          socket.emit('file-browse-download-response', { status: 'error', message: 'Agent socket not found.', path });
        }
      } else if (agent.type === 'bash') {
        const commandId = 'fb_dl_' + Math.random().toString(36).substring(2, 11);
        pendingFileBrowse.set(commandId, { socketId: socket.id, type: 'download', path, chunks: [] });

        agent.activeCommandId = commandId;

        const escapedPath = path.replace(/"/g, '\\"');
        const cmd = `FILE_SIZE=$(stat -c%s "${escapedPath}" 2>/dev/null || stat -f%z "${escapedPath}" 2>/dev/null || echo 0); if [ "$FILE_SIZE" -gt 52428800 ]; then echo "Error: File too large (Max 50MB)" >&2; exit 1; fi; (if command -v base64 >/dev/null 2>&1; then base64 "${escapedPath}"; elif command -v openssl >/dev/null 2>&1; then openssl base64 -in "${escapedPath}"; elif command -v python3 >/dev/null 2>&1; then python3 -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()).decode())' "${escapedPath}"; elif command -v python >/dev/null 2>&1; then python -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()))' "${escapedPath}"; else echo "No base64 encoder found" >&2; exit 127; fi) | tr -d '\\r\\n' | fold -w 45000`;

        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      } else if (agent.type === 'powershell') {
        const commandId = 'fb_dl_' + Math.random().toString(36).substring(2, 11);
        pendingFileBrowse.set(commandId, { socketId: socket.id, type: 'download', path, chunks: [] });

        agent.activeCommandId = commandId;

        const psPath = path.replace(/'/g, "''");
        const cmd = `powershell -NoProfile -Command "$f='${psPath}'; $b=[System.IO.File]::ReadAllBytes($f); if($b.Length -gt 52428800){Write-Error 'File too large';exit 1}; $enc=[Convert]::ToBase64String($b); $i=0; while($i -lt $enc.Length){Write-Output $enc.Substring($i,[Math]::Min(45000,$enc.Length-$i)); $i+=45000}"`;

        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      }
    });

    socket.on('docker-list', ({ agentId }) => {
      const agent = agents.get(agentId);
      if (!agent || agent.status !== 'online') {
        socket.emit('docker-list-response', { status: 'error', message: 'Agent is offline or does not exist.' });
        return;
      }

      const commandId = 'docker_list_' + Math.random().toString(36).substring(2, 11);
      pendingDockerList.set(commandId, { socketId: socket.id, chunks: [] });

      const cmd = `docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}"`;
      
      agent.activeCommandId = commandId;

      if (agent.type === 'python') {
        const agentSocketId = agent.socketId || agentId;
        const agentSocket = io.sockets.sockets.get(agentSocketId);
        if (agentSocket) {
          agentSocket.emit('run-command', { cmd, commandId });
        } else {
          socket.emit('command-error', { error: 'Agent socket not found.' });
        }
      } else if (agent.type === 'bash') {
        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      }
    });

    // Handle command execution requests from dashboard
    socket.on('execute-command', ({ agentId, cmd }) => {
      const agent = agents.get(agentId);
      if (!agent || agent.status !== 'online') {
        socket.emit('command-error', { error: 'Agent is offline or does not exist.' });
        return;
      }

      const commandId = 'cmd_' + Math.random().toString(36).substring(2, 11);
      console.log(`Queueing command ${commandId} ("${cmd}") for agent ${agentId} (${agent.type})`);

      agent.activeCommandId = commandId;

      if (agent.type === 'python') {
        // Send command instantly to Python agent socket
        const agentSocketId = agent.socketId || agentId;
        io.to(agentSocketId).emit('run-command', { cmd, commandId });
      } else if (agent.type === 'bash' || agent.type === 'powershell') {
        // Queue command for next HTTP poll
        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        bashCommandQueues.get(agentId).push({ commandId, cmd });
      }

      // Notify dashboard client command was sent
      socket.emit('command-started', { commandId, agentId, cmd });
    });

    // Handle command cancellation requests from dashboard
    socket.on('kill-command', ({ agentId }) => {
      const agent = agents.get(agentId);
      if (!agent || !agent.activeCommandId) return;

      console.log(`Killing command ${agent.activeCommandId} for agent ${agentId}`);

      if (agent.type === 'python') {
        // Send cancel event to python client socket
        const agentSocketId = agent.socketId || agentId;
        io.to(agentSocketId).emit('kill-command', { commandId: agent.activeCommandId });
      } else if (agent.type === 'bash' || agent.type === 'powershell') {
        // Queue a special 'kill' action for the next HTTP poll
        if (!bashCommandQueues.has(agentId)) {
          bashCommandQueues.set(agentId, []);
        }
        // Unshift so it is processed immediately, bypassing normal commands
        bashCommandQueues.get(agentId).unshift({
          commandId: agent.activeCommandId,
          action: 'kill'
        });
      }
    });

    return;
  }

  // Socket client authentication (Python agent)
  if (token !== CONFIG.secret_token) {
    console.warn(`Unauthorized socket connection attempt from ${socket.id}`);
    socket.disconnect(true);
    return;
  }

  // It's a validated agent
  let agentId = socket.id;

  socket.on('register', (metadata) => {
    // Register agent using persistent ID if provided
    const persistentId = (metadata.id || socket.id).trim();
    
    console.log(`[DEBUG] Agent registration attempt. Provided ID: ${metadata.id}, Socket ID: ${socket.id}`);

    // If an agent with this ID already exists, preserve its properties but update the socket
    const existingAgent = agents.get(persistentId);
    if (existingAgent) {
      console.log(`[DEBUG] Updating existing agent session for ${persistentId}`);
      existingAgent.socketId = socket.id;
      existingAgent.status = 'online';
      existingAgent.lastSeen = Date.now();
      // Keep old hostname/platform if not provided
      if (metadata.hostname) existingAgent.hostname = metadata.hostname;
      agentId = persistentId;
    } else {
      console.log(`[DEBUG] Creating new agent session for ${persistentId}`);
      agentId = persistentId;
      agents.set(persistentId, {
        id: persistentId,
        socketId: socket.id,
        hostname: metadata.hostname || 'Unknown-Python',
        platform: metadata.platform || 'unknown',
        ip: metadata.ip || socket.handshake.address || '127.0.0.1',
        type: 'python',
        status: 'online',
        lastSeen: Date.now(),
        metrics: {
          cpu: metadata.cpu || 0,
          ram: metadata.ram || 0
        },
        docker: metadata.docker || 'none'
      });
    }

    console.log(`Python agent registered: ${agents.get(persistentId).hostname} (${persistentId}) [Socket: ${socket.id}]`);
    broadcastAgents();
  });

  socket.on('metrics-update', (metrics) => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.metrics = {
        cpu: metrics.cpu || 0,
        ram: metrics.ram || 0
      };
      if (metrics.docker) {
        agent.docker = metrics.docker;
      }
      agent.lastSeen = Date.now();
      broadcastAgents();
    }
  });

  // Real-time output stream from Python agent
  socket.on('command-output', (data) => {
    const { commandId, output, isEof, exitCode } = data;

    // Check if this is an active download stream
    if (activeDownloadStreams.has(commandId)) {
      const streamRes = activeDownloadStreams.get(commandId);
      if (output) {
        try {
          const cleanOutput = output.replace(/[\r\n\s]/g, '');
          if (cleanOutput.length === 0) return;

          let bufferStr = (downloadBuffers.get(commandId) || '') + cleanOutput;
          const validLength = Math.floor(bufferStr.length / 4) * 4;
          
          if (validLength > 0) {
            const toDecode = bufferStr.substring(0, validLength);
            const decodedBuffer = Buffer.from(toDecode, 'base64');
            console.log(`[DEBUG] Writing ${decodedBuffer.length} bytes to stream (Command: ${commandId})`);
            streamRes.write(decodedBuffer);
            downloadBuffers.set(commandId, bufferStr.substring(validLength));
          } else {
            downloadBuffers.set(commandId, bufferStr);
          }
        } catch (e) {
          console.error('Error writing chunk to stream:', e);
        }
      }

      if (isEof) {
        const remaining = downloadBuffers.get(commandId);
        if (remaining && remaining.length > 0) {
          try {
            streamRes.write(Buffer.from(remaining, 'base64'));
          } catch (e) {}
        }
        activeDownloadStreams.delete(commandId);
        downloadBuffers.delete(commandId);
        streamRes.end();
      }
      return; // Don't forward file stream data to dashboard terminal
    }

    if (isEof) {
      const agent = agents.get(agentId);
      if (agent && agent.activeCommandId === commandId) {
        agent.activeCommandId = null;
      }
    }
    // Forward command output straight to all dashboard listeners
    io.to('dashboard').emit('command-output', {
      commandId,
      output,
      isEof: isEof || false,
      exitCode
    });
  });

  socket.on('disconnect', () => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.status = 'offline';
      console.log(`Python agent disconnected: ${agent.hostname} (${agentId})`);
      broadcastAgents();
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`  P2P Command Management Server is running      `);
  console.log(`  Web Dashboard: http://localhost:${PORT}        `);
  console.log(`  Secret Token:  ${CONFIG.secret_token}         `);
  console.log(`================================================`);
});
