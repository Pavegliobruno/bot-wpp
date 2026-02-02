const qrcode = require('qrcode-terminal');
const http = require('http');

const config = require('./config');
const { createClient, setupReconnection } = require('./client');
const { handleMessage } = require('./handlers/messageHandler');
const { startCacheCleanup } = require('./utils/cache');
const { iniciarLimpiezaPeriodica } = require('./utils/spamDetector');

// Crear cliente
const client = createClient();

// Configurar handlers del cliente
function setupClientHandlers() {
    // QR code para autenticación
    client.on('qr', qr => {
        console.log('📱 Escanea este QR con WhatsApp:');
        console.log('');
        qrcode.generate(qr, { small: true });
        console.log('');
        console.log('⚠️ IMPORTANTE: Escanea este QR desde tu WhatsApp en los próximos 60 segundos');
    });

    // Autenticación exitosa
    client.on('authenticated', () => {
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

// Configurar servidor de healthcheck
function setupHealthcheck() {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200);
            res.end('OK');
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(config.PORT, () => {
        console.log(`🏥 Healthcheck server running on port ${config.PORT}`);
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

    // Configurar handlers
    setupClientHandlers();

    // Iniciar healthcheck
    setupHealthcheck();

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
