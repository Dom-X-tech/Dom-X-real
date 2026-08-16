const { 
    EliteProTechId,
    removeFile
} = require('../ids');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
let router = express.Router();
const pino = require("pino");
const {
    default: EliteProTechConnect,
    useMultiFileAuthState,
    Browsers,
    delay,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

// ========== MONGODB CONNECTION ==========
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/whatsapp-bot';

mongoose.connect(MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// ========== SESSION SCHEMA (PERSISTENT - NEVER DELETED) ==========
const SessionSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true },
    phoneNumber: { type: String, default: '' },
    creds: { type: Object, default: null },
    sessionId: { type: String, default: '' },
    connected: { type: Boolean, default: false },
    paired: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', SessionSchema);

// ========== SESSION STORAGE FUNCTIONS ==========

// Save session to MongoDB (NEVER DELETED)
async function saveSessionToDB(userId, credsData, sessionIdString) {
    try {
        await Session.findOneAndUpdate(
            { userId },
            { 
                creds: credsData,
                sessionId: sessionIdString,
                paired: true,
                lastActive: new Date()
            },
            { upsert: true, new: true }
        );
        console.log(`✅ Session saved to MongoDB for ${userId}`);
        return true;
    } catch (error) {
        console.error('Failed to save session:', error);
        return false;
    }
}

// Load session from MongoDB
async function loadSessionFromDB(userId) {
    try {
        const session = await Session.findOne({ userId });
        if (session && session.creds) {
            console.log(`🔄 Session loaded from MongoDB for ${userId}`);
            return session.creds;
        }
        return null;
    } catch (error) {
        console.error('Failed to load session:', error);
        return null;
    }
}

// Get all sessions
async function getAllSessions() {
    try {
        return await Session.find({});
    } catch (error) {
        console.error('Failed to get sessions:', error);
        return [];
    }
}

// ========== SESSION DIRECTORY ==========
const sessionDir = path.join(__dirname, "session");

// ========== 10 COMMANDS ==========
async function handleCommands(EliteProTech, from, text, pushName) {
    if (!text.startsWith('!')) return;

    const args = text.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // === COMMAND 1: MENU ===
        if (command === 'menu' || command === 'help') {
            const menu = `
╔══════════════════════════════════╗
║   🤖 DOM-GEN BOT COMMANDS        ║
╠══════════════════════════════════╣
║ 1. !menu    - Show this menu     ║
║ 2. !ping    - Check bot latency  ║
║ 3. !ai <q>  - AI assistant       ║
║ 4. !sticker - Make sticker       ║
║ 5. !tagall  - Tag everyone       ║
║ 6. !image   - Search image       ║
║ 7. !video   - Download video     ║
║ 8. !music   - Download music     ║
║ 9. !owner   - Bot owner info     ║
║ 10. !alive  - Check bot status   ║
╚══════════════════════════════════╝
            `;
            await EliteProTech.sendMessage(from, { text: menu });
        }

        // === COMMAND 2: PING ===
        else if (command === 'ping') {
            const start = Date.now();
            await EliteProTech.sendMessage(from, { text: '🏓 Pinging...' });
            const end = Date.now();
            await EliteProTech.sendMessage(from, { 
                text: `🏓 Pong! ${end - start}ms\nUser: ${pushName}` 
            });
        }

        // === COMMAND 3: AI ===
        else if (command === 'ai') {
            const prompt = args.join(' ');
            if (!prompt) {
                await EliteProTech.sendMessage(from, { 
                    text: '❌ Usage: !ai <your question>' 
                });
                return;
            }

            await EliteProTech.sendMessage(from, { text: '🤔 Thinking...' });
            
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || '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'}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'openai/gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'You are a helpful WhatsApp assistant named Dom-Gen.' },
                            { role: 'user', content: prompt }
                        ]
                    })
                });
                const data = await response.json();
                const reply = data.choices?.[0]?.message?.content || 'No response';
                await EliteProTech.sendMessage(from, { text: reply });
            } catch (error) {
                await EliteProTech.sendMessage(from, { text: '❌ AI error. Try again.' });
            }
        }

        // === COMMAND 4: STICKER ===
        else if (command === 'sticker' || command === 's') {
            const msg = EliteProTech.ev?.messages?.upsert?.[0]?.message;
            const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!quoted || (!quoted.imageMessage && !quoted.videoMessage)) {
                await EliteProTech.sendMessage(from, {
                    text: '❌ Reply to an image/video with !sticker'
                });
                return;
            }

            try {
                let type = quoted.imageMessage ? 'image' : 'video';
                const media = quoted.imageMessage || quoted.videoMessage;
                const stream = await downloadContentFromMessage(media, type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                
                await EliteProTech.sendMessage(from, {
                    sticker: buffer,
                    mimetype: 'image/webp'
                });
            } catch (error) {
                await EliteProTech.sendMessage(from, { text: '❌ Failed to create sticker' });
            }
        }

        // === COMMAND 5: TAGALL ===
        else if (command === 'tagall') {
            if (!from.endsWith('@g.us')) {
                await EliteProTech.sendMessage(from, { text: '❌ Group only command' });
                return;
            }

            const metadata = await EliteProTech.groupMetadata(from);
            const participants = metadata.participants || [];
            let text = `📢 *TAG ALL*\nFrom: ${pushName}\n\n`;
            let mentions = [];
            participants.forEach((p, i) => {
                const user = p.id.split('@')[0];
                text += `${i+1}. @${user}\n`;
                mentions.push(p.id);
            });
            await EliteProTech.sendMessage(from, { text, mentions });
        }

        // === COMMAND 6: IMAGE ===
        else if (command === 'image') {
            const query = args.join(' ');
            if (!query) {
                await EliteProTech.sendMessage(from, { text: '❌ Usage: !image <search term>' });
                return;
            }

            await EliteProTech.sendMessage(from, { text: `🔍 Searching: ${query}` });
            
            try {
                const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
                const res = await fetch(searchUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const html = await res.text();
                const matches = html.match(/https?:\/\/[^"']+\.(jpg|jpeg|png|gif|webp)/gi);
                
                if (matches && matches.length > 0) {
                    const imgUrl = matches[Math.floor(Math.random() * matches.length)];
                    await EliteProTech.sendMessage(from, {
                        image: { url: imgUrl },
                        caption: `📷 ${query}`
                    });
                } else {
                    await EliteProTech.sendMessage(from, { text: '❌ No images found' });
                }
            } catch (error) {
                await EliteProTech.sendMessage(from, { text: '❌ Image search failed' });
            }
        }

        // === COMMAND 7: VIDEO ===
        else if (command === 'video') {
            const query = args.join(' ');
            if (!query) {
                await EliteProTech.sendMessage(from, { text: '❌ Usage: !video <name>' });
                return;
            }

            await EliteProTech.sendMessage(from, { text: `🎬 Searching: ${query}` });
            
            try {
                const yts = require('yt-search');
                const search = await yts(query);
                const video = search.videos[0];
                
                if (!video) {
                    await EliteProTech.sendMessage(from, { text: '❌ No video found' });
                    return;
                }

                await EliteProTech.sendMessage(from, {
                    video: { url: video.url },
                    caption: `🎬 ${video.title}\n👤 ${video.author.name}`
                });
            } catch (error) {
                await EliteProTech.sendMessage(from, { text: '❌ Video download failed' });
            }
        }

        // === COMMAND 8: MUSIC ===
        else if (command === 'music' || command === 'song') {
            const query = args.join(' ');
            if (!query) {
                await EliteProTech.sendMessage(from, { text: '❌ Usage: !music <song name>' });
                return;
            }

            await EliteProTech.sendMessage(from, { text: `🎵 Searching: ${query}` });
            
            try {
                const yts = require('yt-search');
                const search = await yts(query);
                const video = search.videos[0];
                
                if (!video) {
                    await EliteProTech.sendMessage(from, { text: '❌ No song found' });
                    return;
                }

                const ytdl = require('ytdl-core');
                const stream = ytdl(video.url, { filter: 'audioonly' });
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                const buffer = Buffer.concat(chunks);

                await EliteProTech.sendMessage(from, {
                    audio: buffer,
                    mimetype: 'audio/mpeg',
                    fileName: `${video.title}.mp3`
                });
            } catch (error) {
                await EliteProTech.sendMessage(from, { text: '❌ Music download failed' });
            }
        }

        // === COMMAND 9: OWNER ===
        else if (command === 'owner') {
            const ownerInfo = `
👑 *BOT OWNER*
Name: Dom-X & Genetic
Number: 2347064554028
Website: https://dom-x-paring.onrender.com
━━━━━━━━━━━━━━━
*Support:*
@2347064554028
━━━━━━━━━━━━━━━
> Powered by DOM-GEN™
            `;
            await EliteProTech.sendMessage(from, { text: ownerInfo });
        }

        // === COMMAND 10: ALIVE ===
        else if (command === 'alive' || command === 'status') {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            
            const status = `
🤖 *BOT STATUS*
━━━━━━━━━━━━━━━━
✅ Status: Online
⏱️ Uptime: ${hours}h ${minutes}m
👤 User: ${pushName}
📱 Session: Active
━━━━━━━━━━━━━━━━
> Powered by DOM-GEN™
            `;
            await EliteProTech.sendMessage(from, { text: status });
        }

        // Unknown command
        else {
            await EliteProTech.sendMessage(from, { 
                text: `❌ Unknown command: !${command}\nType !menu for help` 
            });
        }

    } catch (error) {
        console.error('Command error:', error);
        await EliteProTech.sendMessage(from, { 
            text: `❌ Command failed: ${error.message}` 
        });
    }
}

router.get('/', async (req, res) => {
    const id = EliteProTechId();
    let responseSent = false;

    // ========== NO CLEANUP AT ALL! ==========
    // Sessions stay in: 
    // 1. MongoDB (forever)
    // 2. Session folder (forever)

    async function EliteProTech_QR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
        console.log('Baileys version:', version);
        
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        
        try {
            let EliteProTech = EliteProTechConnect({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            EliteProTech.ev.on('creds.update', saveCreds);
            
            EliteProTech.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;
                
                if (qr && !responseSent) {
                    const qrImage = await QRCode.toDataURL(qr);
                    if (!res.headersSent) {
                        res.send(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>Dom-X | QR CODE</title>
                                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                                <style>
                                    body {
                                        display: flex;
                                        justify-content: center;
                                        align-items: center;
                                        min-height: 100vh;
                                        margin: 0;
                                        background-color: #000;
                                        font-family: Arial, sans-serif;
                                        color: #fff;
                                        text-align: center;
                                        padding: 20px;
                                        box-sizing: border-box;
                                    }
                                    .container {
                                        width: 100%;
                                        max-width: 600px;
                                    }
                                    .qr-container {
                                        position: relative;
                                        margin: 20px auto;
                                        width: 300px;
                                        height: 300px;
                                        display: flex;
                                        justify-content: center;
                                        align-items: center;
                                    }
                                    .qr-code {
                                        width: 300px;
                                        height: 300px;
                                        padding: 10px;
                                        background: white;
                                        border-radius: 20px;
                                        box-shadow: 0 0 0 10px rgba(255,255,255,0.1),
                                                    0 0 0 20px rgba(255,255,255,0.05),
                                                    0 0 30px rgba(255,255,255,0.2);
                                    }
                                    .qr-code img {
                                        width: 100%;
                                        height: 100%;
                                    }
                                    h1 {
                                        color: gold;
                                        margin: 0 0 15px 0;
                                        font-size: 28px;
                                        font-weight: 800;
                                        text-shadow: 0 0 10px rgba(255,255,255,0.3);
                                    }
                                    p {
                                        color: #ccc;
                                        margin: 20px 0;
                                        font-size: 16px;
                                    }
                                    .back-btn {
                                        display: inline-block;
                                        padding: 12px 25px;
                                        margin-top: 15px;
                                        background: linear-gradient(45deg, #000, gold);
                                        color: white;
                                        text-decoration: none;
                                        border-radius: 30px;
                                        font-weight: bold;
                                        border: none;
                                        cursor: pointer;
                                        transition: all 0.3s ease;
                                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                                    }
                                    .back-btn:hover {
                                        transform: translateY(-2px);
                                        box-shadow: 0 6px 20px rgba(0,0,0,0.3);
                                    }
                                    .pulse {
                                        animation: pulse 2s infinite;
                                    }
                                    @keyframes pulse {
                                        0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
                                        70% { box-shadow: 0 0 0 15px rgba(255,255,255,0); }
                                        100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
                                    }
                                </style>
                            </head>
                            <body>
                                <div class="container">
                                    <h1>Dom-X QR CODE</h1>
                                    <div class="qr-container">
                                        <div class="qr-code pulse">
                                            <img src="${qrImage}" alt="QR Code"/>
                                        </div>
                                    </div>
                                    <p>Scan this QR code with your phone to connect</p>
                                    <a href="./" class="back-btn">Back</a>
                                </div>
                            </body>
                            </html>
                        `);
                        responseSent = true;
                    }
                }

                if (connection === "open") {
                    try {
                        await EliteProTech.newsletterFollow("120363413766641596@newsletter");
                    } catch (error) {
                        console.error("Newsletter error:", error);
                    }

                    await delay(10000);

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 10;
                    
                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(2000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read error:", readError);
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        // NO CLEANUP - just return
                        console.log('No session data found, but keeping files');
                        return;
                    }

                    try {
                        const sessionJson = JSON.parse(sessionData.toString());
                        const oneLineJson = JSON.stringify(sessionJson);
                        
                        // ========== SAVE TO MONGODB (NEVER DELETED) ==========
                        const userId = EliteProTech.user.id;
                        await saveSessionToDB(userId, sessionJson, oneLineJson);
                        
                        // Send session to user
                        const Sess = await EliteProTech.sendMessage(EliteProTech.user.id, { text: oneLineJson });

                        let EliteProTech_TEXT = `✅ *SESSION ID OBTAINED SUCCESSFULLY!*  
📁 Session saved to MongoDB FOREVER!
📁 Session folder kept FOREVER!
📱 User ID: ${userId}

📢 *Stay Updated — Follow Our Channels:*

➊ *WhatsApp Channel*  
https://whatsapp.com/channel/0029Vb8wyGk1iUxdoi0WOA1U

➋ *Telegram*  
https://t.me/Domxchannel

➌ *YouTube*  
https://YouTube.com/@Dom-x-t5v

🚫 *Do NOT share your session ID with anyone.*

🌐 *Explore more tools:*  
https://dom-x-paring.onrender.com

💾 *Your session is securely stored in MongoDB and session folder FOREVER!*`;

                        const EliteProTechMess = {
                            image: { url: 'https://eliteprotech-url.zone.id/1777114610844fy4lq6.jpg' },
                            caption: EliteProTech_TEXT,
                            contextInfo: {
                                mentionedJid: [EliteProTech.user.id],
                                forwardingScore: 5,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363413766641596@newsletter',
                                    newsletterName: "Dom-X MD BOT",
                                    serverMessageId: 143
                                }
                            }
                        };
                        await EliteProTech.sendMessage(EliteProTech.user.id, EliteProTechMess, { quoted: Sess });
                        await delay(2000);
                        await EliteProTech.ws.close();
                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                    }
                    // ========== NO CLEANUP! ==========
                    
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    EliteProTech_QR_CODE();
                }
            });

            // ========== COMMAND HANDLER ==========
            EliteProTech.ev.on('messages.upsert', async ({ messages }) => {
                const msg = messages[0];
                if (!msg.message) return;

                const from = msg.key.remoteJid;
                const text = msg.message.conversation || 
                             msg.message.extendedTextMessage?.text || '';
                const pushName = msg.pushName || 'User';

                // Handle commands
                await handleCommands(EliteProTech, from, text, pushName);
            });

        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent) {
                res.status(500).json({ code: "QR Service is Currently Unavailable" });
                responseSent = true;
            }
            // ========== NO CLEANUP! ==========
        }
    }

    try {
        await EliteProTech_QR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        // ========== NO CLEANUP! ==========
        if (!responseSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

// ========== API ROUTES ==========

// Get all saved sessions
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await getAllSessions();
        res.json({
            success: true,
            count: sessions.length,
            sessions: sessions.map(s => ({
                userId: s.userId,
                phoneNumber: s.phoneNumber,
                connected: s.connected,
                paired: s.paired,
                createdAt: s.createdAt,
                lastActive: s.lastActive
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get session by userId
router.get('/session/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const session = await Session.findOne({ userId });
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({
            success: true,
            session: {
                userId: session.userId,
                phoneNumber: session.phoneNumber,
                connected: session.connected,
                paired: session.paired,
                createdAt: session.createdAt,
                lastActive: session.lastActive
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session from MongoDB (ONLY if you want to manually delete)
router.delete('/session/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        await Session.findOneAndDelete({ userId });
        res.json({ success: true, message: 'Session deleted from MongoDB' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
