/**
 * Template System - Fallback when no AI is available
 * Provides pre-built templates for scripts, ideas, etc.
 */

// Video idea templates by niche
const IDEA_TEMPLATES = {
    default: [
        { title: 'Os 5 ERROS que TODO INICIANTE comete em {niche}', potential: 'high', format: 'lista', duration: '8-10 min' },
        { title: 'Como eu fiz R$10.000 com {niche} (passo a passo)', potential: 'high', format: 'tutorial', duration: '12-15 min' },
        { title: '{niche} em 2024: O Guia DEFINITIVO para Iniciantes', potential: 'medium', format: 'tutorial', duration: '15-20 min' },
        { title: 'Testei {niche} por 30 dias e OLHA O QUE ACONTECEU', potential: 'high', format: 'vlog', duration: '10-12 min' },
        { title: 'A VERDADE sobre {niche} que ninguém te conta', potential: 'medium', format: 'commentary', duration: '8-10 min' }
    ],
    tecnologia: [
        { title: 'Vale a pena comprar {niche} em 2024?', potential: 'high', format: 'review', duration: '10-12 min' },
        { title: '{niche}: Comparativo COMPLETO dos melhores', potential: 'high', format: 'lista', duration: '15-20 min' },
        { title: 'Setup PERFEITO de {niche} gastando POUCO', potential: 'medium', format: 'tutorial', duration: '12-15 min' },
        { title: 'O que NINGUÉM te conta sobre {niche}', potential: 'high', format: 'commentary', duration: '8-10 min' },
        { title: 'Unboxing e primeira impressão: {niche}', potential: 'medium', format: 'vlog', duration: '8-10 min' }
    ],
    finanças: [
        { title: 'Como INVESTIR em {niche} do ZERO', potential: 'high', format: 'tutorial', duration: '15-20 min' },
        { title: '{niche}: Quanto RENDE por mês? (Números REAIS)', potential: 'high', format: 'lista', duration: '10-12 min' },
        { title: 'Os 7 ERROS que fazem você PERDER DINHEIRO em {niche}', potential: 'high', format: 'lista', duration: '12-15 min' },
        { title: '{niche} para INICIANTES: Comece com R$100', potential: 'medium', format: 'tutorial', duration: '10-12 min' },
        { title: 'Minha carteira de {niche}: Resultados REAIS', potential: 'medium', format: 'vlog', duration: '8-10 min' }
    ],
    games: [
        { title: 'TIER LIST definitiva de {niche}', potential: 'high', format: 'lista', duration: '15-20 min' },
        { title: 'Dicas que vão te fazer PRO em {niche}', potential: 'high', format: 'tutorial', duration: '10-12 min' },
        { title: '{niche}: Do NOOB ao PRO em 24 horas', potential: 'high', format: 'vlog', duration: '20-25 min' },
        { title: 'Os MELHORES segredos de {niche}', potential: 'medium', format: 'lista', duration: '12-15 min' },
        { title: 'Reação ao gameplay de {niche}', potential: 'medium', format: 'reaction', duration: '15-20 min' }
    ]
};

// Script templates by platform
const SCRIPT_TEMPLATES = {
    youtube: `# ROTEIRO: {title}
Plataforma: YouTube
Duração estimada: 8-12 minutos

---

## [00:00-00:15] 🎬 HOOK

**Narração:**
"{hook}"

**Visual:** Close no rosto, expressão de surpresa/curiosidade
**Música:** Tensão crescente
**Texto na tela:** "{textOverlay}"

---

## [00:15-01:00] 📌 INTRODUÇÃO

**Narração:**
"Fala pessoal! Sejam muito bem-vindos ao canal. Hoje vamos falar sobre {topic} e eu vou te mostrar {promise}."

"Antes de começar, se você ainda não é inscrito, aproveita e se inscreve, ativa o sininho que eu posto vídeo toda semana!"

**Visual:** B-roll do tema, transições dinâmicas
**Música:** Upbeat, energética

---

## [01:00-08:00] 📚 CONTEÚDO PRINCIPAL

### Ponto 1: {point1}
**Narração:** 
"O primeiro ponto que você precisa saber é..."

**B-roll sugerido:** Demonstrações práticas
**Texto overlay:** Destaque pontos importantes

---

### Ponto 2: {point2}
**Narração:**
"Agora vamos para o segundo ponto..."

**Transição:** Zoom dinâmico

---

### Ponto 3: {point3}
**Narração:**
"E por último, mas não menos importante..."

---

## [08:00-09:00] 💬 ENGAJAMENTO

**Narração:**
"E aí, qual desses pontos você achou mais interessante? Comenta aqui embaixo que eu leio todos os comentários!"

"Se esse vídeo te ajudou, deixa aquele like que me ajuda MUITO a continuar produzindo conteúdo gratuito pra vocês."

---

## [09:00-09:30] 📢 CTA FINAL

**Narração:**
"Se você quer se aprofundar mais nesse assunto, clica nesse vídeo aqui que eu tenho certeza que vai te ajudar!"

"Nos vemos no próximo vídeo, valeu!"

**Visual:** End screen com vídeo sugerido
**Música:** Fade out

---

## 📝 NOTAS DE PRODUÇÃO

- Filmagem: [Local/Estúdio]
- Equipamento: [Câmera, microfone]
- Edição estimada: [X horas]
- Thumbnail: [Descrição da thumb]
`,

    tiktok: `# ROTEIRO TIKTOK: {title}
Duração: 60-90 segundos
Formato: Vertical (9:16)

---

## [0-3s] 🎯 HOOK FORTE

**Narração (rápida):**
"{hook}"

**Visual:** Close extremo, movimento
**Texto grande:** "{textOverlay}"

---

## [3-15s] ⚡ CONTEXTO RÁPIDO

**Narração:**
"{context}"

**Transições:** Cortes rápidos, zoom ins

---

## [15-50s] 💡 CONTEÚDO

**Ponto 1:** "{point1}"
*[Corte]*
**Ponto 2:** "{point2}"
*[Corte]*
**Ponto 3:** "{point3}"

**Música:** Trending sound
**Texto:** Legenda auto + destaques

---

## [50-60s] 🔥 CONCLUSÃO + CTA

**Narração:**
"{conclusion}"
"Segue pra mais dicas!"

**Visual:** Apontar para botão de seguir

---

## 📝 NOTAS

- Som trending: [Nome]
- Hashtags: #fyp #{niche} #dica
- Melhor horário: 19h-21h
`,

    shorts: `# ROTEIRO SHORTS: {title}
Duração: 30-60 segundos
Formato: Vertical (9:16)

---

## [0-2s] 🎯 HOOK

"{hook}"

---

## [2-25s] 💡 VALOR

{content}

---

## [25-30s] 📢 CTA

"Deixa o like e segue pra mais!"

---

## 📝 NOTAS

- Cortes ultra-rápidos
- Legenda grande
- Sem introdução
`
};

/**
 * Generate ideas using templates
 */
function generateIdeas(niche, category = 'default') {
    const templates = IDEA_TEMPLATES[category] || IDEA_TEMPLATES.default;

    return templates.map(template => ({
        ...template,
        title: template.title.replace(/{niche}/g, niche),
        reason: `Template otimizado para engajamento em ${category}`
    }));
}

/**
 * Generate script using templates
 */
function generateScript(title, platform = 'youtube', options = {}) {
    const template = SCRIPT_TEMPLATES[platform] || SCRIPT_TEMPLATES.youtube;

    const variables = {
        title: title,
        hook: options.hook || `Você sabia que a maioria das pessoas está fazendo ${title} ERRADO?`,
        textOverlay: options.textOverlay || title.toUpperCase(),
        topic: options.topic || title,
        promise: options.promise || 'exatamente como fazer do jeito certo',
        point1: options.point1 || 'o primeiro passo essencial',
        point2: options.point2 || 'o erro mais comum a evitar',
        point3: options.point3 || 'a técnica avançada que poucos conhecem',
        context: options.context || `Todo mundo fala sobre isso, mas poucos entendem de verdade`,
        conclusion: options.conclusion || `Agora você sabe o que a maioria ignora`,
        content: options.content || `• Ponto 1: ${options.point1 || 'Dica importante'}\n• Ponto 2: ${options.point2 || 'Técnica essencial'}\n• Ponto 3: ${options.point3 || 'Segredo avançado'}`,
        niche: options.niche || 'conteúdo'
    };

    let script = template;
    for (const [key, value] of Object.entries(variables)) {
        script = script.replace(new RegExp(`{${key}}`, 'g'), value);
    }

    return {
        success: true,
        source: 'template',
        script: script,
        platform: platform,
        variables: variables
    };
}

/**
 * Get available template categories
 */
function getCategories() {
    return Object.keys(IDEA_TEMPLATES);
}

/**
 * Get available platforms
 */
function getPlatforms() {
    return Object.keys(SCRIPT_TEMPLATES);
}

module.exports = {
    generateIdeas,
    generateScript,
    getCategories,
    getPlatforms,
    IDEA_TEMPLATES,
    SCRIPT_TEMPLATES
};
