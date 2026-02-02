const { Client, LocalAuth } = require('whatsapp-web.js');
const config = require('./config');
const { sleep } = require('./utils/delay');

/**
 * Crea y configura el cliente de WhatsApp
 * Configuración basada en la original que funcionaba
 */
function createClient() {
    const puppeteerConfig = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    };

    // Usar Chromium del sistema en Railway/Docker
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './wwebjs_auth'
        }),
        puppeteer: puppeteerConfig
    });

    return client;
}

/**
 * Configura reconexión con backoff exponencial
 */
function setupReconnection(client, onReconnect) {
    let reconnectAttempts = 0;

    client.on('disconnected', async (reason) => {
        console.log('❌ Bot desconectado:', reason);

        if (reconnectAttempts >= config.RECONNECT.MAX_ATTEMPTS) {
            console.log('⛔ Máximo de intentos de reconexión alcanzado');
            process.exit(1);
        }

        const delay = Math.min(
            config.RECONNECT.INITIAL_DELAY * Math.pow(config.RECONNECT.MULTIPLIER, reconnectAttempts),
            config.RECONNECT.MAX_DELAY
        );

        reconnectAttempts++;
        console.log(`🔄 Intentando reconectar en ${delay/1000}s (intento ${reconnectAttempts}/${config.RECONNECT.MAX_ATTEMPTS})...`);

        await sleep(delay);

        try {
            await client.initialize();
            reconnectAttempts = 0;
            if (onReconnect) onReconnect();
        } catch (error) {
            console.error('❌ Error en reconexión:', error.message);
        }
    });

    client.on('ready', () => {
        reconnectAttempts = 0;
    });
}

module.exports = {
    createClient,
    setupReconnection
};
