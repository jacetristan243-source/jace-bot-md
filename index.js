require('./config');
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    jidNormalizedUser 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const NodeCache = require('node-cache');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const handler = require('./handler');

// ========== FONCTION FORMAT RUNTIME ==========
function formatRuntime(seconds) {
    const jours = Math.floor(seconds / 86400);
    const heures = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secondes = Math.floor(seconds % 60);
    return `${jours}j ${heures}h ${minutes}m ${secondes}s`;
}

// ==================== CORRECTION BUG LID (ADMIN NON RECONNU) ====================
let lidMap = new Map();

function loadLidMapping(authFolder) {
    try {
        const files = fs.readdirSync(authFolder);
        const lidFile = files.find(f => f.startsWith('lid-mapping-') && f.endsWith('_reverse.json'));
        if (lidFile) {
            const data = fs.readFileSync(path.join(authFolder, lidFile), 'utf8');
            const json = JSON.parse(data);
            lidMap = new Map(Object.entries(json));
            console.log('✅ Mapping LID chargé :', lidMap.size, 'entrées');
            return true;
        }
        console.log('⚠️ Aucun fichier LID trouvé - mode normal');
        return false;
    } catch (err) {
        console.log('⚠️ Erreur chargement LID:', err.message);
        return false;
    }
}

function resolveJid(jid, sock) {
    if (!jid) return jid;
    if (jid.includes('@s.whatsapp.net')) return jid;
    if (jid.includes('@lid')) {
        const number = lidMap.get(jid);
        if (number) return number + '@s.whatsapp.net';
        try {
            const store = sock.store;
            if (store && store.contacts) {
                const contact = Object.values(store.contacts).find(c => c.id === jid);
                if (contact && contact.phoneNumber) return contact.phoneNumber + '@s.whatsapp.net';
            }
        } catch (e) {}
    }
    return jid;
}

async function isAdmin(sock, groupId, userId) {
    try {
        const realUserId = resolveJid(userId, sock);
        const metadata = await sock.groupMetadata(groupId);
        const participant = metadata.participants.find(p => {
            const pJid = resolveJid(p.id, sock);
            return pJid === realUserId || p.id === userId;
        });
        return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
    } catch (err) {
        console.error('❌ Erreur vérification admin:', err.message);
        return false;
    }
}

async function isBotAdmin(sock, groupId) {
    try {
        const botId = sock.user.id;
        const metadata = await sock.groupMetadata(groupId);
        const botParticipant = metadata.participants.find(p => p.id === botId);
        return botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');
    } catch (err) {
        return false;
    }
}

function getMentionedIds(msg) {
    const mentions = [];
    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentions.push(...msg.message.extendedTextMessage.contextInfo.mentionedJid);
    }
    return mentions;
}

function getQuotedId(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

global.isAdmin = isAdmin;
global.isBotAdmin = isBotAdmin;
global.getMentionedIds = getMentionedIds;
global.getQuotedId = getQuotedId;
global.resolveJid = resolveJid;
global.lidMap = lidMap;
// ==================== FIN CORRECTION BUG LID ====================

// --- BOUCLIER ANTI-CRASH ---
process.on('uncaughtException', (err) => { console.error('⚠️ ERREUR CRITIQUE : ', err); });
process.on('unhandledRejection', (reason) => { console.error('⚠️ REJET NON GÉRÉ : ', reason); });

// --- INITIALISATION TELEGRAM ---
console.log(`--- DÉMARRAGE DE ${global.botName} ---`);

let tgBot;
try {
    tgBot = new TelegramBot(global.api.tgToken, { polling: true });
    console.log("✅ Bot Telegram initialisé.");
    tgBot.getMe().then((me) => {
        console.log(`🤖 Connecté sur Telegram : @${me.username}`);
    }).catch((err) => {
        console.error("❌ Erreur Telegram Token :", err.message);
    });
} catch (err) {
    console.error("❌ Échec Telegram :", err.message);
}

const genAI = new GoogleGenerativeAI(global.api.gemini);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const logger = pino({ level: 'silent' });
const msgRetryCounterCache = new NodeCache();

// ========== VARIABLES STATISTIQUES ==========
let connectedUsers = {};
let systemStats = {
    weeklyConnections: 0,
    maxWeeklyConnections: 100,
    weekStartDate: new Date().toISOString().split('T')[0],
    totalConnections: 0,
    maintenance: false,
    maintenanceMessage: ""
};

// --- FONCTION DE CONNEXION WHATSAPP AVEC KEEP-ALIVE ---
async function startWhatsApp(chatId, phoneNumber) {
    console.log(`⏳ Tentative de connexion WhatsApp pour : ${phoneNumber}`);
    const authFolder = `auth_info_${phoneNumber}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    loadLidMapping(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        markOnlineOnConnect: true,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`❌ Connexion fermée. Raison : ${reason}`);
            
            if (reason !== 401) {
                console.log('🔄 Reconnexion automatique dans 5 secondes...');
                setTimeout(() => startWhatsApp(chatId, phoneNumber), 5000);
            } else {
                console.log('⚠️ Session invalide (401). Supprime le dossier auth_info_... et redémarre.');
                if (tgBot) tgBot.sendMessage(chatId, "❌ *Session WhatsApp expirée.*\nSupprime le dossier auth et refais /pair.");
            }
        } else if (connection === 'open') {
            console.log("✅ WhatsApp Connecté !");
            if (tgBot) tgBot.sendMessage(chatId, `✅ *WhatsApp Connecté avec succès !*`);
            
            const botNumber = jidNormalizedUser(sock.user.id);
            await sock.sendMessage(botNumber, {
                text: `👋 Bienvenue ! Tu viens de te connecter au bot avec succès ✅\n\n🎉 Heureux de te voir ici ! Utilise le menu ou tape .menu pour découvrir toutes les commandes.\n\n⚡ Amuse-toi bien et profite des fonctionnalités !`
            });
        }

        if (!sock.authState.creds.registered && phoneNumber) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    console.log(`🔑 Code de couplage généré : ${code}`);
                    if (tgBot) tgBot.sendMessage(chatId, `🔑 *VOTRE CODE DE COUPLAGE :*\n\n\`${code}\`\n\nEntrez ce code sur votre téléphone pour connecter WhatsApp.`, { parse_mode: 'Markdown' });
                } catch (err) { 
                    console.error("❌ Erreur Pairing Code :", err.message);
                    if (tgBot) tgBot.sendMessage(chatId, "❌ Erreur lors de la génération du code. Réessayez."); 
                }
            }, 3000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ========== ANTI CALL ==========
    sock.ev.on('call', async (call) => {
        if (!global.antiCall) return;
        
        const callerId = call[0].from;
        const isGroup = call[0].isGroup;
        
        if (!isGroup) {
            console.log(`📞 Appel de ${callerId} - Bloqué automatiquement`);
            
            try {
                await sock.rejectCall(call[0].id, callerId);
                await sock.updateBlockStatus(callerId, "block");
                await sock.sendMessage(callerId, { 
                    text: "🚫 *Appel automatiquement rejeté*\n\nCe numéro est géré par un bot. Les appels ne sont pas acceptés.\n\n_🤖 JACE BOT MD_" 
                });
            } catch (e) {
                console.error("Erreur Anti Call:", e.message);
            }
        }
    });

    // --- LOGS DE GROUPE AVANCÉS (AVEC APPEL AU HANDLER GROUPE) ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if (handler.groupeHandler) {
                handler.groupeHandler.execute(sock, anu);
            }
            
            let metadata = await sock.groupMetadata(anu.id);
            let participants = anu.participants;
            for (let num of participants) {
                if (anu.action === 'add') {
                    await sock.sendMessage(anu.id, { text: `👋 Bienvenue @${num.split('@')[0]} dans *${metadata.subject}* ! 🎉\n\nTape .menu pour voir mes commandes.`, mentions: [num] });
                } else if (anu.action === 'remove') {
                    await sock.sendMessage(anu.id, { text: `👋 Au revoir @${num.split('@')[0]}... On espère te revoir bientôt ! 😢`, mentions: [num] });
                } else if (anu.action === 'promote') {
                    await sock.sendMessage(anu.id, { text: `🛡️ Félicitations @${num.split('@')[0]}, tu es désormais *Administrateur* ! 👏`, mentions: [num] });
                } else if (anu.action === 'demote') {
                    await sock.sendMessage(anu.id, { text: `👞 @${num.split('@')[0]} a été destitué de ses fonctions d'administrateur.`, mentions: [num] });
                }
            }
        } catch (err) { console.error(err); }
    });

    sock.ev.on('groups.update', async (anu) => {
        try {
            for (let res of anu) {
                if (res.subject) await sock.sendMessage(res.id, { text: `📌 Le nom du groupe a été changé en : *${res.subject}*` });
                if (res.announce === true) await sock.sendMessage(res.id, { text: `🔒 Le groupe est désormais fermé (Admins seulement).` });
                if (res.announce === false) await sock.sendMessage(res.id, { text: `🔓 Le groupe est désormais ouvert à tous.` });
            }
        } catch (err) { console.error(err); }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;

        // --- AUTO STATUS AVEC RÉACTION 🔥 ---
        if (from === 'status@broadcast') {
            if (global.settings?.autoStatus) {
                try {
                    await sock.readMessages([m.key]);
                    await sock.sendMessage(from, { react: { key: m.key, text: "🔥" } }, { statusJidList: [m.key.participant] });
                } catch (err) { console.error(err.message); }
            }
            return;
        }

        if (m.key.fromMe) return;

        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        if (text === "/start" || text === ".start" || text === "!start") {
            await sock.sendMessage(from, {
                text: `👋 Bienvenue sur JACE BOT MD ⚡\n\nPour utiliser le bot, rejoins nos communautés 👇\n\n💬 Groupe :\nhttps://chat.whatsapp.com/IVYanye6he9IpFhBs40YvQ?mode=gi_t\n\n📢 Chaînes :\n1) https://whatsapp.com/channel/0029VbCXMvYA89MdF7qeyw26\n2) https://whatsapp.com/channel/0029Vb7SNDUEgGfTglfyns3y\n\n⚡ Après ça, tape .menu`
            });
            return;
        }

        try {
            await handler(sock, m, { model });
        } catch (err) {
            console.error("❌ Erreur dans le Handler WhatsApp :", err);
        }
    });
}

// --- COMMANDES TELEGRAM ---
if (tgBot) {
    tgBot.onText(/\/start/, (msg) => {
        const welcomeMsg = `🤖 *${global.botName}* ✅\n\n👋 *Bienvenue !* Je suis prêt à vous aider.\n\n🚀 *Pour connecter WhatsApp :*\nTapez \`/pair [votre_numéro]\` (ex: \`/pair 241065491629\`) pour recevoir votre code de couplage.\n\n📌 *Autres commandes :*\n• /menu - Voir les commandes WhatsApp\n• /ping - Tester la latence\n• /alive - Vérifier le statut\n• /runtime - Voir le temps d'exécution\n\n⚡ *Rejoignez-nous :*\n💬 [Groupe WhatsApp](https://chat.whatsapp.com/IVYanye6he9IpFhBs40YvQ?mode=gi_t)\n📢 [Chaîne Officielle](https://whatsapp.com/channel/0029VbCXMvYA89MdF7qeyw26)`;
        tgBot.sendMessage(msg.chat.id, welcomeMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    });

    tgBot.onText(/\/pair (.+)/, async (msg, match) => {
        const phoneNumber = match[1].replace(/\D/g, '');
        if (phoneNumber.length < 8) return tgBot.sendMessage(msg.chat.id, "❌ Numéro invalide.");
        tgBot.sendMessage(msg.chat.id, `⏳ Génération du code pour *+${phoneNumber}*...`, { parse_mode: 'Markdown' });
        await startWhatsApp(msg.chat.id, phoneNumber);
    });

    // ========== COMMANDE /ping ==========
    tgBot.onText(/\/ping/, (msg) => {
        const start = Date.now();
        tgBot.sendMessage(msg.chat.id, "🏓 Ping...").then(sentMsg => {
            const end = Date.now();
            tgBot.editMessageText(`🏓 *Pong !*\n📡 ${end - start} ms`, {
                chat_id: msg.chat.id,
                message_id: sentMsg.message_id,
                parse_mode: 'Markdown'
            }).catch(() => {
                tgBot.sendMessage(msg.chat.id, `🏓 *Pong !*\n📡 ${end - start} ms`, { parse_mode: 'Markdown' });
            });
        });
    });

    // ========== COMMANDE /alive ==========
    tgBot.onText(/\/alive/, (msg) => {
        const uptime = formatRuntime(process.uptime());
        tgBot.sendMessage(msg.chat.id, `🤖 *JACE BOT MD* est en ligne !\n\n⏱️ Runtime : ${uptime}\n👑 Owner : ${global.namaOwner}\n📌 Mode : ${global.mode === 'public' ? '🌍 Public' : '🔒 Privé'}`, { parse_mode: 'Markdown' });
    });

    // ========== COMMANDE /runtime ==========
    tgBot.onText(/\/runtime/, (msg) => {
        const uptime = formatRuntime(process.uptime());
        tgBot.sendMessage(msg.chat.id, `⏱️ *Runtime du bot :* ${uptime}`, { parse_mode: 'Markdown' });
    });

    // ========== COMMANDE /stats (ADMIN) ==========
    tgBot.onText(/\/stats/, (msg) => {
        const senderId = msg.from.id.toString();
        
        if (!global.adminTelegramIds.includes(senderId)) {
            return tgBot.sendMessage(msg.chat.id, "❌ Accès refusé. Commande réservée à l'administrateur.");
        }
        
        const activeNow = Object.values(connectedUsers || {}).filter(u => u.status === 'online').length;
        const totalConnections = Object.keys(connectedUsers || {}).length;
        
        let statsMsg = `📊 *STATISTIQUES JACE BOT MD*\n\n`;
        statsMsg += `👥 Connexions cette semaine : ${systemStats?.weeklyConnections || 0}/${systemStats?.maxWeeklyConnections || 100}\n`;
        statsMsg += `🟢 Actifs maintenant : ${activeNow}\n`;
        statsMsg += `📈 Total connexions : ${systemStats?.totalConnections || totalConnections}\n`;
        statsMsg += `🔧 Mode maintenance : ${systemStats?.maintenance ? 'ON' : 'OFF'}\n`;
        statsMsg += `📅 Semaine du : ${systemStats?.weekStartDate || new Date().toISOString().split('T')[0]}`;
        
        tgBot.sendMessage(msg.chat.id, statsMsg, { parse_mode: 'Markdown' });
    });
}