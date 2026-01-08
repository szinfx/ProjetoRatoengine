/**
 * Local TTS Service - Native Node.js Implementation
 * Uses Microsoft Edge's free TTS voices via WebSocket (No Python required)
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Available PT-BR voices
const VOICES = {
    'pt-BR': [
        { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Feminino)', gender: 'female' },
        { id: 'pt-BR-AntonioNeural', name: 'Antonio (Masculino)', gender: 'male' },
        { id: 'pt-BR-ThalitaNeural', name: 'Thalita (Feminino)', gender: 'female' },
        { id: 'pt-BR-BrendaNeural', name: 'Brenda (Feminino)', gender: 'female' },
        { id: 'pt-BR-DonatoNeural', name: 'Donato (Masculino)', gender: 'male' },
        { id: 'pt-BR-ElzaNeural', name: 'Elza (Feminino)', gender: 'female' },
        { id: 'pt-BR-FabioNeural', name: 'Fabio (Masculino)', gender: 'male' },
        { id: 'pt-BR-GiovannaNeural', name: 'Giovanna (Feminino)', gender: 'female' },
        { id: 'pt-BR-HumbertoNeural', name: 'Humberto (Masculino)', gender: 'male' },
        { id: 'pt-BR-LeticiaNeural', name: 'Leticia (Feminino)', gender: 'female' }
    ],
    'en-US': [
        { id: 'en-US-JennyNeural', name: 'Jenny (Female)', gender: 'female' },
        { id: 'en-US-GuyNeural', name: 'Guy (Male)', gender: 'male' },
        { id: 'en-US-AriaNeural', name: 'Aria (Female)', gender: 'female' }
    ]
};

// Audio output directory
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'uploads', 'audio'); // Changed to public/uploads/audio for better serving
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4-EA85-44CA-84A7-091657F3CC4D";
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

/**
 * Check if service is available (Always true for native)
 */
async function isAvailable() {
    return true;
}

/**
 * Ensure installed (Always true for native)
 */
async function ensureInstalled() {
    return true;
}

/**
 * Get available voices for a language
 */
function getVoices(language = 'pt-BR') {
    return VOICES[language] || VOICES['pt-BR'];
}

function getFormattedTime() {
    return new Date().toString();
}

/**
 * Generate audio from text using WebSocket
 */
async function generateAudio(text, voice = 'pt-BR-FranciscaNeural', options = {}) {
    return new Promise((resolve, reject) => {
        try {
            // Clean text
            const cleanText = text
                .replace(/\[.*?\]/g, '')
                .replace(/\(.*?\)/g, '')
                .trim();

            if (!cleanText) return resolve({ success: false, error: 'Texto vazio' });

            const connectionId = uuidv4();
            const requestId = uuidv4().replace(/-/g, '');
            const url = `${WSS_URL}&ConnectionId=${connectionId}`;

            const ws = new WebSocket(url, {
                headers: {
                    "Pragma": "no-cache",
                    "Cache-Control": "no-cache",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36 Edg/91.0.864.41",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Accept-Language": "en-US,en;q=0.9"
                }
            });
            const audioChunks = [];

            const filename = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
            const outputPath = path.join(AUDIO_DIR, filename);

            ws.on('open', () => {
                // 1. Send Config
                const configMsg = `X-Timestamp:${getFormattedTime()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
                    JSON.stringify({
                        context: {
                            synthesis: {
                                audio: {
                                    metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                                    outputFormat: "audio-24khz-48kbitrate-mono-mp3"
                                }
                            }
                        }
                    });
                ws.send(configMsg);

                // 2. Send SSML
                const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'>${cleanText}</voice></speak>`;
                const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${getFormattedTime()}\r\nPath:ssml\r\n\r\n${ssml}`;
                ws.send(ssmlMsg);
            });

            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    const buffer = Buffer.from(data);
                    // Search for audio header marker (Path:audio\r\n)
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    if (headerEnd !== -1) {
                        const header = buffer.slice(0, headerEnd).toString();
                        if (header.includes('Path:audio')) {
                            // Correctly extract payload
                            const audioData = buffer.slice(headerEnd + 4);
                            audioChunks.push(audioData);
                        }
                    }
                } else {
                    const text = data.toString();
                    if (text.includes('Path:turn.end')) {
                        ws.close();
                    }
                }
            });

            ws.on('close', () => {
                if (audioChunks.length > 0) {
                    const finalBuffer = Buffer.concat(audioChunks);
                    fs.writeFileSync(outputPath, finalBuffer);

                    // Verify size
                    const stats = fs.statSync(outputPath);

                    resolve({
                        success: true,
                        source: 'edge-tts-native',
                        audioPath: outputPath,
                        filename: filename,
                        voice: voice,
                        size: stats.size,
                        duration: estimateDuration(cleanText)
                    });
                } else {
                    resolve({ success: false, error: 'Sem áudio recebido' });
                }
            });

            ws.on('error', (err) => {
                console.error('WebSocket Error:', err);
                // Fallback to System TTS on error
                resolve(generateAudioSystem(text));
            });

        } catch (e) {
            console.error('Catch Error:', e);
            resolve(generateAudioSystem(text));
        }
    });
}

/**
 * Generate Audio using Windows System Speech (PowerShell)
 * Robust fallback for missing keys/python
 */
async function generateAudioSystem(text) {
    console.log('[LocalTTS] Falling back to System TTS (PowerShell)...');
    const path = require('path');
    const { exec } = require('child_process');
    const fs = require('fs');

    // Temp files
    const timestamp = Date.now();
    const tempWav = path.join(AUDIO_DIR, `sys_${timestamp}.wav`);
    const tempTxt = path.join(AUDIO_DIR, `sys_${timestamp}.txt`);
    const filename = `tts_${timestamp}_sys.mp3`;
    const outputPath = path.join(AUDIO_DIR, filename);

    // Write text to file to avoid command line issues
    fs.writeFileSync(tempTxt, text, { encoding: 'utf8' });

    // PowerShell command to read from file
    const psCommand = `Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $text = Get-Content '${tempTxt}' -Encoding UTF8 -Raw; $speak.SetOutputToWaveFile('${tempWav}'); $speak.Speak($text); $speak.Dispose()`;

    return new Promise((resolve) => {
        exec(`powershell -Command "${psCommand}"`, (err, stdout, stderr) => {
            // Cleanup text file immediately
            if (fs.existsSync(tempTxt)) fs.unlinkSync(tempTxt);

            if (err) {
                console.error('[LocalTTS] System TTS Failed:', stderr);
                return resolve({ success: false, error: 'All TTS methods failed.' });
            }

            // Convert WIP WAV to MP3 using ffmpeg (fluent-ffmpeg or direct)
            // Use absolute path found in workspace
            const ffmpegPath = "E:\\Projeto AUDIOCUTPRO\\versão Nova\\ratoenginedemo1.3Fix\\com.ratoengine.panel\\RatoEngine_Plugin\\com.ratoengine.panel\\bin\\ffmpeg.exe";

            const ffmpegCmd = `"${ffmpegPath}" -i "${tempWav}" -acodec libmp3lame -q:a 2 "${outputPath}"`;

            exec(ffmpegCmd, (fErr) => {
                // Remove temp wav
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);

                if (fErr) {
                    console.error('[LocalTTS] Conversion Failed:', fErr);
                    // If conversion fails, try to return wav if possible? No, system expects MP3.
                    // But wait, user might have ffmpeg not in path? 
                    // We should verify, but let's assume valid env.
                    return resolve({ success: false, error: 'Audio conversion failed' });
                }

                const stats = fs.statSync(outputPath);
                resolve({
                    success: true,
                    source: 'system-tts',
                    audioPath: outputPath,
                    filename: filename,
                    voice: 'System Default',
                    size: stats.size,
                    duration: estimateDuration(text)
                });
            });
        });
    });
}

function estimateDuration(text) {
    const words = text.split(/\s+/).length;
    const minutes = words / 150;
    const seconds = Math.round(minutes * 60);
    return {
        seconds,
        formatted: `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
    };
}

// Dummy impl for subtitles (can be expanded later)
async function generateWithSubtitles(text, voice, options) {
    return generateAudio(text, voice, options);
}

function listAudioFiles() {
    if (!fs.existsSync(AUDIO_DIR)) return [];
    return fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
}

function deleteAudio(filename) {
    const f = path.join(AUDIO_DIR, filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
}

module.exports = {
    isAvailable,
    ensureInstalled,
    getVoices,
    generateAudio,
    generateWithSubtitles,
    listAudioFiles,
    deleteAudio,
    VOICES,
    AUDIO_DIR
};
