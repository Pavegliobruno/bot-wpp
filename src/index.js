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
                res.end('<html><body style="padding:20px;font-family:sans-serif;"><h1>⏳ Bot no conectado aún</h1></body></html>');
                return;
            }

            try {
                const stats = await getGroupStats();

                if (stats.error) {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h1>Error: ${stats.error}</h1></body></html>`);
                    return;
                }

                const groupsHtml = stats.adminGroups.map(g => `
                    <div style="background:#222;padding:15px;margin:10px 0;border-radius:8px;">
                        <h3 style="margin:0 0 10px 0;">${g.name}</h3>
                        <p style="color:#888;margin:5px 0;">${g.participantCount} participantes</p>
                    </div>
                `).join('');

                const sharedHtml = stats.sharedUsers.length > 0
                    ? `<ol style="padding-left:20px;">${stats.sharedUsers.map(u => `
                        <li style="background:#332;padding:10px;margin:5px 0;border-radius:5px;border-left:3px solid ${u.groupCount >= 3 ? '#f55' : '#fa0'};">
                            <strong>+${u.number}</strong> - en <strong>${u.groupCount}</strong> grupos
                            <div style="color:#888;font-size:12px;margin-top:5px;">${u.groups.join(', ')}</div>
                        </li>
                    `).join('')}</ol>`
                    : '<p style="color:#888;">No hay usuarios en multiples grupos</p>';

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Bot Status</title>
                    </head>
                    <body style="background:#111;color:#fff;font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;">
                        <h1>Estado del Bot Anti-Spam</h1>
                        <p style="color:#0f0;">Conectado como: ${client.info.wid.user}</p>

                        <h2>Grupos donde soy Admin (${stats.adminGroups.length} de ${stats.totalGroups})</h2>
                        ${groupsHtml || '<p style="color:#888;">No eres admin en ningun grupo</p>'}

                        <h2 style="margin-top:30px;">Usuarios en Multiples Grupos (${stats.sharedUsers.length})</h2>
                        <p style="color:#888;font-size:12px;">Usuarios que aparecen en mas de un grupo donde eres admin</p>
                        ${sharedHtml}

                        <p style="color:#666;margin-top:30px;font-size:12px;">Ultima actualizacion: ${new Date().toLocaleString()}</p>
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

// Función principal
async function main() {
    console.log('🚀 Iniciando bot...');
    console.log(`🔒 Modo: ${config.SOLO_LOGS ? 'SOLO LOGS (seguro para testing)' : 'PRODUCCIÓN'}`);

    // Limpiar locks de Chromium antes de iniciar
    cleanupChromiumLocks();

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
