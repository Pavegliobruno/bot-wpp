const config = require('../config');

// Almacena historial de mensajes sospechosos por usuario
const mensajesSospechosos = new Map();

/**
 * Detecta si un mensaje es spam de inversiones
 * @param {string} texto - Texto del mensaje
 * @returns {boolean} - true si es spam
 */
function esSpamDeInversiones(texto) {
    const textoLower = texto.toLowerCase();

    // Debe contener URL de grupo de WhatsApp
    const tieneUrlGrupo = textoLower.includes('chat.whatsapp.com') ||
                          textoLower.includes('wa.me');

    if (!tieneUrlGrupo) return false;

    // Contar palabras de inversión
    let contadorPalabrasInversion = 0;
    config.PALABRAS_INVERSIONES.forEach(palabra => {
        if (textoLower.includes(palabra.toLowerCase())) {
            contadorPalabrasInversion++;
        }
    });

    // Verificar frases sospechosas
    const tieneFraseSospechosa = config.FRASES_SPAM.some(frase =>
        textoLower.includes(frase.toLowerCase())
    );

    return (contadorPalabrasInversion >= 2 || tieneFraseSospechosa);
}

/**
 * Registra un mensaje sospechoso y verifica si el usuario es spammer
 * @param {string} userId - ID del usuario
 * @param {object} chatInfo - Información del chat
 * @param {Message} msg - Mensaje original
 * @returns {object} - Resultado del análisis
 */
function registrarMensajeSospechoso(userId, chatInfo, msg) {
    if (!mensajesSospechosos.has(userId)) {
        mensajesSospechosos.set(userId, []);
    }

    const historialUsuario = mensajesSospechosos.get(userId);
    const now = Date.now();

    // Filtrar solo mensajes recientes dentro de la ventana de tiempo
    const mensajesRecientes = historialUsuario.filter(
        m => now - m.timestamp < config.TIME_WINDOW
    );

    // Agregar nuevo mensaje
    mensajesRecientes.push({
        groupId: chatInfo.id,
        groupName: chatInfo.name,
        timestamp: now,
        messageId: msg.id._serialized,
        message: msg
    });

    mensajesSospechosos.set(userId, mensajesRecientes);

    // Calcular grupos únicos
    const gruposUnicos = new Set(mensajesRecientes.map(m => m.groupId));

    return {
        esSpammer: gruposUnicos.size >= config.MIN_GRUPOS,
        gruposUnicos: gruposUnicos.size,
        minGrupos: config.MIN_GRUPOS,
        mensajesRecientes
    };
}

/**
 * Elimina el historial de un usuario (después de confirmar como spammer)
 * @param {string} userId - ID del usuario
 */
function limpiarUsuario(userId) {
    mensajesSospechosos.delete(userId);
}

/**
 * Limpia mensajes expirados de todos los usuarios
 * @returns {number} - Cantidad de usuarios limpiados
 */
function limpiarMensajesExpirados() {
    const now = Date.now();
    let limpiados = 0;

    for (const [userId, mensajes] of mensajesSospechosos.entries()) {
        const recientes = mensajes.filter(m => now - m.timestamp < config.TIME_WINDOW);
        if (recientes.length === 0) {
            mensajesSospechosos.delete(userId);
            limpiados++;
        } else {
            mensajesSospechosos.set(userId, recientes);
        }
    }

    return limpiados;
}

/**
 * Inicia limpieza periódica del detector
 */
function iniciarLimpiezaPeriodica() {
    setInterval(() => {
        const limpiados = limpiarMensajesExpirados();
        if (limpiados > 0) {
            console.log(`🧹 Detector limpiado (${limpiados} usuarios eliminados del tracking)`);
        }
    }, config.CACHE.CLEANUP_INTERVAL);
}

module.exports = {
    esSpamDeInversiones,
    registrarMensajeSospechoso,
    limpiarUsuario,
    limpiarMensajesExpirados,
    iniciarLimpiezaPeriodica
};
