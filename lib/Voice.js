const { exec } = require("child_process");
const fs = require("fs");

module.exports = {
    commands: ['bass', 'blown', 'deep', 'earrape', 'fast', 'fat', 'nightcore', 'reverse', 'robot', 'slow', 'smooth', 'tupai'],
    
    execute: async ({ sock, m, command, reply, quoted }) => {
        if (!quoted || !quoted.msg) return reply('❌ Réponds à un message audio avec la commande !');
        
        const msgType = Object.keys(quoted.msg)[0];
        const isAudio = msgType === 'audioMessage';
        const isVoiceNote = msgType === 'audioMessage' && quoted.msg.audioMessage?.ptt === true;
        
        if (!isAudio && !isVoiceNote) {
            return reply('❌ Le message doit être un audio ou une note vocale !\n\n💡 Astuce : Réponds à l\'audio avec .bass, .robot, etc.');
        }
        
        let filter = '';
        if (command === 'bass') filter = '-af equalizer=f=54:width_type=o:width=2:g=20';
        else if (command === 'blown') filter = '-af acrusher=.1:1:64:0:log';
        else if (command === 'deep') filter = '-af atempo=4/4,asetrate=44500*2/3';
        else if (command === 'earrape') filter = '-af volume=12';
        else if (command === 'fast') filter = '-filter:a "atempo=1.63,asetrate=44100"';
        else if (command === 'fat') filter = '-filter:a "atempo=1.6,asetrate=22100"';
        else if (command === 'nightcore') filter = '-filter:a atempo=1.06,asetrate=44100*1.25';
        else if (command === 'reverse') filter = '-filter_complex "areverse"';
        else if (command === 'robot') filter = '-filter_complex "afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75"';
        else if (command === 'slow') filter = '-filter:a "atempo=0.7,asetrate=44100"';
        else if (command === 'smooth') filter = '-filter:v "minterpolate=\'mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120\'"';
        else if (command === 'tupai') filter = '-filter:a "atempo=0.5,asetrate=65100"';
        
        try {
            reply('🎤 Application de l\'effet...');
            
            const stream = await require('@whiskeysockets/baileys').downloadContentFromMessage(quoted.msg, 'audio');
            let buffer = Buffer.concat([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            
            const inputFile = `./temp/voice_${Date.now()}.mp3`;
            const outputFile = `./temp/voice_${Date.now()}_out.mp3`;
            
            if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
            
            fs.writeFileSync(inputFile, buffer);
            
            exec(`ffmpeg -i ${inputFile} ${filter} ${outputFile}`, async (err) => {
                if (err) {
                    console.error(err);
                    try { fs.unlinkSync(inputFile); } catch(e) {}
                    return reply('❌ Erreur lors du traitement audio.');
                }
                
                const outBuffer = fs.readFileSync(outputFile);
                await sock.sendMessage(m.chat, { audio: outBuffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: m });
                
                try { fs.unlinkSync(inputFile); } catch(e) {}
                try { fs.unlinkSync(outputFile); } catch(e) {}
            });
        } catch (e) {
            console.error(e);
            reply('❌ Erreur.');
        }
    }
};
