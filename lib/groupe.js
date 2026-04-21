const { WA_DEFAULT_EPHEMERAL } = require('@whiskeysockets/baileys').default;

module.exports = {
    name: "groupe",
    
    execute: async (sock, { id, participants, action, author }) => {
        try {
            const metadata = await sock.groupMetadata(id);
            const subject = metadata.subject;
            
            for (const jid of participants) {
                let tag = author && author !== jid ? [author, jid] : [jid];
                
                switch (action) {
                    case "add":
                        await sock.sendMessage(id, {
                            text: `👋 Bienvenue @${jid.split("@")[0]} dans *${subject}* !\n\n📜 Merci de respecter les règles du groupe.\n🤖 Tape .menu pour voir mes commandes.`,
                            contextInfo: { mentionedJid: [jid] }
                        }, { ephemeralExpiration: WA_DEFAULT_EPHEMERAL });
                        break;
                        
                    case "remove":
                        await sock.sendMessage(id, {
                            text: `👋 Au revoir @${jid.split("@")[0]}...\n\nOn espère te revoir bientôt ! 😢`,
                            contextInfo: { mentionedJid: [jid] }
                        }, { ephemeralExpiration: WA_DEFAULT_EPHEMERAL });
                        break;
                        
                    case "promote":
                        if (author) {
                            await sock.sendMessage(id, {
                                text: `🎉 *@${author.split("@")[0]} a promu @${jid.split("@")[0]} administrateur !* 👑`,
                                contextInfo: { mentionedJid: tag }
                            }, { ephemeralExpiration: WA_DEFAULT_EPHEMERAL });
                        }
                        break;
                        
                    case "demote":
                        if (author) {
                            await sock.sendMessage(id, {
                                text: `😔 *@${author.split("@")[0]} a rétrogradé @${jid.split("@")[0]} de son poste d'administrateur.*`,
                                contextInfo: { mentionedJid: tag }
                            }, { ephemeralExpiration: WA_DEFAULT_EPHEMERAL });
                        }
                        break;
                }
            }
        } catch (err) {
            console.error("❌ Erreur événement groupe:", err);
        }
    }
};