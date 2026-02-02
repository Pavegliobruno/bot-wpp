/**
 * Bot Anti-Spam para WhatsApp
 *
 * Este archivo se mantiene como wrapper para compatibilidad.
 * La lógica principal está en src/index.js
 */

const { main } = require('./src/index');

main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
