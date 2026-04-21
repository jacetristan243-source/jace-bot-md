# ⚡ JACE BOT MD v2.0.0

Bot WhatsApp multi-fonctionnalités basé sur **Baileys** — développé par **Jace Miller Stark**.

---

## 🚀 Déploiement sur FreeGameHost

### 1. Configurer le dépôt GitHub dans le panel

Dans votre panel FreeGameHost → onglet **Startup** → champ **GIT REPO ADDRESS** :
```
https://github.com/jacetristan243-source/jace-bot-md.git
```

### 2. Démarrer le serveur

Le panel exécutera automatiquement :
- `git pull` pour récupérer le code
- `npm install` pour installer les dépendances
- `node index.js` pour lancer le bot

### 3. Connexion WhatsApp (Pairing Code)

Via **Telegram** : envoyez `/pair [votre_numéro]` à votre bot Telegram.

Via le **site Vercel** : rendez-vous sur votre URL de déploiement et entrez votre numéro directement.

---

## ⚙️ Configuration

Modifiez `config.js` avant de déployer :

| Paramètre | Description |
|-----------|-------------|
| `global.owner` | Votre numéro WhatsApp (sans +) |
| `global.api.gemini` | Votre clé API Google Gemini |
| `global.api.tgToken` | Token de votre bot Telegram |
| `global.adminTelegramIds` | Votre ID Telegram |
| `global.mode` | `"public"` ou `"private"` |

---

## 📋 Commandes disponibles

**Administration** — `.kick`, `.promote`, `.demote`, `.kickall`, `.group open/close`, `.hidetag`, `.tagall`, `.broadcast`

**Téléchargement** — `.song [titre]`, `.play [titre]`, `.tiktok [lien]`, `.sticker`

**IA** — `.gemini [question]`, `.claude [question]`

**Voice Changer** — `.bass`, `.robot`, `.reverse`, `.nightcore`, `.fast`, `.slow`

**Social & Jeux** — `.profil`, `.rank`, `.top`, `.daily`, `.balance`, `.couple`

**Utilitaires** — `.menu`, `.ping`, `.alive`, `.runtime`, `.mode`

**Protection** — `.antilink on/off`, `.antispam on/off`, `.antitag on/off`

---

## 🗂️ Structure du projet

```
jace-bot-md/
├── index.js          ← Point d'entrée principal
├── handler.js        ← Gestionnaire de commandes
├── command.js        ← Registre des commandes
├── config.js         ← Configuration globale
├── package.json      ← Dépendances Node.js
├── lib/
│   ├── claude.js     ← Module IA (Gemini)
│   ├── voice.js      ← Module Voice Changer
│   └── groupe.js     ← Module événements groupe
├── database/
│   ├── antilink.json
│   ├── antispam.json
│   └── antitag.json
├── temp/             ← Fichiers audio temporaires
├── users.json        ← Profils utilisateurs
├── levels.json       ← Système de niveaux
└── economy.json      ← Système d'économie
```

---

**JACE BOT MD v2.0.0** — © Jace Miller Stark
