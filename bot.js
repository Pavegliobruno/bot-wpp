const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './wwebjs_auth' // Persistencia de sesión
    }),
    puppeteer: {
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
    }
});

// 🎯 CONFIGURACIÓN
const PALABRAS_INVERSIONES = [
    'inversiones', 'inversores', 'inversionistas', 'señales de inversión',
    'trading', 'acciones', 'bolsa', 'bursátil', 'criptomonedas', 'cripto',
    'fondos', 'análisis técnico', 'análisis financiero',
    'investment', 'investors', 'stocks', 'cryptocurrencies', 'crypto',
    'funds', 'signals', 'financial', 'portfolio',
    'investoren', 'aktien', 'kryptowährungen', 'investmentfonds', 'finanz',
    'bitcoin', 'forex', 'futures', 'profit', 'ganancias', 'rendimiento'
];

const FRASES_SPAM = [
    'grupo de debate sobre inversiones', 'investment discussion group',
    'grupo de discusión sobre acciones', 'professional investors',
    'inversores profesionales', 'investment enthusiasts',
    'no spam', 'sin spam', 'kein spam',
    'totalmente gratuito', 'völlig kostenlos', 'totally free'
];

const MIN_GRUPOS = 2;
const TIME_WINDOW = 300000; // 5 minutos
const WHITELIST = [];

const mensajesSospechosos = new Map();
const notificacionesEnviadas = new Set();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function esSpamDeInversiones(texto) {
    const textoLower = texto.toLowerCase();
    
    const tieneUrlGrupo = textoLower.includes('chat.whatsapp.com') || 
                          textoLower.includes('wa.me');
    
    if (!tieneUrlGrupo) return false;
    
    let contadorPalabrasInversion = 0;
    PALABRAS_INVERSIONES.forEach(palabra => {
        if (textoLower.includes(palabra.toLowerCase())) {
            contadorPalabrasInversion++;
        }
    });
    
    let tieneFraseSospechosa = FRASES_SPAM.some(frase => 
        textoLower.includes(frase.toLowerCase())
    );
    
    return (contadorPalabrasInversion >= 2 || tieneFraseSospechosa);
}

async function notificarAdmins(chat, spammerInfo, mensajesRecientes) {
    const admins = chat.participants.filter(p => p.isAdmin);
    
    const notifId = `${spammerInfo.userId}-${Date.now()}`;
    if (notificacionesEnviadas.has(notifId)) return;
    notificacionesEnviadas.add(notifId);
    
    const gruposAfectados = [...new Set(mensajesRecientes.map(m => m.groupName))];
    
    const mensaje = `🚨 *SPAM DETECTADO*\n\n` +
                   `👤 Usuario: ${spammerInfo.nombre}\n` +
                   `📱 Teléfono: ${spammerInfo.telefono}\n` +
                   `📊 Grupos afectados: ${gruposAfectados.length}\n` +
                   `${gruposAfectados.map(g => `  • ${g}`).join('\n')}\n\n` +
                   `📝 Mensaje: "${spammerInfo.mensaje.substring(0, 150)}..."\n\n` +
                   `⚠️ Recomiendo eliminar este usuario del grupo.`;
    
    for (const admin of admins) {
        try {
            await client.sendMessage(admin.id._serialized, mensaje);
            console.log(`   ✅ Notificación enviada a admin: ${admin.id.user}`);
            await sleep(2000);
        } catch (error) {
            console.log(`   ⚠️ No se pudo notificar a admin:`, error.message);
        }
    }
}

client.on('qr', qr => {
    console.log('📱 Escanea este QR con WhatsApp:');
    console.log('');
    qrcode.generate(qr, {small: true});
    console.log('');
    console.log('⚠️ IMPORTANTE: Escanea este QR desde tu WhatsApp en los próximos 60 segundos');
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa! Sesión guardada.');
});

client.on('ready', () => {
    console.log('');
    console.log('✅ ========================================');
    console.log('✅ Bot anti-spam activo (modo notificación)');
    console.log('✅ Solo notificará a admins');
    console.log('✅ NO eliminará automáticamente');
    console.log('✅ ========================================');
    console.log('');
});

client.on('message_create', async msg => {
    try {
        const chat = await msg.getChat();
        
        if (!chat.isGroup) return;
        
        const me = await client.info;
        const participant = chat.participants.find(p => p.id._serialized === me.wid._serialized);
        if (!participant || !participant.isAdmin) return;
        
        const contact = await msg.getContact();
        const userId = contact.id._serialized;
        const messageText = msg.body.trim();
        
        if (!messageText || msg.fromMe || WHITELIST.includes(userId)) return;
        
        const sender = chat.participants.find(p => p.id._serialized === userId);
        if (sender && sender.isAdmin) return;
        
        if (esSpamDeInversiones(messageText)) {
            console.log(`\n🔍 Mensaje sospechoso de ${contact.pushname || contact.number}`);
            
            if (!mensajesSospechosos.has(userId)) {
                mensajesSospechosos.set(userId, []);
            }
            
            const historialUsuario = mensajesSospechosos.get(userId);
            const now = Date.now();
            
            const mensajesRecientes = historialUsuario.filter(
                m => now - m.timestamp < TIME_WINDOW
            );
            
            mensajesRecientes.push({
                groupId: chat.id._serialized,
                groupName: chat.name,
                timestamp: now,
                messageId: msg.id._serialized,
                message: msg
            });
            
            mensajesSospechosos.set(userId, mensajesRecientes);
            
            const gruposUnicos = new Set(mensajesRecientes.map(m => m.groupId));
            console.log(`   📊 Spam detectado en ${gruposUnicos.size} grupo(s)`);
            
            if (gruposUnicos.size >= MIN_GRUPOS) {
                console.log(`\n🚨 ¡SPAMMER CONFIRMADO!`);
                console.log(`👤 Usuario: ${contact.pushname || contact.number}`);
                console.log(`📱 Grupos afectados:`);
                mensajesRecientes.forEach(m => {
                    console.log(`   - ${m.groupName}`);
                });
                
                await notificarAdmins(chat, {
                    userId: userId,
                    nombre: contact.pushname || 'Sin nombre',
                    telefono: contact.number,
                    mensaje: messageText
                }, mensajesRecientes);
                
                console.log(`✅ Admins notificados\n`);
                
                mensajesSospechosos.delete(userId);
            }
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje:', error.message);
    }
});

// Limpiar memoria cada 10 minutos
setInterval(() => {
    const now = Date.now();
    let limpiados = 0;
    
    for (const [userId, mensajes] of mensajesSospechosos.entries()) {
        const recientes = mensajes.filter(m => now - m.timestamp < TIME_WINDOW);
        if (recientes.length === 0) {
            mensajesSospechosos.delete(userId);
            limpiados++;
        } else {
            mensajesSospechosos.set(userId, recientes);
        }
    }
    
    if (limpiados > 0) {
        console.log(`🧹 Memoria limpiada (${limpiados} usuarios)`);
    }
}, 600000);

client.on('disconnected', (reason) => {
    console.log('❌ Bot desconectado:', reason);
    console.log('🔄 Intentando reconectar...');
});

// Healthcheck para Railway
const http = require('http');
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🏥 Healthcheck server running on port ${PORT}`);
});

// Inicializar cliente
console.log('🚀 Iniciando bot...');
client.initialize();
