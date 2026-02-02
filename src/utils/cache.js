const config = require('../config');

class Cache {
    constructor(ttl = config.CACHE.TTL) {
        this.cache = new Map();
        this.ttl = ttl;
    }

    /**
     * Obtiene un valor del cache
     * @param {string} key - Clave del elemento
     * @returns {any|null} - Valor o null si no existe/expiró
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    /**
     * Guarda un valor en cache
     * @param {string} key - Clave del elemento
     * @param {any} value - Valor a guardar
     * @param {number} ttl - TTL personalizado (opcional)
     */
    set(key, value, ttl = this.ttl) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    /**
     * Elimina un elemento del cache
     * @param {string} key - Clave del elemento
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * Limpia elementos expirados
     * @returns {number} - Cantidad de elementos eliminados
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }

    /**
     * Limpia todo el cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Obtiene el tamaño del cache
     */
    size() {
        return this.cache.size;
    }
}

// Caches específicos
const chatCache = new Cache();
const contactCache = new Cache();

/**
 * Obtiene un chat con cache
 * @param {Message} msg - Mensaje de WhatsApp
 * @returns {Promise<Chat>} - Chat
 */
async function getCachedChat(msg) {
    const chatId = msg.from || msg.to;
    let chat = chatCache.get(chatId);

    if (!chat) {
        chat = await msg.getChat();
        chatCache.set(chatId, chat);
    }

    return chat;
}

/**
 * Obtiene un contacto con cache
 * @param {Message} msg - Mensaje de WhatsApp
 * @returns {Promise<Contact>} - Contacto
 */
async function getCachedContact(msg) {
    const contactId = msg.author || msg.from;
    let contact = contactCache.get(contactId);

    if (!contact) {
        contact = await msg.getContact();
        contactCache.set(contactId, contact);
    }

    return contact;
}

/**
 * Inicia limpieza periódica del cache
 */
function startCacheCleanup() {
    setInterval(() => {
        const chatsCleaned = chatCache.cleanup();
        const contactsCleaned = contactCache.cleanup();

        if (chatsCleaned > 0 || contactsCleaned > 0) {
            console.log(`🧹 Cache limpiado: ${chatsCleaned} chats, ${contactsCleaned} contactos`);
        }
    }, config.CACHE.CLEANUP_INTERVAL);
}

module.exports = {
    Cache,
    chatCache,
    contactCache,
    getCachedChat,
    getCachedContact,
    startCacheCleanup
};
