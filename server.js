const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// Load configurations
let CONFIG = {
  port: 3000,
  secret_token: "p2p_secure_agent_token_2026"
};

try {
  const configFile = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
  CONFIG = JSON.parse(configFile);
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Memory-based tracking
const agents = new Map(); // id -> agent data
const bashCommandQueues = new Map(); // agentId -> array of { commandId, cmd }
const activeCommands = new Map(); // commandId -> { agentId, dashboardSockets: Set }
const pendingFileBrowse = new Map(); // commandId -> { socketId, type, path, chunks: [] }

// Helper to cleanup stale Bash agents (e.g. no poll in 15 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, agent] of agents.entries()) {
    if (agent.type === 'bash' && agent.status === 'online' && now - agent.lastSeen > 15000) {
      agent.status = 'offline';
      changed = true;
      console.log(`Bash agent offline (timeout): ${agent.hostname} (${id})`);
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
    let script = fs.readFileSync(path.join(__dirname, 'client-bash', 'agent.sh'), 'utf8');
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
    let script = fs.readFileSync(path.join(__dirname, 'client-python', 'agent.py'), 'utf8');
    script = script.replace(/SERVER_URL = "http:\/\/localhost:3000"/g, `SERVER_URL = "${hostUrl}"`);
    script = script.replace(/SECRET_TOKEN = "p2p_secure_agent_token_2026"/g, `SECRET_TOKEN = "${CONFIG.secret_token}"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(script);
  } catch (err) {
    console.error('Error serving install-python:', err);
    return res.status(500).send('Error generating installer script: ' + err.message);
  }
});

// ----------------------------------------------------
// Bash Agent HTTP API
// ----------------------------------------------------
app.get('/api/agent/poll', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (token !== CONFIG.secret_token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id, hostname, platform, ip, cpu, ram } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing client id' });
  }

  // Register or update Bash agent status
  const isNew = !agents.has(id);
  const existingAgent = agents.get(id);
  const activeCommandId = existingAgent ? existingAgent.activeCommandId : null;

  agents.set(id, {
    id,
    hostname: hostname || 'Unknown-Bash',
    platform: platform || 'linux',
    ip: ip || req.ip,
    type: 'bash',
    status: 'online',
    lastSeen: Date.now(),
    metrics: {
      cpu: parseFloat(cpu) || 0,
      ram: parseFloat(ram) || 0
    },
    activeCommandId
  });

  if (isNew) {
    console.log(`New Bash agent connected: ${hostname} (${id})`);
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

  const { id, commandId, output, exitCode, isEof } = req.body;
  if (!id || !commandId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

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
    port: CONFIG.port || 3000,
    serverUrl: CONFIG.server_url || '',
    secretToken: CONFIG.secret_token || ''
  });
});

// Update configuration settings
app.post('/api/config', (req, res) => {
  const { serverUrl, secretToken, port } = req.body;
  
  if (serverUrl !== undefined) CONFIG.server_url = serverUrl.trim();
  if (secretToken !== undefined) CONFIG.secret_token = secretToken.trim();
  if (port !== undefined) CONFIG.port = parseInt(port, 10) || 3000;
  
  try {
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(CONFIG, null, 2), 'utf8');
    console.log('Server configuration updated:', CONFIG);
    return res.json({ status: 'success', message: 'Configuration saved successfully.' });
  } catch (err) {
    console.error('Failed to save config:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to write config.json file.' });
  }
});

// ----------------------------------------------------
// Socket.io for Python Agent & Web UI
// ----------------------------------------------------
io.on('connection', (socket) => {
  const { role, token } = socket.handshake.auth;

  if (role === 'dashboard') {
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
        const agentSocket = io.sockets.sockets.get(agentId);
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
      }
    });

    socket.on('file-browse-download', ({ agentId, path }) => {
      const agent = agents.get(agentId);
      if (!agent || agent.status !== 'online') {
        socket.emit('file-browse-download-response', { status: 'error', message: 'Agent is offline or does not exist.' });
        return;
      }

      if (agent.type === 'python') {
        const agentSocket = io.sockets.sockets.get(agentId);
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
        const cmd = `if command -v base64 >/dev/null 2>&1; then base64 -i "${escapedPath}" 2>/dev/null || base64 "${escapedPath}"; elif command -v openssl >/dev/null 2>&1; then openssl base64 -in "${escapedPath}"; elif command -v python3 >/dev/null 2>&1; then python3 -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()).decode())' "${escapedPath}"; elif command -v python >/dev/null 2>&1; then python -c 'import base64, sys; sys.stdout.write(base64.b64encode(open(sys.argv[1], "rb").read()))' "${escapedPath}"; else echo "No base64 encoder found" >&2; exit 127; fi`;

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
        io.to(agentId).emit('run-command', { cmd, commandId });
      } else if (agent.type === 'bash') {
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
        io.to(agentId).emit('kill-command', { commandId: agent.activeCommandId });
      } else if (agent.type === 'bash') {
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
    // Register agent
    agents.set(agentId, {
      id: agentId,
      hostname: metadata.hostname || 'Unknown-Python',
      platform: metadata.platform || 'unknown',
      ip: metadata.ip || socket.handshake.address || '127.0.0.1',
      type: 'python',
      status: 'online',
      lastSeen: Date.now(),
      metrics: {
        cpu: metadata.cpu || 0,
        ram: metadata.ram || 0
      }
    });

    console.log(`Python agent registered: ${metadata.hostname} (${agentId})`);
    broadcastAgents();
  });

  socket.on('metrics-update', (metrics) => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.metrics = {
        cpu: metrics.cpu || 0,
        ram: metrics.ram || 0
      };
      agent.lastSeen = Date.now();
      broadcastAgents();
    }
  });

  // Real-time output stream from Python agent
  socket.on('command-output', (data) => {
    if (data.isEof) {
      const agent = agents.get(agentId);
      if (agent && agent.activeCommandId === data.commandId) {
        agent.activeCommandId = null;
      }
    }
    // Forward command output straight to all dashboard listeners
    io.to('dashboard').emit('command-output', {
      commandId: data.commandId,
      output: data.output,
      isEof: data.isEof || false,
      exitCode: data.exitCode
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
const PORT = CONFIG.port || 3000;
server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`  P2P Command Management Server is running      `);
  console.log(`  Web Dashboard: http://localhost:${PORT}        `);
  console.log(`  Secret Token:  ${CONFIG.secret_token}         `);
  console.log(`================================================`);
});
