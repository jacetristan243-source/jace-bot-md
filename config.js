// ========== CONFIGURATION JACE BOT MD ==========

// Nom du bot
global.botName = "JACE BOT MD";

// Version
global.version = "2.0.0";

// Préfixe des commandes
global.prefix = ".";

// Numéro du propriétaire (sans @s.whatsapp.net)
global.owner = ["241065491629"];

// Nom du propriétaire
global.namaOwner = "Jace Stark";
global.namaowner = "Jace Stark";

// Image du menu (URL)
global.image = {
    menu: "https://files.catbox.moe/v9nzgz.jpg"
};

// Audio (optionnel)
global.audio = {
    menu: "",
    alive: ""
};

// ========== API KEYS ==========
global.api = {
    gemini: "AIzaSyBDZ99nAaJOZ84GxMAVCXc5-tthmEXcBGQ",
    tgToken: "8714347855:AAFYIzZ7iVVvWDDq6qD7QfaVuIo6xAATr9U"
};

// ========== MESSAGES ==========
global.mess = {
    wait: "⏳ *Patientez...*",
    success: "✅ *Succès !*",
    error: "❌ *Erreur !*",
    owner: "❌ *Cette commande est réservée au propriétaire !*",
    admin: "❌ *Cette commande est réservée aux administrateurs !*",
    botAdmin: "❌ *Le bot doit être administrateur !*",
    group: "❌ *Cette commande ne fonctionne qu'en groupe !*",
    private: "❌ *Cette commande ne fonctionne qu'en privé !*"
};

// ========== RÉSEAUX SOCIAUX ==========
global.tt = "https://tiktok.com/@neonstark1";
global.yt = "https://youtube.com/@jacemiller-x8k";
global.ig = "https://instagram.com/@ander.jace";

// ========== CONFIGURATION AVANCÉE ==========

// Mode du bot ("public" ou "private")
global.mode = "public";

// Utilisateurs autorisés en mode privé
global.authorizedUsers = ["241065491629@s.whatsapp.net"];

// Sudo users (utilisateurs avec droits admin)
global.sudoUsers = ["241065491629@s.whatsapp.net"];

// Admin Telegram (TON ID)
global.adminTelegramIds = ["7815491456"];

// Anti Call (bloquer les appels inconnus)
global.antiCall = true;

// Paramètres généraux
global.settings = {
    autoStatus: true,   // Voir les statuts
    leveling: true,     // Système de niveaux Free Fire
    economy: true,      // Système d'économie
    antispam: true,     // Anti spam
    antilink: true      // Anti lien
};

console.log("✅ Configuration JACE BOT MD chargée !");