module.exports = {
    // Palabras clave de inversiones (multiidioma)
    PALABRAS_INVERSIONES: [
        'inversiones', 'inversores', 'inversionistas', 'señales de inversión',
        'trading', 'acciones', 'bolsa', 'bursátil', 'criptomonedas', 'cripto',
        'fondos', 'análisis técnico', 'análisis financiero',
        'investment', 'investors', 'stocks', 'cryptocurrencies', 'crypto',
        'funds', 'signals', 'financial', 'portfolio',
        'investoren', 'aktien', 'kryptowährungen', 'investmentfonds', 'finanz',
        'bitcoin', 'forex', 'futures', 'profit', 'ganancias', 'rendimiento'
    ],

    // Frases sospechosas comunes en spam
    FRASES_SPAM: [
        'grupo de debate sobre inversiones', 'investment discussion group',
        'grupo de discusión sobre acciones', 'professional investors',
        'inversores profesionales', 'investment enthusiasts',
        'no spam', 'sin spam', 'kein spam',
        'totalmente gratuito', 'völlig kostenlos', 'totally free'
    ],

    // Configuración de detección
    MIN_GRUPOS: 1,                    // Mínimo de grupos para confirmar spammer
    TIME_WINDOW: 300000,              // Ventana de tiempo (5 minutos)
    WHITELIST: [],                    // IDs de usuarios a ignorar

    // Modo de operación
    SOLO_LOGS: false,                  // true = solo logs, false = notifica admins

    // Configuración de delays humanizados (en ms)
    DELAYS: {
        MIN_RESPONSE: 1000,           // Mínimo delay antes de procesar
        MAX_RESPONSE: 3000,           // Máximo delay antes de procesar
        MIN_ACTION: 500,              // Mínimo delay entre acciones
        MAX_ACTION: 1500,             // Máximo delay entre acciones
        TYPING_MIN: 1000,             // Mínimo tiempo "escribiendo"
        TYPING_MAX: 3000              // Máximo tiempo "escribiendo"
    },

    // Configuración de cache
    CACHE: {
        TTL: 300000,                  // 5 minutos TTL
        CLEANUP_INTERVAL: 600000      // Limpiar cada 10 minutos
    },

    // Configuración de reconexión
    RECONNECT: {
        MAX_ATTEMPTS: 5,              // Máximo intentos de reconexión
        INITIAL_DELAY: 5000,          // Delay inicial (5 segundos)
        MAX_DELAY: 300000,            // Máximo delay (5 minutos)
        MULTIPLIER: 2                 // Multiplicador exponencial
    },

    // Configuración del servidor de healthcheck
    PORT: process.env.PORT || 3000
};
