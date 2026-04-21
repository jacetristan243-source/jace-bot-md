const { GoogleGenerativeAI } = require("@google/generative-ai");

// Récupérer la clé API depuis la config globale
const GEMINI_API_KEY = global.api?.gemini || "AIzaSyBDZ99nAaJOZ84GxMAVCXc5-tthmEXcBGQ";

module.exports = {
    commands: ['claude', 'aiclaude'],
    
    execute: async ({ text, reply }) => {
        if (!text) return reply('❌ Pose-moi une question !');
        
        try {
            reply('🤖 Je réfléchis...');
            
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const result = await model.generateContent(text);
            const response = result.response.text();
            
            reply(response);
        } catch (e) {
            console.error('Erreur IA:', e);
            reply('❌ Erreur avec l\'IA. Réessaie plus tard.');
        }
    }
};