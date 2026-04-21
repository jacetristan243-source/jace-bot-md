const fs = require('fs');
const path = require('path');

// --- GESTION DES COMMANDES ---
const commands = new Map();

/**
 * Enregistre une commande
 * @param {Object} cmd - Objet de la commande
 */
function registerCommand(cmd) {
    if (!cmd.name) return;
    commands.set(cmd.name.toLowerCase(), cmd);
    if (cmd.alias && Array.isArray(cmd.alias)) {
        cmd.alias.forEach(a => commands.set(a.toLowerCase(), cmd));
    }
}

/**
 * Récupère une commande par son nom ou alias
 * @param {string} name - Nom ou alias de la commande
 * @returns {Object|null}
 */
function getCommand(name) {
    return commands.get(name.toLowerCase()) || null;
}

/**
 * Liste toutes les commandes uniques
 * @returns {Array}
 */
function listCommands() {
    const unique = new Set(commands.values());
    return Array.from(unique);
}

module.exports = {
    registerCommand,
    getCommand,
    listCommands,
    commands
};
