# P2P Command Hub - Agent Architecture & Protocols

This document details the architecture, lifecycle, protocols, and deployment of the two agent variants used by the P2P Command Hub.

---

## 1. Overview of Agents

The system supports two agent implementations, targeting different server environments and system constraints:

### Python Agent (`/agents/python/agent.py`)
- **Primary Agent**: Ideal for standard servers (Linux, macOS, Windows) where Python 3 is available.
- **Protocol**: Persistent WebSocket connection via the standard `socket.io-client` protocol.
- **Capabilities**:
  - Continuous bidirectional event streaming.
  - Real-time CPU/RAM metric reporting.
  - Docker container listing and management.
  - File browser navigation (list directories, upload, download streams).
  - Clean asynchronous command execution.

### Bash Agent (`/agents/bash/agent.sh`)
- **Lightweight Agent**: Tailored for minimal Linux/macOS environments (e.g. busybox, fresh containers) where Python is not available.
- **Protocol**: HTTP Polling (polling commands via HTTP GET, sending outputs via HTTP POST).
- **Capabilities**:
  - Lightweight footprint (relies only on standard utilities like `curl`, `jq`, `hostname`, `df`).
  - Command execution via subshell.
  - Basic file browsing (using standard `ls` and formatting helper).
  - Basic CPU/RAM reporting.

### PowerShell Agent (`/agents/powershell/agent.ps1`)
- **Windows Agent**: Designed for Windows servers running PowerShell 5.1+ (included in Windows 8+) or PowerShell 7+.
- **Protocol**: HTTP Polling (same as Bash agent — poll via HTTP GET, send output via HTTP POST).
- **Capabilities**:
  - No external dependencies required — uses built-in `Invoke-WebRequest` and WMI.
  - Command execution via `cmd.exe /c` (supports CMD built-ins, batch files, and any installed tool).
  - File browsing (directory listing and download via PowerShell Base64 encoding).
  - CPU/RAM reporting using WMI (`Win32_Processor`, `Win32_OperatingSystem`).
  - Auto-detected as `powershell` type via `ps_` ID prefix.

---

## 2. Communication Protocols & Lifecycle

Both agents perform **inbound connections** to the Control Hub server. This eliminates the need to configure port forwarding or bypass firewalls on the agent host side.

```
+------------------+                   +--------------------+
|   Python Agent   | === WebSocket ===> |                    |
+------------------+                   |                    |
                                       | P2P Command Server |
+------------------+                   |                    |
|    Bash Agent    | <--- HTTP Poll -- |                    |
+------------------+                   +--------------------+
```

### 2.1. Authentication
Every communication is authenticated using a shared `SECRET_TOKEN` defined in `config.json`.
- **Python Agent**: Handed as auth token in Socket.io connection query.
- **Bash Agent**: Sent in the `Authorization: Bearer <TOKEN>` header or as a query parameter `?token=<TOKEN>`.

---

### 2.2. Python Agent Protocol (WebSocket)
The Python agent uses `socket.io-client` to keep a persistent WebSocket connection.

#### Handshake & Registration
Upon connection, the agent emits an `agent-register` event with the host metadata:
```json
{
  "id": "agent-unique-uuid",
  "hostname": "production-db-01",
  "platform": "linux",
  "ip": "192.168.1.50",
  "secret_token": "your_secret_token",
  "metrics": {
    "cpu": 12.5,
    "ram": 55.4
  },
  "docker": "active"
}
```

#### Command Execution Event Loop
1. **Server to Agent (`command-execute`)**:
   ```json
   {
     "commandId": "cmd-uuid-1234",
     "cmd": "systemctl status nginx"
   }
   ```
2. **Agent to Server (`command-output`)**: Streaming chunks as they become available.
   ```json
   {
     "commandId": "cmd-uuid-1234",
     "output": "nginx is running..."
   }
   ```
3. **Agent to Server (`command-complete`)**: Sent when execution finishes.
   ```json
   {
     "commandId": "cmd-uuid-1234",
     "exitCode": 0
   }
   ```

#### Heartbeats
Standard Socket.io ping/pong is handled automatically to maintain connectivity. In addition, metrics are pushed to the server every few seconds.

---

### 2.3. Bash Agent Protocol (HTTP Polling)
The Bash agent communicates via periodic REST requests.

#### Polling Loop (`GET /api/agent/poll`)
Every few seconds (configured via poll interval), the Bash agent calls:
```bash
GET /api/agent/poll?id=agent-id&hostname=hostname&platform=linux&cpu=10&ram=45
```
- **Response if idle**: `{ "commandId": null }`
- **Response if command queued**:
  ```json
  {
    "commandId": "cmd-uuid-5678",
    "cmd": "df -h"
  }
  ```

#### Response Reporting (`POST /api/agent/response`)
When execution finishes or streams chunks, the Bash agent posts the response back:
```json
{
  "id": "agent-id",
  "token": "secret_token",
  "commandId": "cmd-uuid-5678",
  "output": "Filesystem Size Used Avail Use% Mounted on\n...",
  "exitCode": 0,
  "isEof": true
}
```

---

## 3. Dynamic Installer System

The Node.js server serves pre-configured installer endpoints. These dynamically inject the correct `SERVER_URL` and `SECRET_TOKEN` into the script before serving them.

### Installing PowerShell Agent (Windows)
Retrieve and run the PowerShell agent payload directly (in PowerShell):
```powershell
Invoke-WebRequest -Uri http://<server-ip>:3000/install-powershell -OutFile agent.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File agent.ps1
```
*(Run as Administrator. To run in background: use `Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File agent.ps1" -WindowStyle Hidden`)*

### Installing Python Agent
Retrieve and run the Python agent payload directly:
```bash
curl -s http://<server-ip>:3000/install-python > agent.py
pip install websockets
python3 agent.py
```

### Installing Bash Agent
Retrieve and run the Bash agent payload directly:
```bash
curl -s http://<server-ip>:3000/install-bash | bash
```
*(Optionally run in background or register as a systemd service).*

---

## 4. Security Recommendations
1. **Always Use HTTPS/WSS**: Configure a reverse proxy (like Nginx with SSL certificates) in front of the Node.js server.
2. **Change Default Token**: Update the `secret_token` in `config.json` before deploying agents to production.
3. **Blacklist Safeguards**: The Python agent executes within the system context. For high security, ensure the agent process runs as a dedicated non-root user.
