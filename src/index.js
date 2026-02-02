const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');

// Limpiar archivos de bloqueo de Chromium al iniciar
function cleanupChromiumLocks() {
    const authPath = './wwebjs_auth';
    if (fs.existsSync(authPath)) {
        const cleanLocks = (dir) => {
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    cleanLocks(filePath);
                } else if (file === 'SingletonLock' || file === 'SingletonCookie' || file === 'SingletonSocket') {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Eliminado lock: ${filePath}`);
                }
            }
        };
        cleanLocks(authPath);
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

// Configurar servidor HTTP (healthcheck + QR)
function setupHttpServer() {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/health') {
            res.writeHead(200);
            res.end('OK');
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
