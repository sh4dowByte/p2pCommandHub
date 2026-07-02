Berikut adalah Product Requirement Document (PRD) untuk aplikasi P2P Remote CLI/CMD Management System yang Anda butuhkan.
Product Requirement Document (PRD)
1. Project Overview & Objectives
Proyek ini bertujuan untuk membangun sistem manajemen server berbasis Peer-to-Peer (P2P) atau agent-server architecture (dengan komunikasi bidirectional layaknya P2P/Websocket) untuk mengeksekusi perintah CLI/CMD secara remote pada sistem operasi Linux, macOS, dan Windows.
Sistem terdiri dari Server (Node.js) sebagai pusat manajemen dan Client/Agent (Python & Bash) yang berjalan di server target. Fokus utama adalah kemudahan manajemen banyak klien dari satu dashboard atau pusat kontrol.
2. User Personas & Scope
• Persona: System Administrator / DevOps Engineer (Anda sendiri).
• Scope: Alat internal untuk manajemen server, eksekusi perintah massal/spesifik, dan monitoring status koneksi agen secara real-time.
3. System Architecture & High-Level Workflow
1. Server (Node.js) bertindak sebagai Connection Broker dan Control Panel.
2. Client (Python/Bash) melakukan inbound connection ke Server (sehingga aman dari kendala NAT/Firewall pada sisi klien).
3. Server dapat melihat daftar klien aktif, memilih klien tertentu, dan mengirimkan perintah untuk dieksekusi.
4. Klien mengeksekusi perintah di shell lokal dan mengembalikan hasilnya (stdout/stderr) ke Server.
4. Functional Requirements
4.1. Server Module (Node.js)
• Client Connection Management: • Menerima koneksi dari agen (Python) secara persisten menggunakan WebSocket atau WebRTC. • Menyediakan ID unik untuk setiap klien yang terhubung (bisa berdasarkan Hostname + MAC Address / UUID). • Mendeteksi status klien (Online/Offline) secara real-time via heartbeat mechanism.
• Command Execution Engine: • Dapat mengirim perintah teks (e.g., ls -la, dir, systemctl restart nginx) ke klien spesifik atau broadcast ke beberapa klien sekaligus. • Menerima dan menampilkan stream output (stdout/stderr) dari klien.
• Management Interface: • Antarmuka berbasis CLI interaktif (menggunakan library seperti blessed / inquirer) ATAU Web UI sederhana (Express + Socket.io) untuk memilih klien dan membuka sesi remote shell.
4.2. Client Module (Python) - Primary Agent untuk Cross-Platform
• Cross-Platform Support: Harus berjalan mulus di Windows (CMD/PowerShell), Linux (Bash), dan macOS (Zsh/Bash).
• Persistent Connection: Otomatis melakukan koneksi ke Node.js server saat startup dan melakukan auto-reconnect jika koneksi terputus.
• Command Execution: • Menerima instruksi string dari server. • Mengeksekusi perintah menggunakan modul subprocess secara aman. • Mengembalikan output secara real-time (buffered/streaming) ke server.
• System Metadata: Mengirimkan informasi OS, Hostname, IP Address, dan penggunaan CPU/RAM dasar saat pertama kali terkoneksi.
4.3. Client Module (Bash) - Minimalist Agent untuk Linux/macOS
• Lightweight Client: Ditujukan untuk server Linux/macOS resource-constrained yang tidak memiliki runtime Python.
• Connection: Menggunakan looping curl, wget, atau netcat/openssl (tergantung ketersediaan) untuk polling perintah atau memelihara reverse shell aman ke server.
5. Non-Functional Requirements
5.1. Security (Kritis)
• Authentication & Authorization: Klien harus membawa Secret Token khusus yang divalidasi oleh server agar server Anda tidak dieksploitasi oleh agen liar.
• Encryption: Semua lalu lintas data komunikasi wajib menggunakan enkripsi (TLS/SSL untuk WebSocket, atau menggunakan HTTPS).
• Command Sanitization: Opsional, namun disarankan adanya blacklist kata kunci berbahaya (seperti rm -rf / tanpa konfirmasi) di sisi klien atau server.
5.2. Performance & Reliability
• Low Latency: Eksekusi perintah harus terasa instan (< 500ms di luar durasi proses perintah itu sendiri).
• Low Footprint: Agen Python dan Bash harus menggunakan CPU < 1% dan RAM seminimal mungkin saat posisi idle.
6. Technical Stack Recommendations
Komponen	Teknologi	Alasan
Server Backend	Node.js (TypeScript/JavaScript)	Sangat efisien untuk menangani ribuan koneksi persisten (I/O bound) menggunakan Socket.io atau ws.
Server UI	CLI (Blessed/Inquirer) atau Web (Vue/React minimal)	Mempermudah manajemen list klien dan memilih target remote.
Python Client	Python 3.x (websockets, subprocess, platform)	Bawaan standar di Linux/macOS, mudah di-install di Windows. Tanpa kompilasi rumit.
Bash Client	Pure Bash Script (/dev/tcp atau curl loop)	Solusi tanpa dependency tambahan untuk Linux kosongan.
7. Preliminary Architecture Design (Workflow Contoh)
[Client Python/Bash] --(1. Connect + Auth Token)--> [Node.js Server]
[Client Python/Bash] <-- (2. Auth Validated) ------ [Node.js Server]

*Saat Anda ingin eksekusi perintah:*
[Node.js Server] ------- (3. Kirim: "df -h") ------> [Client Target]
[Client Target]  ------- (4. Jalankan lokal) -----> (OS Shell)
[Client Target]  <------ (5. Dapat Output) -------- (OS Shell)
[Client Target]  ------- (6. Stream Output) ------> [Node.js Server UI]

8. Future Roadmap (Tahap Selanjutnya)
1. File Transfer Capability: Fitur untuk upload atau download file dari/ke server target lewat protokol yang sama.
2. Cron/Task Scheduling: Menjadwalkan perintah untuk dieksekusi pada jam tertentu langsung dari Node.js server.
3. Group Management: Mengelompokkan klien berdasarkan OS atau lokasi (misal: grup production-linux, office-windows).