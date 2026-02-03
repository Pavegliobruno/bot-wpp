const config = require('../config');
const { responseDelay, actionDelay } = require('../utils/delay');
const { getCachedChat, getCachedContact } = require('../utils/cache');
const {
    esSpamDeInversiones,
    registrarMensajeSospechoso,
    limpiarUsuario
} = require('../utils/spamDetector');

/**
 * Handler principal para mensajes
 * @param {Client} client - Cliente de WhatsApp
 * @param {Message} msg - Mensaje recibido
 */
async function handleMessage(client, msg) {
    try {
        // Delay humanizado antes de procesar
        await responseDelay();

        // Obtener chat con cache
        const chat = await getCachedChat(msg);

        // Solo procesar mensajes de grupo
        if (!chat.isGroup) return;

        // Verificar si somos admin del grupo
        const me = client.info;
        const participant = chat.participants.find(p => p.id._serialized === me.wid._serialized);
        if (!participant || !participant.isAdmin) return;

        // Obtener contacto con cache
        const contact = await getCachedContact(msg);
        const userId = contact.id._serialized;
        const messageText = msg.body.trim();

        // Ignorar mensajes vacíos, propios o de whitelist
        if (!messageText || msg.fromMe || config.WHITELIST.includes(userId)) return;

        // Ignorar mensajes de admins
        const sender = chat.participants.find(p => p.id._serialized === userId);
        if (sender && sender.isAdmin) return;

        // Detectar spam
        if (esSpamDeInversiones(messageText)) {
            logMensajeSospechoso(contact, chat);

            const resultado = registrarMensajeSospechoso(
                userId,
                { id: chat.id._serialized, name: chat.name },
                msg
            );

            console.log(`   📊 Total de spam en ${resultado.gruposUnicos} grupo(s) diferentes`);

            if (resultado.esSpammer) {
                await manejarSpammerConfirmado(contact, chat, messageText, resultado);
                limpiarUsuario(userId);
            } else {
                console.log(`   ⏳ Esperando actividad en más grupos (${resultado.gruposUnicos}/${resultado.minGrupos})`);
            }
        }

    } catch (error) {
        // Ignorar errores de timeout silenciosamente (son comunes y no críticos)
        if (error.message.includes('timed out') || error.message.includes('timeout')) {
            console.log('⚠️ Timeout procesando mensaje - ignorando');
            return;
        }
        console.error('❌ Error procesando mensaje:', error.message);
    }
}

/**
 * Log de mensaje sospechoso
 */
function logMensajeSospechoso(contact, chat) {
    console.log(`\n🔍 Mensaje sospechoso detectado`);
    console.log(`   👤 Usuario: ${contact.pushname || contact.number}`);
    console.log(`   📱 Número: ${contact.number}`);
    console.log(`   📂 Grupo: ${chat.name}`);
    console.log(`   🕐 Hora: ${new Date().toLocaleString()}`);
}

/**
 * Maneja un spammer confirmado
 */
async function manejarSpammerConfirmado(contact, chat, messageText, resultado) {
    console.log(`\n🚨 ================ SPAMMER CONFIRMADO ================`);
    console.log(`👤 Usuario: ${contact.pushname || 'Sin nombre'}`);
    console.log(`📱 Teléfono: ${contact.number}`);
    console.log(`📊 Grupos afectados: ${resultado.gruposUnicos}`);
    console.log(`📝 Grupos:`);

    resultado.mensajesRecientes.forEach(m => {
        console.log(`   - ${m.groupName}`);
    });

    console.log(`💬 Mensaje spam:`);
    console.log(`   "${messageText.substring(0, 200)}..."`);
    console.log(`\n⏰ Timestamps de los mensajes:`);

    resultado.mensajesRecientes.forEach(m => {
        console.log(`   - ${m.groupName}: ${new Date(m.timestamp).toLocaleString()}`);
    });

    if (config.SOLO_LOGS) {
        console.log(`\n🔒 MODO SOLO LOGS - NO se tomaron acciones`);
        console.log(`✅ En modo producción se haría:`);
        console.log(`   1. Citar mensaje con: "${config.MENSAJE_SPAM.substring(0, 50)}..."`);
        console.log(`   2. Eliminar mensaje original`);
        console.log(`   3. Expulsar usuario de:`);
        resultado.mensajesRecientes.forEach(m => {
            console.log(`      - ${m.groupName}`);
        });
    } else {
        // Tomar acciones contra el spammer
        console.log(`\n⚡ EJECUTANDO ACCIONES...`);

        for (const registro of resultado.mensajesRecientes) {
            try {
                // 1. Responder/citar el mensaje de spam (queda visible como preview)
                await actionDelay();
                await registro.message.reply(config.MENSAJE_SPAM);
                console.log(`   💬 Mensaje citado en: ${registro.groupName}`);

                // 2. Eliminar mensaje de spam original
                await actionDelay();
                await registro.message.delete(true);
                console.log(`   🗑️ Mensaje eliminado en: ${registro.groupName}`);

                // 3. Obtener el chat actualizado para expulsar
                await actionDelay();
                const chatActual = await registro.message.getChat();

                // 4. Expulsar al usuario
                await chatActual.removeParticipants([contact.id._serialized]);
                console.log(`   👢 Usuario expulsado de: ${registro.groupName}`);

            } catch (error) {
                console.error(`   ❌ Error en ${registro.groupName}: ${error.message}`);
            }
        }

        console.log(`\n✅ Acciones completadas`);
    }

    console.log(`====================================================\n`);
}

module.exports = {
    handleMessage
};
