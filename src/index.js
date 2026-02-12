const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');

// Limpiar archivos de bloqueo de Chromium al iniciar
function cleanupChromiumLocks() {
    const paths = ['./wwebjs_auth', './.wwebjs_auth', './wwebjs_cache', './.wwebjs_cache'];

    for (const authPath of paths) {
        try {
            if (!fs.existsSync(authPath)) continue;

            const cleanLocks = (dir) => {
                try {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        try {
                            const filePath = path.join(dir, file);
                            const stat = fs.lstatSync(filePath);

                            if (stat.isDirectory()) {
                                cleanLocks(filePath);
                            } else if (
                                file === 'SingletonLock' ||
                                file === 'SingletonCookie' ||
                                file === 'SingletonSocket' ||
                                file === 'lockfile' ||
                                file.endsWith('.lock')
                            ) {
                                fs.unlinkSync(filePath);
                                console.log(`🧹 Eliminado lock: ${filePath}`);
                            }
                        } catch (e) {
                            // Intentar eliminar aunque haya error
                            try {
                                const filePath = path.join(dir, file);
                                fs.unlinkSync(filePath);
                            } catch (e2) {}
                        }
                    }
                } catch (e) {}
            };

            cleanLocks(authPath);
        } catch (e) {
            console.log(`⚠️ Error limpiando ${authPath}:`, e.message);
        }
    }
}
const { createClient, setupReconnection } = require('./client');
const { handleMessage } = require('./handlers/messageHandler');
const { startCacheCleanup } = require('./utils/cache');
const { iniciarLimpiezaPeriodica } = require('./utils/spamDetector');

// Crear cliente
const client = createClient();

// Estado del QR para servir via HTTP
let currentQR = null;
let isAuthenticated = false;

// Configurar handlers del cliente
function setupClientHandlers() {
    // QR code para autenticación
    client.on('qr', qr => {
        currentQR = qr;
        console.log('📱 Escanea este QR con WhatsApp:');
        console.log('');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('');
        console.log('⚠️ IMPORTANTE: Escanea este QR desde tu WhatsApp en los próximos 60 segundos');
        console.log('');
        console.log('🌐 Si el QR se ve roto, abre esta URL en tu navegador:');
        console.log(`   ${process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'http://localhost:' + config.PORT}/qr`);
    });

    // Autenticación exitosa
    client.on('authenticated', () => {
        isAuthenticated = true;
        currentQR = null;
        console.log('✅ Autenticación exitosa! Sesión guardada.');
    });

    // Cliente listo
    client.on('ready', () => {
        console.log('');
        console.log('✅ =============================================');
        console.log('✅ Bot anti-spam activo');
        console.log(`🔒 MODO: ${config.SOLO_LOGS ? 'SOLO LOGS (no envía notificaciones)' : 'PRODUCCIÓN'}`);
        console.log('👀 Observando y registrando actividad...');
        console.log('✅ =============================================');
        console.log('');
    });

    // Handler de mensajes
    client.on('message_create', async (msg) => {
        handleMessage(client, msg);
    });

    // Configurar reconexión inteligente
    setupReconnection(client, () => {
        console.log('✅ Reconexión exitosa');
    });
}

// Obtener estadísticas de grupos y usuarios
async function getGroupStats() {
    try {
        const chats = await client.getChats();
        const groups = chats.filter(c => c.isGroup);
        const me = client.info.wid._serialized;

        // Filtrar grupos donde somos admin
        const adminGroups = [];
        const userGroupMap = new Map(); // usuario -> [grupos]

        for (const group of groups) {
            const participant = group.participants.find(p => p.id._serialized === me);
            if (participant && participant.isAdmin) {
                const groupInfo = {
                    name: group.name,
                    id: group.id._serialized,
                    participantCount: group.participants.length,
                    participants: group.participants.map(p => ({
                        id: p.id._serialized,
                        number: p.id.user,
                        isAdmin: p.isAdmin
                    }))
                };
                adminGroups.push(groupInfo);

                // Mapear usuarios a grupos
                for (const p of group.participants) {
                    if (p.id._serialized === me) continue; // Ignorar al bot
                    if (!userGroupMap.has(p.id._serialized)) {
                        userGroupMap.set(p.id._serialized, []);
                    }
                    userGroupMap.get(p.id._serialized).push(group.name);
                }
            }
        }

        // Encontrar usuarios en múltiples grupos
        const sharedUsers = [];
        for (const [userId, groupNames] of userGroupMap.entries()) {
            if (groupNames.length > 1) {
                sharedUsers.push({
                    number: userId.split('@')[0],
                    groupCount: groupNames.length,
                    groups: groupNames
                });
            }
        }

        // Ordenar por cantidad de grupos (más grupos primero)
        sharedUsers.sort((a, b) => b.groupCount - a.groupCount);

        return { adminGroups, sharedUsers, totalGroups: groups.length };
    } catch (e) {
        return { error: e.message };
    }
}

// Configurar servidor HTTP (healthcheck + QR + status)
function setupHttpServer() {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/health') {
            res.writeHead(200);
            res.end('OK');
        } else if (req.url === '/status') {
            if (!isAuthenticated || !client.info) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body style="padding:20px;font-family:sans-serif;background:#111;color:#fff;"><h1>⏳ Bot no conectado aún</h1></body></html>');
                return;
            }

            try {
                const stats = await getGroupStats();

                if (stats.error) {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h1>Error: ${stats.error}</h1></body></html>`);
                    return;
                }

                // Preparar datos para JavaScript
                const groupsData = JSON.stringify(stats.adminGroups);

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Bot Status</title>
                        <style>
                            * { box-sizing: border-box; }
                            body {
                                background: #111;
                                color: #fff;
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                padding: 20px;
                                max-width: 900px;
                                margin: 0 auto;
                            }
                            h1 { margin-bottom: 5px; }
                            .status { color: #0f0; margin-bottom: 30px; }
                            h2 { margin-top: 30px; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
                            .groups-grid {
                                display: flex;
                                flex-wrap: wrap;
                                gap: 10px;
                                margin-bottom: 20px;
                            }
                            .group-btn {
                                background: #222;
                                border: 2px solid #333;
                                color: #fff;
                                padding: 12px 16px;
                                border-radius: 8px;
                                cursor: pointer;
                                transition: all 0.2s;
                                font-size: 14px;
                            }
                            .group-btn:hover {
                                border-color: #555;
                                background: #2a2a2a;
                            }
                            .group-btn.selected {
                                border-color: #0af;
                                background: #0af2;
                            }
                            .group-btn .count {
                                color: #888;
                                font-size: 12px;
                                margin-left: 5px;
                            }
                            .results {
                                background: #1a1a1a;
                                border-radius: 8px;
                                padding: 20px;
                                margin-top: 20px;
                            }
                            .results-header {
                                color: #888;
                                margin-bottom: 15px;
                            }
                            .user-item {
                                background: #222;
                                padding: 12px 15px;
                                margin: 8px 0;
                                border-radius: 6px;
                                border-left: 3px solid #0af;
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                            }
                            .user-number {
                                font-weight: bold;
                                font-size: 16px;
                            }
                            .user-groups {
                                color: #888;
                                font-size: 12px;
                            }
                            .no-results {
                                color: #666;
                                text-align: center;
                                padding: 30px;
                            }
                            .hint {
                                color: #666;
                                font-size: 13px;
                                margin-bottom: 15px;
                            }
                            .actions {
                                margin-bottom: 15px;
                            }
                            .action-btn {
                                background: #333;
                                border: none;
                                color: #aaa;
                                padding: 8px 12px;
                                border-radius: 5px;
                                cursor: pointer;
                                font-size: 12px;
                                margin-right: 8px;
                            }
                            .action-btn:hover {
                                background: #444;
                                color: #fff;
                            }
                            .footer {
                                color: #444;
                                font-size: 12px;
                                margin-top: 30px;
                                text-align: center;
                            }
                        </style>
                    </head>
                    <body>
                        <h1>Bot Anti-Spam</h1>
                        <p class="status">Conectado como: ${client.info.wid.user}</p>

                        <h2>Selecciona grupos para comparar (${stats.adminGroups.length})</h2>
                        <p class="hint">Selecciona 2 o más grupos para ver usuarios en común</p>

                        <div class="actions">
                            <button class="action-btn" onclick="selectAll()">Seleccionar todos</button>
                            <button class="action-btn" onclick="clearAll()">Limpiar selección</button>
                        </div>

                        <div class="groups-grid" id="groupsGrid"></div>

                        <div class="results" id="results">
                            <div class="no-results">Selecciona al menos 2 grupos para comparar</div>
                        </div>

                        <p class="footer">Última actualización: ${new Date().toLocaleString()}</p>

                        <script>
                            const groups = ${groupsData};
                            const selectedGroups = new Set();

                            function renderGroups() {
                                const grid = document.getElementById('groupsGrid');
                                grid.innerHTML = groups.map((g, i) => \`
                                    <button class="group-btn \${selectedGroups.has(i) ? 'selected' : ''}" onclick="toggleGroup(\${i})">
                                        \${escapeHtml(g.name)}
                                        <span class="count">(\${g.participantCount})</span>
                                    </button>
                                \`).join('');
                            }

                            function toggleGroup(index) {
                                if (selectedGroups.has(index)) {
                                    selectedGroups.delete(index);
                                } else {
                                    selectedGroups.add(index);
                                }
                                renderGroups();
                                updateResults();
                            }

                            function selectAll() {
                                groups.forEach((_, i) => selectedGroups.add(i));
                                renderGroups();
                                updateResults();
                            }

                            function clearAll() {
                                selectedGroups.clear();
                                renderGroups();
                                updateResults();
                            }

                            function updateResults() {
                                const resultsDiv = document.getElementById('results');

                                if (selectedGroups.size < 2) {
                                    resultsDiv.innerHTML = '<div class="no-results">Selecciona al menos 2 grupos para comparar</div>';
                                    return;
                                }

                                // Obtener usuarios de los grupos seleccionados
                                const selectedGroupsList = Array.from(selectedGroups).map(i => groups[i]);
                                const groupNames = selectedGroupsList.map(g => g.name);

                                // Contar en cuántos grupos seleccionados está cada usuario
                                const userCount = new Map();
                                const userGroups = new Map();

                                for (const group of selectedGroupsList) {
                                    for (const p of group.participants) {
                                        if (!userCount.has(p.number)) {
                                            userCount.set(p.number, 0);
                                            userGroups.set(p.number, []);
                                        }
                                        userCount.set(p.number, userCount.get(p.number) + 1);
                                        userGroups.get(p.number).push(group.name);
                                    }
                                }

                                // Filtrar usuarios que están en TODOS los grupos seleccionados
                                const sharedUsers = [];
                                for (const [number, count] of userCount.entries()) {
                                    if (count === selectedGroups.size) {
                                        sharedUsers.push({
                                            number,
                                            groups: userGroups.get(number)
                                        });
                                    }
                                }

                                // Ordenar por número
                                sharedUsers.sort((a, b) => a.number.localeCompare(b.number));

                                if (sharedUsers.length === 0) {
                                    resultsDiv.innerHTML = \`
                                        <div class="results-header">Comparando: \${groupNames.join(' + ')}</div>
                                        <div class="no-results">No hay usuarios en común entre todos los grupos seleccionados</div>
                                    \`;
                                    return;
                                }

                                resultsDiv.innerHTML = \`
                                    <div class="results-header">
                                        <strong>\${sharedUsers.length}</strong> usuario(s) en común entre: \${groupNames.join(' + ')}
                                    </div>
                                    \${sharedUsers.map(u => \`
                                        <div class="user-item">
                                            <span class="user-number">+\${u.number}</span>
                                        </div>
                                    \`).join('')}
                                \`;
                            }

                            function escapeHtml(text) {
                                const div = document.createElement('div');
                                div.textContent = text;
                                return div.innerHTML;
                            }

                            // Inicializar
                            renderGroups();
                        </script>
                    </body>
                    </html>
                `);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<html><body><h1>Error: ${e.message}</h1></body></html>`);
            }
        } else if (req.url === '/qr') {
            if (isAuthenticated) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><h1>✅ Ya autenticado!</h1></body></html>');
            } else if (currentQR) {
                try {
                    const qrImage = await QRCode.toDataURL(currentQR, { width: 400 });
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <head><title>WhatsApp QR</title></head>
                        <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#111;color:#fff;">
                            <h1>📱 Escanea con WhatsApp</h1>
                            <img src="${qrImage}" style="border-radius:10px;"/>
                            <p style="color:#888;">Abre WhatsApp → Configuración → Dispositivos vinculados</p>
                            <p style="color:#666;font-size:12px;">El QR expira en 60 segundos. Recarga si es necesario.</p>
                        </body>
                        </html>
                    `);
                } catch (e) {
                    res.writeHead(500);
                    res.end('Error generando QR');
                }
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><h1>⏳ Esperando QR... Recarga en unos segundos</h1></body></html>');
            }
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(config.PORT, () => {
        console.log(`🏥 HTTP server running on port ${config.PORT}`);
    });
}

// Iniciar servicios de limpieza
function startCleanupServices() {
    startCacheCleanup();
    iniciarLimpiezaPeriodica();
}

// Manejo graceful de SIGTERM (Railway envía esto para detener el proceso)
function setupGracefulShutdown() {
    let shuttingDown = false;

    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n🛑 Recibida señal ${signal}, cerrando gracefully...`);

        try {
            // Destruir el cliente de WhatsApp (cierra Chromium)
            await Promise.race([
                client.destroy(),
                new Promise(resolve => setTimeout(resolve, 10000)) // max 10s
            ]);
            console.log('✅ Cliente cerrado correctamente');
        } catch (e) {
            console.log('⚠️ Error cerrando cliente:', e.message);
        }

        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// Función principal
async function main() {
    console.log('🚀 Iniciando bot...');
    console.log(`🔒 Modo: ${config.SOLO_LOGS ? 'SOLO LOGS (seguro para testing)' : 'PRODUCCIÓN'}`);

    // Limpiar locks de Chromium antes de iniciar
    cleanupChromiumLocks();

    // Configurar shutdown graceful
    setupGracefulShutdown();

    // Configurar handlers
    setupClientHandlers();

    // Iniciar servidor HTTP
    setupHttpServer();

    // Iniciar servicios de limpieza
    startCleanupServices();

    // Inicializar cliente
    client.initialize();
}

// Exportar para uso externo
module.exports = { main, client };

// Ejecutar si es el módulo principal
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
}
