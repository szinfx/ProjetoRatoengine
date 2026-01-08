/**
 * Local LLM Service - Embedded Ollama
 * Uses Ollama from the local bin folder (no installation required)
 */

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Paths
const BIN_DIR = path.join(__dirname, '..', 'bin', 'ollama');
const MODELS_DIR = path.join(BIN_DIR, 'models');
const OLLAMA_EXE = process.platform === 'win32'
    ? path.join(BIN_DIR, 'ollama.exe')
    : path.join(BIN_DIR, 'ollama');

// Configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// Ollama process reference
let ollamaProcess = null;

/**
 * Check if embedded Ollama exists
 */
function isEmbedded() {
    return fs.existsSync(OLLAMA_EXE);
}

/**
 * Check if Ollama server is running
 */
async function isAvailable() {
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });
        return response.ok;
    } catch (e) {
        console.log('[LocalLLM] Ollama check failed:', e.message);
        return false;
    }
}

/**
 * Start the embedded Ollama server
 */
async function startServer() {
    if (!isEmbedded()) {
        console.log('[LocalLLM] Ollama not embedded. Run setup-ollama.bat first.');
        return false;
    }

    // Check if already running
    if (await isAvailable()) {
        console.log('[LocalLLM] Ollama already running');
        return true;
    }

    console.log('[LocalLLM] Starting embedded Ollama server...');

    // Set environment for local models
    const env = {
        ...process.env,
        OLLAMA_HOST: '127.0.0.1:11434',
        OLLAMA_MODELS: MODELS_DIR
    };

    // Start Ollama serve
    ollamaProcess = spawn(OLLAMA_EXE, ['serve'], {
        env,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    ollamaProcess.stdout.on('data', (data) => {
        console.log(`[Ollama] ${data.toString().trim()}`);
    });

    ollamaProcess.stderr.on('data', (data) => {
        console.log(`[Ollama] ${data.toString().trim()}`);
    });

    ollamaProcess.on('error', (err) => {
        console.error('[LocalLLM] Failed to start Ollama:', err);
    });

    ollamaProcess.on('close', (code) => {
        console.log(`[LocalLLM] Ollama exited with code ${code}`);
        ollamaProcess = null;
    });

    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await isAvailable()) {
            console.log('[LocalLLM] Ollama server started successfully');
            return true;
        }
    }

    console.log('[LocalLLM] Timeout waiting for Ollama server');
    return false;
}

/**
 * Stop the embedded Ollama server
 */
function stopServer() {
    if (ollamaProcess) {
        console.log('[LocalLLM] Stopping Ollama server...');
        ollamaProcess.kill();
        ollamaProcess = null;
    }
}

/**
 * Get available models
 */
async function getModels() {
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/tags`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.models || [];
    } catch {
        return [];
    }
}

/**
 * Check if a specific model is available
 */
async function hasModel(modelName) {
    const models = await getModels();
    return models.some(m => m.name.includes(modelName));
}

/**
 * Pull/download a model
 */
async function pullModel(modelName) {
    if (!isEmbedded()) {
        return { success: false, error: 'Ollama not embedded' };
    }

    console.log(`[LocalLLM] Pulling model: ${modelName}`);

    return new Promise((resolve) => {
        const env = { ...process.env, OLLAMA_MODELS: MODELS_DIR };
        const proc = spawn(OLLAMA_EXE, ['pull', modelName], { env, stdio: 'pipe' });

        let output = '';
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { output += data.toString(); });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, message: 'Model downloaded' });
            } else {
                resolve({ success: false, error: output });
            }
        });
    });
}

/**
 * Generate text with Ollama
 */
async function generate(prompt, options = {}) {
    // Try to start server if not running
    if (!await isAvailable()) {
        console.log('[LocalLLM] Ollama not available, attempting to start...');
        const started = await startServer();
        if (!started) {
            console.log('[LocalLLM] Failed to start Ollama');
            return {
                success: false,
                error: 'Ollama não está disponível. Execute setup-ollama.bat primeiro.',
                requiresSetup: true
            };
        }
    }

    const model = options.model || DEFAULT_MODEL;
    console.log(`[LocalLLM] Generating with model: ${model}`);

    try {
        const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: options.temperature || 0.8,
                    num_predict: options.maxTokens || 4000,
                    top_p: 0.9,
                    repeat_penalty: 1.1
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log('[LocalLLM] Ollama error:', error);
            // If model not found, try to pull it
            if (error.includes('not found')) {
                console.log(`[LocalLLM] Model not found, pulling ${model}...`);
                await pullModel(model);
                return generate(prompt, options);
            }
            return { success: false, error };
        }

        const data = await response.json();
        console.log(`[LocalLLM] Generated ${data.eval_count || 0} tokens`);

        return {
            success: true,
            source: 'ollama-local',
            model: model,
            text: data.response,
            tokens: data.eval_count
        };
    } catch (error) {
        console.log('[LocalLLM] Generate error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Chat with Ollama
 */
async function chat(messages, options = {}) {
    if (!await isAvailable()) {
        const started = await startServer();
        if (!started) {
            return { success: false, error: 'Ollama not available', requiresSetup: true };
        }
    }

    const model = options.model || DEFAULT_MODEL;

    try {
        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            return { success: false, error: await response.text() };
        }

        const data = await response.json();
        return {
            success: true,
            source: 'ollama-local',
            model: model,
            message: data.message
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Generate DETAILED video ideas for a niche
 * Uses EXPERT-LEVEL prompting with deep content creation knowledge
 */
async function researchNiche(niche, keywords = '', options = {}) {
    const referenceVideos = options.referenceVideos || [];
    const count = options.count || 10;

    console.log(`[LocalLLM] Researching: "${niche}" keywords: "${keywords}" count: ${count} refs: ${referenceVideos.length}`);

    const randomNumber = Math.floor(Math.random() * 10000);

    const contentAngles = [
        'problema não resolvido', 'segredo pouco conhecido', 'erro comum que custa caro',
        'atalho que poucos conhecem', 'verdade incômoda', 'previsão surpreendente',
        'comparação polêmica', 'experimento real', 'estudo de caso revelador'
    ];

    const selectedAngle = contentAngles[Math.floor(Math.random() * contentAngles.length)];

    // Build DETAILED reference videos context
    let refContext = '';
    if (referenceVideos.length > 0) {
        const videoAnalyses = referenceVideos.map((v, i) => {
            let analysis = `\n📹 VÍDEO ${i + 1}: "${v.title}"
   Canal: ${v.author}`;

            if (v.description) {
                analysis += `\n   📝 Descrição: "${v.description.substring(0, 300)}..."`;
            }
            if (v.tags && v.tags.length > 0) {
                analysis += `\n   🏷️ Tags: ${v.tags.slice(0, 8).join(', ')}`;
            }
            if (v.viewCount) {
                analysis += `\n   👀 Visualizações: ${v.viewCount}`;
            }
            return analysis;
        }).join('\n');

        refContext = `
═══ ANÁLISE PROFUNDA DOS VÍDEOS DE REFERÊNCIA ═══
${videoAnalyses}

🔍 VOCÊ DEVE ANALISAR:
1. PADRÃO DE TÍTULO: Que gatilhos emocionais usam? Números? Perguntas? Urgência?
2. FORMATO DO CONTEÚDO: É tutorial? Reação? Lista? Polêmica? Storytelling?
3. NICHO ESPECÍFICO: Qual é o sub-nicho exato desses vídeos?
4. PÚBLICO-ALVO: Quem provavelmente assiste esse conteúdo?
5. O QUE FAZ FUNCIONAR: Por que esse vídeo tem ${referenceVideos[0]?.viewCount || 'muitas'} views?

⚡ CRIE IDEIAS QUE:
- Usem o MESMO estilo de título (copie o padrão!)
- Abordem o MESMO público
- Explorem ÂNGULOS DIFERENTES do mesmo tema
- Poderiam ser publicadas no MESMO CANAL
`;
    }

    // Different prompts based on whether we have reference videos
    let prompt;

    if (referenceVideos.length > 0) {
        // STRICT style copying mode when reference video exists
        const mainVideo = referenceVideos[0];

        prompt = `VOCÊ É UM ESPECIALISTA EM ANÁLISE DE CONTEÚDO DO YOUTUBE.
Sua ÚNICA tarefa é gerar ideias de vídeo que COPIEM EXATAMENTE o estilo do vídeo de referência.

═══ VÍDEO DE REFERÊNCIA PARA COPIAR ═══

📹 TÍTULO ORIGINAL: "${mainVideo.title}"
👤 CANAL: ${mainVideo.author}
${mainVideo.description ? `📝 DESCRIÇÃO: "${mainVideo.description.substring(0, 400)}"` : ''}
${mainVideo.tags?.length > 0 ? `🏷️ TAGS: ${mainVideo.tags.join(', ')}` : ''}
${mainVideo.viewCount ? `👀 VIEWS: ${mainVideo.viewCount}` : ''}

═══ ANÁLISE OBRIGATÓRIA DO ESTILO ═══

Analise o título "${mainVideo.title}":

1. FORMATO DETECTADO:
   - Se tem número no início (+31, 10, 7...) = LISTICLE/COMPILADO
   - Se menciona "confirmado/confirmadas" = NOTÍCIA/ATUALIZAÇÃO
   - Se é pergunta = CONTEÚDO INFORMATIVO
   - Se tem "vs" = COMPARATIVO
   - Se tem nome de pessoa = FOCO EM PERSONALIDADE

2. PADRÃO DO TÍTULO:
   - Estrutura: [NÚMERO] + [TEMA] + [ESPECIFICIDADE]
   - Exemplo do original: "+31 CONTRATAÇÕES CONFIRMADAS DO MERCADAO DA BOLA DE 2026"
   - Padrão: [+NÚMERO] [AÇÃO/COISA] [CONTEXTO]

3. NICHO ESPECÍFICO: ${mainVideo.title.includes('FUTEBOL') || mainVideo.title.includes('BOLA') ? 'Futebol/Mercado da Bola' : 'Detectar do título'}

═══ TAREFA: GERE ${count} IDEIAS NO MESMO ESTILO ═══

${keywords ? `🔑 FOCO ADICIONAL: "${keywords}"` : ''}

REGRAS ABSOLUTAS - SIGA OU FALHE:
1. COPIE A ESTRUTURA EXATA do título original
2. Se o original tem número (+31), todos os seus títulos DEVEM ter número
3. Se o original é sobre contratações, gere sobre contratações/transferências
4. MANTENHA o mesmo nicho (futebol = futebol, não outro esporte)
5. Use CAPS LOCK onde o original usa
6. MESMO público-alvo (torcedores de futebol brasileiro)

EXEMPLOS CORRETOS baseados em "${mainVideo.title}":
- "+15 JOGADORES QUE VÃO BOMBAR EM 2026 NO BRASILEIRÃO"
- "+23 REFORÇOS ABSURDOS CONFIRMADOS PARA A LIBERTADORES 2026"
- "+40 SAÍDAS CONFIRMADAS DO FUTEBOL BRASILEIRO EM 2026"
- "+18 CONTRATAÇÕES MAIS CARAS DO FUTEBOL BRASILEIRO"

EXEMPLOS ERRADOS (NÃO FAÇA ISSO):
- "A história por trás..." (storytelling - formato diferente!)
- "Como funciona..." (tutorial - formato diferente!)
- "5 curiosidades..." (número diferente do padrão!)

{
  "ideas": [
    {
      "title": "Título que COPIA o padrão exato do original",
      "hook": "Gancho para os primeiros 3 segundos",
      "potential": "high",
      "format": "MESMO formato do vídeo original",
      "duration": "8-15 min",
      "target_audience": "${mainVideo.author ? `Público do canal ${mainVideo.author}` : 'Mesmo público do original'}",
      "why_viral": "Por que vai funcionar igual ao original",
      "tags": [5 tags relevantes ao tema],
      "thumbnail_idea": "Thumbnail no mesmo estilo"
    }
  ]
}

RETORNE APENAS JSON VÁLIDO COM ${count} IDEIAS.`;
    } else {
        // Original prompt for niche-based research without reference video
        prompt = `VOCÊ É UM CONSULTOR ELITE DE YOUTUBE COM 15 ANOS DE EXPERIÊNCIA.
Trabalhou com canais de 10M+ inscritos. Especialista em psicologia de CTR e algoritmos.

═══ SEU CONHECIMENTO ESPECIALIZADO ═══

📊 PSICOLOGIA DO CLIQUE (CTR):
- Gatilhos: curiosidade, FOMO, validação, controvérsia
- Títulos com números ímpares (3,5,7) performam 20% melhor
- Títulos entre 50-70 caracteres são ideais

🎯 FORMATOS VIRAIS:
- LISTICLES: "7 erros fatais em...", "5 segredos de..."
- DESAFIOS: "Testei X por 30 dias - resultado CHOCANTE"
- COMPARAÇÕES: "X vs Y - qual REALMENTE funciona?"
- POLÊMICAS: "Por que X está ERRADO sobre Y"
- STORYTELLING: "Como perdi R$50k com X"

═══ TAREFA ═══

🎯 NICHO: "${niche}"
${keywords ? `🔑 FOCO: "${keywords}"` : ''}
📐 ÂNGULO: ${selectedAngle}

GERE ${count} IDEIAS DE VÍDEO únicas e criativas para "${niche}".

{
  "ideas": [
    {
      "title": "Título de 50-70 caracteres",
      "hook": "Frase para os primeiros 3 segundos",
      "potential": "high",
      "format": "Formato do vídeo",
      "duration": "X-Y min",
      "target_audience": "Público-alvo específico",
      "why_viral": "Por que vai viralizar",
      "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
      "thumbnail_idea": "Descrição da thumbnail"
    }
  ]
}

REGRAS:
1. Títulos específicos para "${niche}"
2. Variar formatos entre as ideias
3. Cada ideia totalmente diferente

RETORNE APENAS JSON VÁLIDO.`;
    }

    const result = await generate(prompt, {
        temperature: 0.85,
        maxTokens: 12000 // Increased for 10 ideas
    });

    if (!result.success) {
        console.log('[LocalLLM] Research failed:', result.error);
        return result;
    }

    console.log('[LocalLLM] Raw response length:', result.text?.length || 0);

    try {
        // Extract JSON from response - handle various formats including truncated
        let jsonText = result.text;

        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/```json\n ? /g, '').replace(/```\n?/g, '');

        // Try to find the JSON object
        let ideas = [];

        // Method 1: Try to find complete JSON
        const jsonMatch = jsonText.match(/\{[\s\S]*"ideas"\s*:\s*\[[\s\S]*\]\s*\}/);
        if (jsonMatch) {
            try {
                const data = JSON.parse(jsonMatch[0]);
                ideas = data.ideas || [];
            } catch (e) {
                console.log('[LocalLLM] Full JSON parse failed, trying partial extraction');
            }
        }

        // Method 2: Extract individual idea objects if JSON is truncated
        if (ideas.length === 0) {
            // Find all complete idea objects using regex
            const ideaRegex = /\{\s*"title"\s*:\s*"([^"]+)"[^}]*"hook"\s*:\s*"([^"]*)"[^}]*"potential"\s*:\s*"([^"]*)"[^}]*"format"\s*:\s*"([^"]*)"[^}]*\}/g;
            let match;
            while ((match = ideaRegex.exec(jsonText)) !== null) {
                ideas.push({
                    title: match[1],
                    hook: match[2],
                    potential: match[3] || 'high',
                    format: match[4] || 'Vídeo'
                });
            }

            // If still no ideas, try simpler extraction
            if (ideas.length === 0) {
                const titleMatches = jsonText.matchAll(/"title"\s*:\s*"([^"]+)"/g);
                const hookMatches = jsonText.matchAll(/"hook"\s*:\s*"([^"]+)"/g);

                const titles = [...titleMatches].map(m => m[1]);
                const hooks = [...hookMatches].map(m => m[1]);

                for (let i = 0; i < titles.length; i++) {
                    ideas.push({
                        title: titles[i],
                        hook: hooks[i] || titles[i],
                        potential: 'high',
                        format: 'Vídeo'
                    });
                }
            }
        }

        if (ideas.length > 0) {
            console.log(`[LocalLLM] Extracted ${ideas.length} ideas`);

            // Validate and complete ideas
            const validatedIdeas = ideas.map(idea => ({
                title: idea.title || 'Sem título',
                hook: idea.hook || idea.title,
                potential: idea.potential || 'high',
                format: idea.format || 'Vídeo',
                duration: idea.duration || '8-12 min',
                target_audience: idea.target_audience || 'Geral',
                why_viral: idea.why_viral || 'Alto potencial viral',
                tags: idea.tags || [],
                thumbnail_idea: idea.thumbnail_idea || ''
            }));

            return {
                success: true,
                source: 'ollama-local',
                ideas: validatedIdeas,
                niche: niche,
                keywords: keywords
            };
        }

        console.log('[LocalLLM] No ideas extracted from response');
        return { success: false, error: 'Não foi possível extrair ideias da resposta' };
    } catch (e) {
        console.log('[LocalLLM] JSON parse error:', e.message);
        console.log('[LocalLLM] Raw response:', result.text?.substring(0, 500));
        return { success: false, error: 'Erro ao processar resposta: ' + e.message };
    }
}

/**
 * Generate DETAILED video script
 */
async function generateScript(idea, platform = 'youtube', style = 'informative') {
    console.log(`[LocalLLM] Generating script for: "${idea}"(${platform} / ${style})`);

    const platformGuides = {
        youtube: {
            duration: '8-15 minutos',
            format: 'Vídeo longo com introdução cativante, 3-5 pontos principais e CTA',
            style: 'Use linguagem conversacional, inclua histórias e exemplos'
        },
        tiktok: {
            duration: '30-60 segundos',
            format: 'Gancho imediato, conteúdo rápido e direto, sem enrolação',
            style: 'Energia alta, texto na tela, trending sounds'
        },
        shorts: {
            duration: '15-60 segundos',
            format: 'Vertical, ritmo rápido, gancho nos primeiros 2 segundos',
            style: 'Visual, dinâmico, com cortes rápidos'
        }
    };

    const guide = platformGuides[platform] || platformGuides.youtube;

    const prompt = `Você é um ROTEIRISTA PROFISSIONAL de YouTube com milhões de views.
Crie um roteiro COMPLETO e PRONTO PARA GRAVAR.

📹 VÍDEO: "${idea}"
📱 PLATAFORMA: ${platform.toUpperCase()}
🎬 ESTILO: ${style}
⏱️ DURAÇÃO: ${guide.duration}
📝 FORMATO: ${guide.format}

ESTRUTURA DO ROTEIRO:

═══════════════════════════════════════
🎯[GANCHO - 0:00 a 0:05]
═══════════════════════════════════════
Primeiros segundos CRUCIAIS para prender atenção.
Comece com uma frase IMPACTANTE, pergunta ou estatística.

═══════════════════════════════════════
👋[INTRO - 0:05 a 0: 30]
═══════════════════════════════════════
Apresente o tema de forma envolvente.
Prometa o que o espectador vai ganhar assistindo.
CTA para like e inscrição(natural, não forçado).

═══════════════════════════════════════
📚[CONTEÚDO PRINCIPAL]
═══════════════════════════════════════
Divida em seções com timestamps.
Para cada ponto:
        - NARRAÇÃO: O que você vai falar(texto exato)
            - VISUAL: O que aparece na tela
                - B - ROLL: Sugestões de imagens / vídeos

${platform === 'youtube' ? `
[PONTO 1 - 0:30 a 2:30]
...detalhes...

[PONTO 2 - 2:30 a 5:00]
...detalhes...

[PONTO 3 - 5:00 a 7:30]
...detalhes...
` : ''
        }

═══════════════════════════════════════
🔥[CTA FINAL]
═══════════════════════════════════════
Chamada para ação convincente.
Mencione próximo vídeo ou playlist.

═══════════════════════════════════════
📝 NOTAS DE PRODUÇÃO
═══════════════════════════════════════
        - Música sugerida
            - Estilo de edição
                - Dicas de thumbnail

ESCREVA O ROTEIRO COMPLETO EM PORTUGUÊS BRASILEIRO: `;

    const result = await generate(prompt, {
        temperature: 0.7,
        maxTokens: 6000
    });

    if (!result.success) {
        console.log('[LocalLLM] Script generation failed:', result.error);
        return result;
    }

    console.log('[LocalLLM] Script generated, length:', result.text?.length || 0);

    return {
        success: true,
        source: 'ollama-local',
        script: result.text,
        platform: platform,
        style: style,
        idea: idea
    };
}

// AI DIRECTOR: Plans scenes from script
async function planVideoScenes(scriptText) {
    console.log('[LocalLLM] Director planning scenes...');
    const prompt = `Você é um DIRETOR DE VÍDEO experiente.
Analise o seguinte roteiro e divida-o em 4 a 8 cenas visuais lógicas.
Para cada cena, extraia o texto falado e defina uma busca visual em INGLÊS para encontrar vídeos de stock (Pexels).

ROTEIRO:
"${scriptText.replace(/"/g, "'").substring(0, 2000)}"

SAÍDA ESTRITAMENTE EM JSON, neste formato:
{
  "scenes": [
    { "text": "texto falado nesta parte...", "visual_query": "happy person office" },
    { "text": "continuação do texto...", "visual_query": "city rain dark" }
  ]
}

Responda APENAS o JSON.`;

    const result = await generate(prompt, { temperature: 0.2, format: 'json' });

    if (!result.success) return { success: false, scenes: [] };

    try {
        const cleanJson = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return { success: true, scenes: parsed.scenes || [] };
    } catch (e) {
        console.error('[LocalLLM] JSON Parse Error:', e);
        // Fallback: Return whole script as 1 scene
        return { success: true, scenes: [{ text: scriptText, visual_query: "cinematic background" }] };
    }
}

/**
 * Get status info
 */
async function getStatus() {
    const embedded = isEmbedded();
    const available = await isAvailable();
    const models = available ? await getModels() : [];

    return {
        embedded: embedded,
        running: available,
        models: models.map(m => m.name),
        defaultModel: DEFAULT_MODEL,
        ollamaPath: OLLAMA_EXE,
        modelsPath: MODELS_DIR
    };
}

// Cleanup on exit
process.on('exit', stopServer);
process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);

module.exports = {
    isEmbedded,
    isAvailable,
    startServer,
    stopServer,
    getModels,
    hasModel,
    pullModel,
    generate,
    chat,
    researchNiche,
    generateScript,
    planVideoScenes,
    getStatus,
    DEFAULT_MODEL
};
