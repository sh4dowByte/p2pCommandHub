import os
import sys
import time
import socket
import platform
import subprocess
import threading
import json

# Try importing optional packages, fail gracefully
try:
    import socketio
except ImportError:
    print("Error: 'python-socketio[client]' library is required. Please install it using 'pip install python-socketio[client]'")
    sys.exit(1)

try:
    import psutil
except ImportError:
    psutil = None
    print("Warning: 'psutil' library not found. System metrics tracking will be limited. Install with 'pip install psutil'")

# Configuration
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
SERVER_URL = os.environ.get("SERVER_URL") or "http://localhost:3000"
SECRET_TOKEN = os.environ.get("SECRET_TOKEN") or "p2p_secure_agent_token_2026"

env_server_url = os.environ.get("SERVER_URL")
env_secret_token = os.environ.get("SECRET_TOKEN")

if os.path.exists(CONFIG_PATH):
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            port = config.get('port', 3000)
            # Use server_url from config if present, otherwise default to localhost with port (unless overridden by env)
            if not env_server_url:
                SERVER_URL = config.get('server_url', f"http://localhost:{port}")
            if not env_secret_token:
                SECRET_TOKEN = config.get('secret_token', SECRET_TOKEN)
    except Exception as e:
        print(f"Warning: Failed to parse config.json, using defaults. Error: {e}")

# Initialize Socket.io Client
sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=5)

# Helper to get local IP
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to actually connect, just routes packets
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# Helper to gather metrics
def get_system_metrics():
    if psutil:
        try:
            return {
                'cpu': psutil.cpu_percent(interval=None) or 0.0,
                'ram': psutil.virtual_memory().percent or 0.0
            }
        except Exception:
            pass
    return {'cpu': 0.0, 'ram': 0.0}

def get_metadata():
    metrics = get_system_metrics()
    return {
        'hostname': socket.gethostname(),
        'platform': f"{platform.system()} {platform.release()}",
        'ip': get_local_ip(),
        'cpu': metrics['cpu'],
        'ram': metrics['ram']
    }

# Active command processes map (command_id -> subprocess.Popen)
active_processes = {}

# ----------------------------------------------------
# Command Execution Handler
# ----------------------------------------------------
def execute_command_thread(cmd, command_id):
    print(f"Executing: {cmd} (ID: {command_id})")
    
    try:
        # Merge stderr into stdout so we stream both together
        process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Track process
        active_processes[command_id] = process
        
        # Read output stream line-by-line and send to server
        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break
            if line:
                sio.emit('command-output', {
                    'commandId': command_id,
                    'output': line,
                    'isEof': False
                })
        
        exit_code = process.poll()
        print(f"Command execution finished with code {exit_code}")
        
        # Send EOF event
        sio.emit('command-output', {
            'commandId': command_id,
            'output': '',
            'isEof': True,
            'exitCode': exit_code
        })
        
    except Exception as e:
        print(f"Failed to execute command: {e}")
        sio.emit('command-output', {
            'commandId': command_id,
            'output': f"Execution Error: {str(e)}\n",
            'isEof': True,
            'exitCode': -1
        })
    finally:
        active_processes.pop(command_id, None)

# ----------------------------------------------------
# Socket Events
# ----------------------------------------------------
@sio.event
def connect():
    print(f"Connected to command server at {SERVER_URL}")
    # Register immediately
    metadata = get_metadata()
    sio.emit('register', metadata)

@sio.event
def disconnect():
    print("Disconnected from command server")

@sio.on('run-command')
def on_run_command(data):
    cmd = data.get('cmd')
    command_id = data.get('commandId')
    if cmd and command_id:
        # Run command execution in a separate thread so WebSocket heartbeat remains unblocked
        t = threading.Thread(target=execute_command_thread, args=(cmd, command_id))
        t.daemon = True
        t.start()

@sio.on('kill-command')
def on_kill_command(data):
    command_id = data.get('commandId')
    if command_id:
        process = active_processes.get(command_id)
        if process:
            print(f"Received terminate signal for command: {command_id}")
            try:
                process.terminate()
                time.sleep(0.3)
                if process.poll() is None:
                    process.kill()
            except Exception as e:
                print(f"Error killing process: {e}")

@sio.on('file-browse-list')
def on_file_browse_list(data):
    path = data.get('path', '.') if data else '.'
    # Resolve home directory
    if path.startswith('~'):
        path = os.path.expanduser(path)
    path = os.path.abspath(path)
    
    try:
        items = []
        if not os.path.exists(path):
            return {'status': 'error', 'message': f'Path does not exist: {path}', 'path': path}
        
        # Scandir is faster and more efficient
        with os.scandir(path) as it:
            for entry in it:
                try:
                    info = entry.stat()
                    is_dir = entry.is_dir(follow_symlinks=True)
                    items.append({
                        'name': entry.name,
                        'isDir': is_dir,
                        'size': info.st_size if not is_dir else 0,
                        'mtime': info.st_mtime
                    })
                except Exception as entry_err:
                    items.append({
                        'name': entry.name,
                        'isDir': False,
                        'size': 0,
                        'mtime': 0,
                        'error': str(entry_err)
                    })
        return {'status': 'success', 'items': items, 'path': path, 'sep': os.sep}
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'path': path}

@sio.on('file-browse-read')
def on_file_browse_read(data):
    path = data.get('path') if data else None
    if not path:
        return {'status': 'error', 'message': 'No path specified'}
        
    if path.startswith('~'):
        path = os.path.expanduser(path)
    path = os.path.abspath(path)
    
    try:
        import base64
        with open(path, 'rb') as f:
            content = f.read()
            # limit size to 50MB
            if len(content) > 50 * 1024 * 1024:
                return {'status': 'error', 'message': 'File too large for direct download (max 50MB)'}
            encoded = base64.b64encode(content).decode('utf-8')
            return {
                'status': 'success',
                'name': os.path.basename(path),
                'content': encoded,
                'encoding': 'base64'
            }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

# ----------------------------------------------------
# Heartbeat & Metrics Loop
# ----------------------------------------------------
def metrics_reporter_loop():
    while True:
        if sio.connected:
            try:
                metrics = get_system_metrics()
                sio.emit('metrics-update', metrics)
            except Exception as e:
                print(f"Failed to report metrics: {e}")
        time.sleep(5)

# Main Entrance
if __name__ == '__main__':
    # Start background metrics thread
    metrics_thread = threading.Thread(target=metrics_reporter_loop)
    metrics_thread.daemon = True
    metrics_thread.start()

    # Connection retry loop
    while True:
        if not sio.connected:
            try:
                print(f"Attempting to connect to server at {SERVER_URL}...")
                sio.connect(
                    SERVER_URL,
                    auth={'token': SECRET_TOKEN},
                    namespaces=['/']
                )
                # Keep main thread alive
                sio.wait()
            except Exception as e:
                print(f"Connection failed: {e}. Retrying in 5 seconds...")
                time.sleep(5)
        else:
            time.sleep(1)
