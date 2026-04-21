require('./config');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');

// --- CONFIG GEMINI (TA CLÉ API) ---
const GEMINI_API_KEY = global.api?.gemini || "AIzaSyBDZ99nAaJOZ84GxMAVCXc5-tthmEXcBGQ";

// --- CHARGEMENT DES MODULES EXTERNES ---
let claudeHandler = null;
let voiceHandler = null;
let groupeHandler = null;
try { claudeHandler = require('./lib/claude.js'); } catch(e) { console.log('⚠️ Module Claude non trouvé'); }
try { voiceHandler = require('./lib/voice.js'); } catch(e) { console.log('⚠️ Module Voice non trouvé'); }
try { groupeHandler = require('./lib/groupe.js'); } catch(e) { console.log('⚠️ Module Groupe non trouvé'); }

// --- CHARGEMENT DES BASES DE DONNÉES ---
const loadDB = (file) => { try { return JSON.parse(fs.readFileSync(file)); } catch { return {}; } };
const saveDB = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

let levels = loadDB('./levels.json');
let economy = loadDB('./economy.json');
let aiMemory = loadDB('./ai_memory.json');
let antilinkDB = loadDB('./database/antilink.json');
let antitagDB = loadDB('./database/antitag.json');
let antispamDB = loadDB('./database/antispam.json');
let users = loadDB('./users.json');

if (!antilinkDB.groups) antilinkDB = { groups: {} };
if (!antitagDB.groups) antitagDB = { groups: {} };
if (!antispamDB.groups) antispamDB = { groups: {} };

// ========== SYSTÈME DE NIVEAUX FREE FIRE ==========
const rankNames = [
    "🥉 Bronze I", "🥉 Bronze II", "🥉 Bronze III",
    "🥈 Argent I", "🥈 Argent II", "🥈 Argent III",
    "🥇 Or I", "🥇 Or II", "🥇 Or III",
    "💎 Platine I", "💎 Platine II", "💎 Platine III",
    "💎 Platine IV", "💎 Platine V",
    "👑 Diamant I", "👑 Diamant II", "👑 Diamant III", "👑 Diamant IV", "👑 Diamant V",
    "🌟 Maître I", "🌟 Maître II", "🌟 Maître III", "🌟 Maître IV", "🌟 Maître V",
    "🔥 Grand Maître I", "🔥 Grand Maître II", "🔥 Grand Maître III", "🔥 Grand Maître IV", "🔥 Grand Maître V", "🔥 Grand Maître VI"
];

function getRankFromXP(xp) {
    let requiredXP = 100;
    let rankIndex = 0;
    while (xp >= requiredXP && rankIndex < rankNames.length - 1) {
        xp -= requiredXP;
        rankIndex++;
        requiredXP = Math.floor(requiredXP * 1.3);
    }
    return { name: rankNames[rankIndex], index: rankIndex, currentXP: xp, nextXP: requiredXP };
}

function getRankEmoji(rankIndex) {
    if (rankIndex < 3) return "🥉";
    if (rankIndex < 6) return "🥈";
    if (rankIndex < 9) return "🥇";
    if (rankIndex < 14) return "💎";
    if (rankIndex < 19) return "👑";
    if (rankIndex < 24) return "🌟";
    return "🔥";
}

// ========== ANTI SPAM ==========
const spamDetector = new Map();
function isSpam(sender, groupId) {
    const key = `${groupId}_${sender}`;
    const now = Date.now();
    if (!spamDetector.has(key)) { spamDetector.set(key, { count: 1, firstTime: now }); return false; }
    const data = spamDetector.get(key);
    if (now - data.firstTime > 5000) { spamDetector.set(key, { count: 1, firstTime: now }); return false; }
    data.count++;
    return data.count > 6;
}
function clearSpam(sender, groupId) { spamDetector.delete(`${groupId}_${sender}`); }

// ========== FONCTIONS UTILITAIRES ==========
function getMentionedIds(m) {
    const mentions = [];
    if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentions.push(...m.message.extendedTextMessage.contextInfo.mentionedJid);
    }
    return mentions;
}

function getQuotedId(m) {
    if (m.message?.extendedTextMessage?.contextInfo?.participant) {
        return m.message.extendedTextMessage.contextInfo.participant;
    }
    return null;
}

function isUrl(str) { return /(https?:\/\/[^\s]+)/g.test(str); }

function formatRuntime(seconds) {
    const jours = Math.floor(seconds / 86400);
    const heures = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secondes = Math.floor(seconds % 60);
    return `${jours}j ${heures}h ${minutes}m ${secondes}s`;
}

// ========== FONCTION CRITIQUE : RÉSOUDRE LES LID ==========
async function resolveLid(sock, jid) {
    if (!jid) return jid;
    if (jid.includes('@s.whatsapp.net')) return jid;
    if (jid.includes('@lid')) {
        try {
            const store = sock.store;
            if (store && store.contacts) {
                const contact = Object.values(store.contacts).find(c => c.id === jid);
                if (contact && contact.phoneNumber) return contact.phoneNumber + '@s.whatsapp.net';
            }
        } catch (e) {}
        return jid.split('@')[0] + '@s.whatsapp.net';
    }
    return jid;
}
// ========== HANDLER PRINCIPAL ==========
module.exports = async (sock, m, { model }) => {
    try {
        if (!m || !m.message) return;
        
        const from = jidNormalizedUser(m.key.remoteJid);
        const isGroup = from.endsWith('@g.us');
        
        const senderRaw = m.key.fromMe ? sock.user.id : (m.key.participant || m.key.remoteJid);
        const sender = jidNormalizedUser(senderRaw);
        
        const pushname = m.pushName || "Utilisateur";
        const budy = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || "";
        
        const botNumber = jidNormalizedUser(sock.user.id);
        
        // ========== DÉTECTION OWNER ET SUDO ==========
        const isOwner = global.owner.some(o => sender.includes(o)) || 
                        sender === botNumber || 
                        sender.includes('241065491629') || 
                        (global.sudoUsers && global.sudoUsers.includes(sender));
        
        let isAdmin = false;
        let isBotAdmin = false;
        let participants = [];
        
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                participants = groupMetadata.participants;
                const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
                
                isBotAdmin = admins.includes(botNumber);
                isAdmin = admins.includes(sender);
                
                // FIX ABSOLU POUR TON COMPTE
                if (sender.includes('241065491629') || sender === '265932110843933@lid') {
                    isAdmin = true;
                    isBotAdmin = true;
                }
            } catch (e) {
                console.error("❌ Erreur metadata:", e.message);
                if (sender.includes('241065491629') || sender === '265932110843933@lid' || isOwner) {
                    isAdmin = true;
                    isBotAdmin = true;
                }
            }
        }
        
        const hasAdminRights = isAdmin || isOwner;
        const reply = (txt) => sock.sendMessage(from, { text: txt }, { quoted: m });

        // ========== VÉRIFICATION MODE PUBLIC/PRIVÉ ==========
        if (global.mode === "private" && !global.authorizedUsers?.includes(sender) && !isOwner) return;

        // ========== SYSTÈME DE PROFIL ==========
        if (!users[sender]) {
            users[sender] = { pseudo: pushname, registeredAt: Date.now(), dailyStreak: 0, lastDaily: 0, skins: [] };
            saveDB('./users.json', users);
        }
        const userProfile = users[sender];
        const userPseudo = userProfile.pseudo;

        // ========== SYSTÈME DE NIVEAUX FREE FIRE (CORRIGÉ) ==========
        if (global.settings?.leveling && !m.key.fromMe && isGroup) {
            // Initialiser si pas de données
            if (!levels[sender]) {
                levels[sender] = { totalXP: 0 };
            }
            
            // Gain d'XP aléatoire (5 à 20)
            const xpGain = Math.floor(Math.random() * 16) + 5;
            
            // Sauvegarder l'ancien rang
            const oldRank = getRankFromXP(levels[sender].totalXP || 0);
            
            // Ajouter l'XP
            levels[sender].totalXP = (levels[sender].totalXP || 0) + xpGain;
            
            // Calculer le nouveau rang
            const newRank = getRankFromXP(levels[sender].totalXP);
            
            // Si promotion, annoncer
            if (oldRank.index < newRank.index) {
                const emoji = getRankEmoji(newRank.index);
                reply(`${emoji} *PROMOTION !*\n\n${userPseudo} passe de *${oldRank.name}* à *${newRank.name}* ! 🎉\n\n🔥 Continue comme ça !`);
            }
            
            // Sauvegarder
            saveDB('./levels.json', levels);
        }

        // ========== SYSTÈME D'ÉCONOMIE ==========
        if (global.settings?.economy && !m.key.fromMe) {
            if (!economy[sender]) {
                economy[sender] = { balance: 100, lastDaily: 0 };
            }
            saveDB('./economy.json', economy);
        }

        // ========== ANTITAG ==========
        if (isGroup && antitagDB.groups[from] === true) {
            const mentions = getMentionedIds(m);
            if (mentions.includes(botNumber)) {
                try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                reply(`⚠️ @${sender.split('@')[0]} , interdiction de mentionner le bot !`);
                return;
            }
        }

        // ========== ANTILINK ==========
        if (isGroup && antilinkDB.groups[from] === true && !hasAdminRights && isBotAdmin) {
            if (isUrl(budy)) {
                try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                try {
                    const realSender = await resolveLid(sock, sender);
                    await sock.groupParticipantsUpdate(from, [realSender], "remove");
                } catch (e) {}
                reply(`🚫 AntiLink : @${sender.split('@')[0]} expulsé pour lien.`);
                return;
            }
        }

        // ========== ANTISPAM ==========
        if (isGroup && antispamDB?.groups[from] === true && !hasAdminRights && isBotAdmin) {
            if (isSpam(sender, from)) {
                try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                try {
                    const realSender = await resolveLid(sock, sender);
                    await sock.groupParticipantsUpdate(from, [realSender], "remove");
                } catch (e) {}
                reply(`🚫 AntiSpam : @${sender.split('@')[0]} expulsé pour spam.`);
                clearSpam(sender, from);
                return;
            }
        }

        // ========== ANALYSE DE LA COMMANDE ==========
        if (!budy.startsWith(global.prefix || '.')) return;
        const args = budy.slice((global.prefix || '.').length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const q = args.join(' ');
        const quoted = m.quoted ? m.quoted : m;

        console.log(`🚀 ${commandName} | ${sender.split('@')[0]} | Admin: ${isAdmin} | Owner: ${isOwner}`);

        // ========== APPEL AUX MODULES EXTERNES ==========
        if (voiceHandler && voiceHandler.commands.includes(commandName)) {
            return voiceHandler.execute({ sock, m, command: commandName, args, q, reply, quoted });
        }
        if (claudeHandler && claudeHandler.commands.includes(commandName)) {
            return claudeHandler.execute({ sock, m, command: commandName, text: q, reply });
        }

        // ========== SWITCH DES COMMANDES ==========
        switch (commandName) {
                    // ========== MENU ==========
            case "menu":
                let runtimeStr = formatRuntime(process.uptime());
                let modeStr = global.mode === 'public' ? '🌍 PUBLIC' : '🔒 PRIVÉ';
                let menuText = `╔═══〔 🤖 ${global.botName || 'JACE BOT'} 〕═══⬣
║ 👤 ${userPseudo} | ${modeStr}
║ 🟢 En ligne | ${runtimeStr}
╚══════════════════⬣

╔═══〔 👑 ADMINISTRATION 〕═══⬣
║ .kick @user | .promote @user
║ .demote @user | .kickall
║ .group open / close
║ .hidetag [msg] | .tagall [msg]
║ .antilink on/off | .antispam on/off
║ .antitag on/off | .broadcast [msg]
╚══════════════════⬣

╔═══〔 🎵 TÉLÉCHARGEMENT 〕═══⬣
║ .song [titre] | .play [titre]
║ .tiktok [lien] | .tourl (reply)
╚══════════════════⬣

╔═══〔 🤖 IA 〕═══⬣
║ .gemini [question] | .claude [q]
╚══════════════════⬣

╔═══〔 🎤 VOICE CHANGER 〕═══⬣
║ .bass | .robot | .reverse
║ .nightcore | .fast | .slow
╚══════════════════⬣

╔═══〔 🎮 JEUX & SOCIAL 〕═══⬣
║ .profil | .pseudo [nom]
║ .rank | .top | .daily
║ .balance | .couple
╚══════════════════⬣

╔═══〔 🛠️ UTILITAIRES 〕═══⬣
║ .sticker | .tourl
║ .ping | .alive | .runtime
║ .religion | .pair
╚══════════════════⬣`;
                await sock.sendMessage(from, { image: { url: global.image?.menu || 'https://files.catbox.moe/v9nzgz.jpg' }, caption: menuText }, { quoted: m });
                break;

            // ========== RUNTIME ==========
            case "runtime": reply(`⏱️ *Runtime :* ${formatRuntime(process.uptime())}`); break;

            // ========== PROFIL ==========
            case "profil":
                let userXP = levels[sender]?.totalXP || 0;
                let rank = getRankFromXP(userXP);
                let nextRank = rank.index < rankNames.length - 1 ? rankNames[rank.index + 1] : "MAX";
                let profilText = `╔═══〔 👤 PROFIL DE ${userPseudo} 〕═══⬣
║ 🏆 Rang : ${rank.name}
║ 📊 XP : ${rank.currentXP}/${rank.nextXP}
║ 💰 Pièces : ${economy[sender]?.balance || 0}
║ 🔥 Série : ${userProfile.dailyStreak} jours
╚══════════════════⬣`;
                reply(profilText);
                break;

            case "pseudo":
                if (!q) return reply("❌ Donne un pseudo !");
                users[sender].pseudo = q;
                saveDB('./users.json', users);
                reply(`✅ Pseudo changé en : *${q}*`);
                break;

            case "rank":
                let myXP = levels[sender]?.totalXP || 0;
                let myRank = getRankFromXP(myXP);
                let percent = Math.floor((myRank.currentXP / myRank.nextXP) * 20);
                let bar = "█".repeat(percent) + "░".repeat(20 - percent);
                reply(`${getRankEmoji(myRank.index)} *${myRank.name}*\n${bar} ${Math.floor((myRank.currentXP / myRank.nextXP) * 100)}%\n${myRank.currentXP}/${myRank.nextXP} XP`);
                break;

            case "top":
                let sorted = Object.entries(levels).sort((a, b) => (b[1].totalXP || 0) - (a[1].totalXP || 0)).slice(0, 10);
                let topText = `🏆 *TOP 10* 🏆\n\n`;
                sorted.forEach(([id, data], i) => {
                    let pseudo = users[id]?.pseudo || id.split('@')[0];
                    topText += `${i+1}. ${pseudo} - ${getRankFromXP(data.totalXP || 0).name}\n`;
                });
                reply(topText);
                break;

            case "balance": reply(`💰 Solde : *${economy[sender]?.balance || 0}* pièces.`); break;

            case "daily":
                if (!economy[sender]) economy[sender] = { balance: 100, lastDaily: 0 };
                let now = Date.now();
                if (now - economy[sender].lastDaily < 86400000) {
                    let remaining = 86400000 - (now - economy[sender].lastDaily);
                    return reply(`⏳ Reviens dans *${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m* !`);
                }
                users[sender].dailyStreak = (now - economy[sender].lastDaily < 172800000) ? (users[sender].dailyStreak || 0) + 1 : 1;
                let bonus = Math.min(users[sender].dailyStreak * 50, 500);
                economy[sender].balance += 500 + bonus;
                economy[sender].lastDaily = now;
                saveDB('./economy.json', economy);
                saveDB('./users.json', users);
                reply(`🎁 +${500 + bonus} pièces ! Série : ${users[sender].dailyStreak} jours\n💰 Solde : *${economy[sender].balance}*`);
                break;

            // ========== GEMINI ==========
            case "gemini":
            case "gpt":
                if (!q) return reply("❌ Pose une question !");
                try {
                    reply("🤖 Je réfléchis...");
                    const genAI = new (require("@google/generative-ai").GoogleGenerativeAI)(GEMINI_API_KEY);
                    const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await geminiModel.generateContent(q);
                    reply(result.response.text());
                } catch (e) { reply("❌ Erreur Gemini."); }
                break;

            // ========== SONG (AUDIO) - API FIABLE ==========
            case "song":
            case "son":
                if (!q) return reply(`❌ ${global.prefix}${commandName} [titre]`);
                try {
                    reply("⏳ Recherche...");
                    const search = await yts(q);
                    const video = search.videos[0];
                    if (!video) return reply("❌ Aucun résultat.");
                    
                    const response = await axios.get(`https://api.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(video.url)}`);
                    if (response.data?.success && response.data?.result?.download_url) {
                        await sock.sendMessage(from, { audio: { url: response.data.result.download_url }, mimetype: "audio/mpeg" }, { quoted: m });
                    } else {
                        reply("❌ Erreur de téléchargement.");
                    }
                } catch (e) { reply("❌ Erreur."); }
                break;

            // ========== PLAY (VIDÉO) ==========
            case "play":
                if (!q) return reply(`❌ ${global.prefix}play [titre]`);
                try {
                    reply("⏳ Recherche...");
                    const search = await yts(q);
                    const video = search.videos[0];
                    if (!video) return reply("❌ Aucun résultat.");
                    
                    const response = await axios.get(`https://api.davidcyriltech.my.id/download/ytmp4?url=${encodeURIComponent(video.url)}`);
                    if (response.data?.success && response.data?.result?.download_url) {
                        await sock.sendMessage(from, { video: { url: response.data.result.download_url }, caption: `🎥 *${video.title}*` }, { quoted: m });
                    } else {
                        reply("❌ Erreur de téléchargement.");
                    }
                } catch (e) { reply("❌ Erreur."); }
                break;

            // ========== TIKTOK ==========
            case "tiktok":
                if (!q) return reply("❌ Lien TikTok ?");
                try {
                    reply("⏳ Téléchargement...");
                    const res = await axios.get(`https://tikwm.com/api/?url=${q}`);
                    if (res.data?.data) {
                        await sock.sendMessage(from, { video: { url: res.data.data.play }, caption: `🎥 ${res.data.data.author?.nickname || 'TikTok'}` }, { quoted: m });
                    } else { reply("❌ Impossible de télécharger."); }
                } catch (e) { reply("❌ Erreur."); }
                break;

            // ========== STICKER ==========
            case "sticker":
            case "s":
                if (!m.quoted) return reply("❌ Réponds à une image !");
                try {
                    reply("⏳ Création...");
                    let media = await sock.downloadMediaMessage(m.quoted);
                    await sock.sendMessage(from, { sticker: media, pack: global.botName, author: pushname }, { quoted: m });
                } catch (e) { reply("❌ Erreur."); }
                break;

            // ========== COUPLE ==========
            case "couple":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                let members = participants.filter(p => !p.admin).map(p => p.id);
                if (members.length < 2) return reply("❌ Pas assez de membres !");
                let p1 = members[Math.floor(Math.random() * members.length)];
                let p2 = members[Math.floor(Math.random() * members.length)];
                while (p2 === p1) p2 = members[Math.floor(Math.random() * members.length)];
                reply(`💘 *COUPLE DU JOUR*\n@${p1.split('@')[0]} 💕 @${p2.split('@')[0]}\n🔮 Compatibilité : *${Math.floor(Math.random() * 101)}%*`, { mentions: [p1, p2] });
                break;

            // ========== RELIGION ==========
            case "religion":
            case "priere":
                const prieres = ["🙏 *Prière du jour*\n\n\"Seigneur, accorde-moi la sagesse.\"", "🕊️ *Prière du jour*\n\n\"Que la paix soit dans ton cœur.\"", "✨ *Prière du jour*\n\n\"Que chaque pas te rapproche de tes rêves.\""];
                reply(prieres[Math.floor(Math.random() * prieres.length)]);
                break;

            case "pair": reply(`📱 Connecte-toi via Telegram : @JaceBotMD`); break;

            case "ping":
                let debut = Date.now();
                await reply("🏓 Ping...");
                await sock.sendMessage(from, { text: `🏓 Pong ! ${Date.now() - debut}ms` }, { quoted: m });
                break;

            case "alive": reply(`🤖 *${global.botName}* en ligne !\n⏱️ ${formatRuntime(process.uptime())}`); break;
                        // ========== ANTILINK ==========
            case "antilink":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (args[0] === "on") { antilinkDB.groups[from] = true; saveDB('./database/antilink.json', antilinkDB); reply("🛡️ AntiLink ON"); }
                else if (args[0] === "off") { antilinkDB.groups[from] = false; saveDB('./database/antilink.json', antilinkDB); reply("🔓 AntiLink OFF"); }
                else { reply(`🛡️ AntiLink : ${antilinkDB.groups[from] ? 'ON' : 'OFF'}\n.antilink on/off`); }
                break;

            case "antispam":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (args[0] === "on") { antispamDB.groups[from] = true; saveDB('./database/antispam.json', antispamDB); reply("🚫 AntiSpam ON"); }
                else if (args[0] === "off") { antispamDB.groups[from] = false; saveDB('./database/antispam.json', antispamDB); reply("🔓 AntiSpam OFF"); }
                else { reply(`🚫 AntiSpam : ${antispamDB.groups[from] ? 'ON' : 'OFF'}\n.antispam on/off`); }
                break;

            case "antitag":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (args[0] === "on") { antitagDB.groups[from] = true; saveDB('./database/antitag.json', antitagDB); reply("🚫 AntiTag ON"); }
                else if (args[0] === "off") { antitagDB.groups[from] = false; saveDB('./database/antitag.json', antitagDB); reply("✅ AntiTag OFF"); }
                else { reply(`🚫 AntiTag : ${antitagDB.groups[from] ? 'ON' : 'OFF'}\n.antitag on/off`); }
                break;

            // ========== KICK (AVEC FIX LID) ==========
            case "kick":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (!isBotAdmin) return reply("❌ Bot doit être admin.");
                
                let kickTargets = getMentionedIds(m);
                if (kickTargets.length === 0) { const qid = getQuotedId(m); if (qid) kickTargets = [qid]; }
                if (kickTargets.length === 0) return reply("❌ Mentionne @user");
                
                for (let user of kickTargets) {
                    try {
                        const realUser = await resolveLid(sock, user);
                        await sock.groupParticipantsUpdate(from, [realUser], "remove");
                        reply(`👞 @${user.split('@')[0]} expulsé.`);
                    } catch (e) { reply(`❌ Échec pour @${user.split('@')[0]}`); }
                }
                break;

            // ========== PROMOTE (AVEC FIX LID) ==========
            case "promote":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (!isBotAdmin) return reply("❌ Bot doit être admin.");
                
                let promoteTargets = getMentionedIds(m);
                if (promoteTargets.length === 0) { const qid = getQuotedId(m); if (qid) promoteTargets = [qid]; }
                if (promoteTargets.length === 0) return reply("❌ Mentionne @user");
                
                for (let user of promoteTargets) {
                    try {
                        const realUser = await resolveLid(sock, user);
                        await sock.groupParticipantsUpdate(from, [realUser], "promote");
                        reply(`👑 @${user.split('@')[0]} est admin.`);
                    } catch (e) { reply(`❌ Échec pour @${user.split('@')[0]}`); }
                }
                break;

            // ========== DEMOTE (AVEC FIX LID) ==========
            case "demote":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (!isBotAdmin) return reply("❌ Bot doit être admin.");
                
                let demoteTargets = getMentionedIds(m);
                if (demoteTargets.length === 0) { const qid = getQuotedId(m); if (qid) demoteTargets = [qid]; }
                if (demoteTargets.length === 0) return reply("❌ Mentionne @user");
                
                for (let user of demoteTargets) {
                    try {
                        const realUser = await resolveLid(sock, user);
                        await sock.groupParticipantsUpdate(from, [realUser], "demote");
                        reply(`⬇️ @${user.split('@')[0]} n'est plus admin.`);
                    } catch (e) { reply(`❌ Échec pour @${user.split('@')[0]}`); }
                }
                break;

            // ========== GROUP OPEN/CLOSE ==========
            case "group":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (!isBotAdmin) return reply("❌ Bot doit être admin.");
                if (args[0] === "close") { await sock.groupSettingUpdate(from, 'announcement'); reply("🔒 Groupe fermé."); }
                else if (args[0] === "open") { await sock.groupSettingUpdate(from, 'not_announcement'); reply("🔓 Groupe ouvert."); }
                else { reply("❌ .group open / close"); }
                break;

            // ========== HIDETAG ==========
            case "hidetag":
            case "tagall":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (participants.length > 0) {
                    await sock.sendMessage(from, { text: q || "📢 *Annonce*", mentions: participants.map(p => p.id) }, { quoted: m });
                } else { reply("⚠️ Liste indisponible."); }
                break;

            // ========== KICKALL (AVEC FIX LID) ==========
            case "kickall":
                if (!isGroup) return reply("❌ Groupe uniquement.");
                if (!hasAdminRights) return reply("❌ Admin uniquement.");
                if (!isBotAdmin) return reply("❌ Bot doit être admin.");
                if (participants.length === 0) return reply("❌ Liste indisponible.");
                
                let nonAdmins = participants.filter(p => !p.admin).map(p => p.id);
                if (nonAdmins.length === 0) return reply("✅ Aucun membre.");
                
                reply(`⚠️ Expulsion de ${nonAdmins.length} membres...`);
                setTimeout(async () => {
                    for (let user of nonAdmins) {
                        try {
                            const realUser = await resolveLid(sock, user);
                            await sock.groupParticipantsUpdate(from, [realUser], "remove");
                            await new Promise(r => setTimeout(r, 2000));
                        } catch (e) {}
                    }
                    reply("✅ Kickall terminé.");
                }, 5000);
                break;

            // ========== BROADCAST ==========
            case "broadcast":
            case "bc":
                if (!isOwner) return reply("❌ Owner uniquement.");
                if (!q) return reply("❌ Message ?");
                const groups = await sock.groupFetchAllParticipating();
                let count = 0;
                for (let g in groups) { try { await sock.sendMessage(g, { text: `📢 ${q}` }); count++; await new Promise(r => setTimeout(r, 2000)); } catch (e) {} }
                reply(`✅ Envoyé à ${count} groupes.`);
                break;

            // ========== MODE ==========
            case "mode":
                if (!isOwner) return reply("❌ Owner uniquement.");
                if (args[0] === "public") { global.mode = "public"; reply("🌍 Mode PUBLIC"); }
                else if (args[0] === "private") { global.mode = "private"; reply("🔒 Mode PRIVÉ"); }
                else { reply(`Mode : ${global.mode}`); }
                break;

            case "autostatus":
                if (!isOwner) return reply("❌ Owner uniquement.");
                global.settings.autoStatus = !global.settings.autoStatus;
                reply(`🔥 AutoStatus : ${global.settings.autoStatus ? 'ON' : 'OFF'}`);
                break;

            default:
                if (budy.startsWith(global.prefix)) reply(`❌ Commande inconnue : *${commandName}*\nTape *.menu*`);
                break;
        }

    } catch (err) {
        console.error('❌ ERREUR HANDLER :', err.message);
    }
};

module.exports.groupeHandler = groupeHandler;