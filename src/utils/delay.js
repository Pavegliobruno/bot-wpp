const config = require('../config');

/**
 * Genera un delay aleatorio entre min y max milisegundos
 * para simular comportamiento humano
 */
function humanDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Delay antes de responder a un mensaje
 */
async function responseDelay() {
    return humanDelay(
        config.DELAYS.MIN_RESPONSE,
        config.DELAYS.MAX_RESPONSE
    );
}

/**
 * Delay entre acciones consecutivas
 */
async function actionDelay() {
    return humanDelay(
        config.DELAYS.MIN_ACTION,
        config.DELAYS.MAX_ACTION
    );
}

/**
 * Simula tiempo de escritura
 */
async function typingDelay() {
    return humanDelay(
        config.DELAYS.TYPING_MIN,
        config.DELAYS.TYPING_MAX
    );
}

/**
 * Sleep simple (sin variación)
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    humanDelay,
    responseDelay,
    actionDelay,
    typingDelay,
    sleep
};
