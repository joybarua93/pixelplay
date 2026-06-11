// ─── PixelPlay Sound Engine ───────────────────────────────────────────────
const SFX = (() => {
    let ctx = null;
    function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx;
    }
    function play({ frequency = 440, type = 'square', duration = 0.1,
                    volume = 0.3, slide = 0, attack = 0.01, decay = 0.05,
                    vibrato = 0, vibratoSpeed = 10 }) {
        try {
            const c = getCtx();
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.connect(gain);
            gain.connect(c.destination);
            osc.type = type;
            const t = c.currentTime;
            osc.frequency.setValueAtTime(frequency, t);
            if (slide) osc.frequency.linearRampToValueAtTime(frequency + slide, t + duration);
            if (vibrato) {
                const lfo = c.createOscillator();
                const lfoGain = c.createGain();
                lfo.connect(lfoGain);
                lfoGain.connect(osc.frequency);
                lfo.frequency.value = vibratoSpeed;
                lfoGain.gain.value = vibrato;
                lfo.start(t); lfo.stop(t + duration);
            }
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(volume, t + attack);
            gain.gain.setValueAtTime(volume, t + duration - decay);
            gain.gain.linearRampToValueAtTime(0, t + duration);
            osc.start(t); osc.stop(t + duration);
        } catch(e) {}
    }
    function noise({ duration = 0.1, volume = 0.2, lowpass = 800 }) {
        try {
            const c = getCtx();
            const bufSize = c.sampleRate * duration;
            const buf = c.createBuffer(1, bufSize, c.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
            const src = c.createBufferSource();
            src.buffer = buf;
            const filter = c.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = lowpass;
            const gain = c.createGain();
            gain.gain.setValueAtTime(volume, c.currentTime);
            gain.gain.linearRampToValueAtTime(0, c.currentTime + duration);
            src.connect(filter); filter.connect(gain); gain.connect(c.destination);
            src.start(); src.stop(c.currentTime + duration);
        } catch(e) {}
    }
    document.addEventListener('click',      () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    document.addEventListener('keydown',    () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    document.addEventListener('touchstart', () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    return { play, noise };
})();

// ─── Sound Functions ──────────────────────────────────────────────────────
function sfxMove()     { SFX.play({ frequency: 220, type: 'square',    duration: 0.05, volume: 0.15, slide: 20 }); }
function sfxRotate()   { SFX.play({ frequency: 330, type: 'square',    duration: 0.07, volume: 0.18, slide: 50 }); }
function sfxLand()     { SFX.noise({ duration: 0.08, volume: 0.25, lowpass: 400 }); }
function sfxClear()    { SFX.play({ frequency: 440, type: 'sine',      duration: 0.18, volume: 0.3,  slide: 220 }); }
function sfxTetrix()   {
    [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.35 }), i * 80));
}
function sfxGameOver() { SFX.play({ frequency: 220, type: 'sawtooth', duration: 0.6, volume: 0.3, slide: -180 }); }
function sfxLevelUp()  {
    [440, 550, 660, 880].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.1, volume: 0.25 }), i * 60));
}

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;

const STORAGE_KEY = 'pixelplay_tetrix_best';
function getBest()       { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest(score) { if (score > getBest()) localStorage.setItem(STORAGE_KEY, String(score)); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (!gamePaused) resumeGameLoop();
}
function resumeGameLoop() {
    lastTime = 0;
    requestAnimationFrame(gameLoop);
}
function restartGame() {
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    startNewGame(currentDifficulty);
}
function goToTitleScreen() {
    gameRunning = false;
    gamePaused  = false;
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('pp-back').style.display = 'flex';
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
}

// ─── Grid Constants ───────────────────────────────────────────────────────
const COLS        = 10;
const ROWS        = 20;
const BLOCK_SIZE  = 35;          // 35 × 20 = 700, 35 × 10 = 350
const GAME_WIDTH  = COLS * BLOCK_SIZE;   // 350
const GAME_HEIGHT = ROWS * BLOCK_SIZE;   // 700
const ASPECT      = GAME_WIDTH / GAME_HEIGHT;
let blockSize = BLOCK_SIZE;
let grid = [];

// ─── DOM references (assigned in DOMContentLoaded) ────────────────────────
let canvas, ctx, scoreEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn, diffButtons;

// ─── Game State ───────────────────────────────────────────────────────────
let score = 0;
let isGameOver = false;
let gameRunning = false;
let dropCounter = 0;
let lastTime = 0;
let currentDifficulty = 'medium';
let totalLines = 0;
let currentLevel = 1;

const difficultySettings = {
    easy:   { dropInterval: 1000, scoreMultiplier: 1 },
    medium: { dropInterval: 600,  scoreMultiplier: 2 },
    hard:   { dropInterval: 250,  scoreMultiplier: 3 }
};

const SHAPES = [
    { matrix: [[1, 1, 1, 1]],                          color: '#00F0F0' }, // I
    { matrix: [[1, 1, 1], [0, 1, 0]],                  color: '#A000F0' }, // T
    { matrix: [[1, 1, 1], [1, 0, 0]],                  color: '#F0A000' }, // L
    { matrix: [[1, 1, 1], [0, 0, 1]],                  color: '#0080FF' }, // J
    { matrix: [[1, 1], [1, 1]],                         color: '#F0F000' }, // O
    { matrix: [[1, 1, 0], [0, 1, 1]],                  color: '#00F000' }, // S
    { matrix: [[0, 1, 1], [1, 1, 0]],                  color: '#F00000' }  // Z
];

let piece = { matrix: null, color: null, x: 0, y: 0 };

// ─── Title animation state ────────────────────────────────────────────────
let titlePieces = [];
let titleAnimFrame = null;

function initTitlePieces() {
    titlePieces = [];
    for (let i = 0; i < 8; i++) {
        const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
        titlePieces.push({
            matrix: shape.matrix.map(r => [...r]),
            color: shape.color,
            x: Math.random() * COLS,
            y: (Math.random() * ROWS) - ROWS,
            speed: 0.015 + Math.random() * 0.025
        });
    }
}

function drawTitleAnimation() {
    if (gameRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.15;
    titlePieces.forEach(p => {
        ctx.fillStyle = p.color;
        p.matrix.forEach((row, r) => {
            row.forEach((val, c) => {
                if (val) {
                    ctx.fillRect(
                        (p.x + c) * blockSize,
                        (p.y + r) * blockSize,
                        blockSize - 1,
                        blockSize - 1
                    );
                }
            });
        });
        p.y += p.speed;
        if (p.y > ROWS + 4) {
            p.y = -4;
            p.x = Math.random() * (COLS - 2);
            const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
            p.matrix = shape.matrix.map(r => [...r]);
            p.color = shape.color;
        }
    });
    ctx.globalAlpha = 1.0;
    if (!gameRunning) titleAnimFrame = requestAnimationFrame(drawTitleAnimation);
}

// ─── Core Game Functions ──────────────────────────────────────────────────
function resizeCanvas() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let newW, newH;
    if (winW / winH > ASPECT) {
        newH = winH;
        newW = newH * ASPECT;
    } else {
        newW = winW;
        newH = newW / ASPECT;
    }
    canvas.style.width  = newW + 'px';
    canvas.style.height = newH + 'px';
}

function createGrid() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function spawnPiece() {
    const randomType = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    piece.matrix = randomType.matrix;
    piece.color  = randomType.color;
    piece.y = 0;
    piece.x = Math.floor((COLS - piece.matrix[0].length) / 2);

    if (checkCollision()) {
        isGameOver = true;
        gameRunning = false;
        sfxGameOver();
        saveBest(score);
        if (bestScoreEl) bestScoreEl.textContent = getBest();
        finalScoreEl.textContent = score;
        gameOverScreen.classList.remove('hidden');
    }
}

function checkCollision(offsetX = 0, offsetY = 0, customMatrix = piece.matrix) {
    for (let r = 0; r < customMatrix.length; r++) {
        for (let c = 0; c < customMatrix[r].length; c++) {
            if (customMatrix[r][c] !== 0) {
                let nextX = piece.x + c + offsetX;
                let nextY = piece.y + r + offsetY;
                if (nextX < 0 || nextX >= COLS || nextY >= ROWS) return true;
                if (nextY >= 0 && grid[nextY][nextX] !== 0)       return true;
            }
        }
    }
    return false;
}

function mergePieceToGrid() {
    piece.matrix.forEach((row, r) => {
        row.forEach((value, c) => {
            if (value !== 0 && piece.y + r >= 0) {
                grid[piece.y + r][piece.x + c] = piece.color;
            }
        });
    });
}

function clearLines() {
    let linesCleared = 0;
    const config = difficultySettings[currentDifficulty];

    for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r].every(value => value !== 0)) {
            grid.splice(r, 1);
            grid.unshift(Array(COLS).fill(0));
            linesCleared++;
            r++;
        }
    }

    if (linesCleared > 0) {
        const basePoints = [0, 100, 300, 500, 800];
        score += (basePoints[linesCleared] || 800) * config.scoreMultiplier;
        scoreEl.textContent = score;

        if (linesCleared === 4) sfxTetrix();
        else sfxClear();

        const prevLevel = currentLevel;
        totalLines += linesCleared;
        currentLevel = Math.floor(totalLines / 10) + 1;
        if (currentLevel > prevLevel) sfxLevelUp();
    }
}

function rotatePiece() {
    const nextMatrix = piece.matrix[0].map((_, i) => piece.matrix.map(row => row[i])).map(row => row.reverse());
    let originalX = piece.x;
    let offset = 1;
    while (checkCollision(0, 0, nextMatrix)) {
        piece.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > piece.matrix[0].length) {
            piece.x = originalX;
            return;
        }
    }
    piece.matrix = nextMatrix;
    sfxRotate();
}

function dropPiece() {
    piece.y++;
    if (checkCollision(0, 0)) {
        piece.y--;
        mergePieceToGrid();
        sfxLand();
        clearLines();
        spawnPiece();
    }
    dropCounter = 0;
}

function movePiece(dir) {
    if (dir === 'left'  && !checkCollision(-1, 0)) { piece.x--; sfxMove(); }
    if (dir === 'right' && !checkCollision( 1, 0)) { piece.x++; sfxMove(); }
    if (dir === 'down') dropPiece();
}

function startNewGame(difficultySelection) {
    currentDifficulty = difficultySelection;
    score        = 0;
    isGameOver   = false;
    gameRunning  = true;
    gamePaused   = false;
    dropCounter  = 0;
    lastTime     = 0;
    totalLines   = 0;
    currentLevel = 1;

    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');

    if (titleAnimFrame) { cancelAnimationFrame(titleAnimFrame); titleAnimFrame = null; }

    resizeCanvas();
    createGrid();
    spawnPiece();
    requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp = 0) {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;

    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    dropCounter += deltaTime;

    const config = difficultySettings[currentDifficulty];
    if (dropCounter >= config.dropInterval) dropPiece();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    grid.forEach((row, r) => {
        row.forEach((value, c) => {
            if (value !== 0) {
                ctx.fillStyle = value;
                ctx.fillRect(c * blockSize, r * blockSize, blockSize - 1, blockSize - 1);
            }
        });
    });

    if (piece.matrix) {
        ctx.fillStyle = piece.color;
        piece.matrix.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value !== 0) {
                    ctx.fillRect((piece.x + c) * blockSize, (piece.y + r) * blockSize, blockSize - 1, blockSize - 1);
                }
            });
        });
    }

    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas        = document.getElementById('gameCanvas');
    ctx           = canvas.getContext('2d');
    scoreEl       = document.getElementById('score');
    finalScoreEl  = document.getElementById('final-score');
    bestScoreEl   = document.getElementById('best-score');
    titleBestEl   = document.getElementById('title-best');
    startMenu     = document.getElementById('start-menu');
    gameOverScreen = document.getElementById('game-over-screen');
    restartBtn    = document.getElementById('restart-btn');
    diffButtons   = document.querySelectorAll('.btn-group .menu-btn');

    if (titleBestEl) titleBestEl.textContent = getBest();

    canvas.width  = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;
    blockSize     = BLOCK_SIZE;

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) { togglePause(); return; }
        if (!gameRunning || isGameOver || gamePaused) return;
        if (['ArrowLeft',  'KeyA'].includes(e.code)) movePiece('left');
        if (['ArrowRight', 'KeyD'].includes(e.code)) movePiece('right');
        if (['ArrowDown',  'KeyS'].includes(e.code)) movePiece('down');
        if (['ArrowUp',    'KeyW'].includes(e.code)) rotatePiece();
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    canvas.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
    });
    canvas.addEventListener('touchend', (e) => {
        if (!gameRunning || isGameOver || gamePaused) return;
        const diffX = e.changedTouches[0].clientX - touchStartX;
        const diffY = e.changedTouches[0].clientY - touchStartY;
        const duration = Date.now() - touchStartTime;

        const swipeThreshY = window.innerHeight * 0.05;
        const swipeThreshX = window.innerWidth * 0.05;
        const tapThresh = 15;

        if (diffY > swipeThreshY && Math.abs(diffX) < swipeThreshX * 1.5) {
            // Swipe down
            while (!checkCollision(0, 1)) { piece.y++; }
            dropPiece();
        } else if (Math.abs(diffX) < tapThresh && Math.abs(diffY) < tapThresh && duration < 300) {
            // Short tap
            rotatePiece();
        } else if (Math.abs(diffX) > swipeThreshX) {
            // Swipe horizontal
            movePiece(diffX > 0 ? 'right' : 'left');
        }
    });

    diffButtons.forEach(btn => {
        btn.addEventListener('click', () => startNewGame(btn.getAttribute('data-difficulty')));
    });

    restartBtn.addEventListener('click', () => {
        gameOverScreen.classList.add('hidden');
        startMenu.classList.remove('hidden');
        if (titleBestEl) titleBestEl.textContent = getBest();
        if (!titleAnimFrame) { initTitlePieces(); drawTitleAnimation(); }
    });

    resizeCanvas();
    initTitlePieces();
    drawTitleAnimation();
});
