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
    document.getElementById('info-bar').style.display = 'none';
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
    { matrix: [[1, 1, 1, 1]],                          color: '#38AAEE' }, // I - PixelPlay blue
    { matrix: [[1, 1, 1], [0, 1, 0]],                  color: '#8B5CF6' }, // T - PixelPlay purple
    { matrix: [[1, 1, 1], [1, 0, 0]],                  color: '#F97316' }, // L - PixelPlay orange
    { matrix: [[1, 1, 1], [0, 0, 1]],                  color: '#2A3660' }, // J - PixelPlay navy
    { matrix: [[1, 1], [1, 1]],                         color: '#F5C200' }, // O - PixelPlay yellow
    { matrix: [[1, 1, 0], [0, 1, 1]],                  color: '#3DC46A' }, // S - PixelPlay green
    { matrix: [[0, 1, 1], [1, 1, 0]],                  color: '#E84040' }  // Z - PixelPlay red
];

let piece = { matrix: null, color: null, x: 0, y: 0 };
let nextPiece = null;
let flashFrames = 0;

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
    const BAR_H = 64;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight - BAR_H;
    canvas.style.position = 'fixed';
    canvas.style.top      = BAR_H + 'px';
    canvas.style.left     = '0px';
    canvas.style.width    = canvas.width  + 'px';
    canvas.style.height   = canvas.height + 'px';
    blockSize = Math.min(
        Math.floor(canvas.width  / COLS),
        Math.floor(canvas.height / ROWS)
    );
}

function createGrid() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function spawnPiece() {
    if (!nextPiece) {
        const t = SHAPES[Math.floor(Math.random() * SHAPES.length)];
        nextPiece = { matrix: t.matrix, color: t.color };
    }
    piece.matrix = nextPiece.matrix;
    piece.color  = nextPiece.color;
    piece.y = 0;
    piece.x = Math.floor((COLS - piece.matrix[0].length) / 2);

    const t2 = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    nextPiece = { matrix: t2.matrix, color: t2.color };

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

function checkCollision(dx = 0, dy = 0, matrix = null, testY = null) {
    const m = matrix || piece.matrix;
    const py = testY !== null ? testY : piece.y;
    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (m[r][c] !== 0) {
                const nx = piece.x + c + dx;
                const ny = py + r + dy;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
                if (ny >= 0 && grid[ny]?.[nx] !== 0)    return true;
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
        const lineScores = [0, 150, 400, 750, 1200];
        score += (lineScores[linesCleared] || 1200) * currentLevel * config.scoreMultiplier;
        scoreEl.textContent = score;

        if (linesCleared === 4) sfxTetrix();
        else sfxClear();

        const prevLevel = currentLevel;
        totalLines += linesCleared;
        currentLevel = Math.floor(totalLines / 10) + 1;
        if (currentLevel > prevLevel) sfxLevelUp();
        const levelEl = document.getElementById('level-display');
        if (levelEl) levelEl.textContent = currentLevel;
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
    flashPiece();
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
    nextPiece    = null;
    flashFrames  = 0;

    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    const levelEl = document.getElementById('level-display');
    if (levelEl) levelEl.textContent = currentLevel;
    startMenu.classList.add('hidden');
    document.getElementById('info-bar').style.display = 'flex';
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');

    if (titleAnimFrame) { cancelAnimationFrame(titleAnimFrame); titleAnimFrame = null; }

    resizeCanvas();
    createGrid();
    spawnPiece();
    requestAnimationFrame(gameLoop);
}

function flashPiece() { flashFrames = 4; }

function drawGhostPiece() {
    if (!piece || !piece.matrix) return;
    let ghostY = piece.y;
    while (!checkCollision(0, 0, null, ghostY + 1)) ghostY++;
    if (ghostY === piece.y) return;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = piece.color;
    piece.matrix.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val !== 0) {
                ctx.fillRect(
                    (piece.x + c) * blockSize,
                    (ghostY + r)  * blockSize,
                    blockSize - 1, blockSize - 1
                );
            }
        });
    });
    ctx.restore();
}

function drawNextPiecePreview() {
    const nc = document.getElementById('next-canvas');
    if (!nc || !nextPiece) return;
    const nctx = nc.getContext('2d');
    nctx.clearRect(0, 0, 48, 48);
    const m = nextPiece.matrix;
    const rows = m.length, cols = m[0].length;
    const bSize = Math.floor(Math.min(48 / cols, 48 / rows)) - 1;
    const offsetX = Math.floor((48 - cols * bSize) / 2);
    const offsetY = Math.floor((48 - rows * bSize) / 2);
    m.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val) {
                nctx.fillStyle = nextPiece.color;
                nctx.shadowColor = nextPiece.color;
                nctx.shadowBlur = 4;
                nctx.fillRect(offsetX + c * bSize, offsetY + r * bSize, bSize - 1, bSize - 1);
            }
        });
    });
    nctx.shadowBlur = 0;
}

function drawBlock(x, y, color) {
    const bx = x * blockSize;
    const by = y * blockSize;
    const bs = blockSize - 1;
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, bs, bs);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx + 1, by + 1, bs - 2, 3);
    ctx.fillRect(bx + 1, by + 1, 3, bs - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(bx + 1, by + bs - 4, bs - 2, 3);
    ctx.fillRect(bx + bs - 4, by + 1, 3, bs - 2);
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
                ctx.shadowColor = value;
                ctx.shadowBlur  = 8;
                drawBlock(c, r, value);
                ctx.shadowBlur  = 0;
            }
        });
    });

    drawNextPiecePreview();
    drawGhostPiece();

    if (piece.matrix) {
        piece.matrix.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value !== 0) {
                    const col = flashFrames > 0 ? '#ffffff' : piece.color;
                    ctx.shadowColor = col;
                    ctx.shadowBlur  = flashFrames > 0 ? 16 : 10;
                    drawBlock(piece.x + c, piece.y + r, col);
                    ctx.shadowBlur  = 0;
                }
            });
        });
        if (flashFrames > 0) flashFrames--;
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

    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    let touchLastMoveX = 0, touchMoveThrottleTime = 0;
    let touchMoved = false;
    const SWIPE_THRESH_X = window.innerWidth  * 0.06;
    const SWIPE_THRESH_Y = window.innerHeight * 0.06;
    const TAP_THRESH     = 18;
    const TAP_MAX_MS     = 220;
    const MOVE_THROTTLE  = 80;

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchLastMoveX = t.clientX;
        touchStartTime = Date.now();
        touchMoved = false;
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!gameRunning || isGameOver || gamePaused) return;
        const t = e.touches[0];
        const dx = t.clientX - touchLastMoveX;
        const dy = t.clientY - touchStartY;
        const now = Date.now();
        if (Math.abs(dx) > SWIPE_THRESH_X && now - touchMoveThrottleTime > MOVE_THROTTLE) {
            movePiece(dx > 0 ? 'right' : 'left');
            touchLastMoveX = t.clientX;
            touchMoveThrottleTime = now;
            touchMoved = true;
        }
        if (dy > SWIPE_THRESH_Y * 0.5 && Math.abs(dx) < SWIPE_THRESH_X) {
            dropCounter = difficultySettings[currentDifficulty].dropInterval;
            touchMoved = true;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        e.preventDefault();
        if (!gameRunning || isGameOver || gamePaused) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        const dist = Math.hypot(dx, dy);
        const duration = Date.now() - touchStartTime;

        if (dist < TAP_THRESH && duration < TAP_MAX_MS && !touchMoved) {
            rotatePiece();
            return;
        }
        if (touchMoved) return;

        if (dy > SWIPE_THRESH_Y * 2 && Math.abs(dx) < SWIPE_THRESH_X * 1.5) {
            while (!checkCollision(0, 1)) { piece.y++; }
            dropPiece();
            flashPiece();
            return;
        }
        if (Math.abs(dx) > SWIPE_THRESH_X) {
            movePiece(dx > 0 ? 'right' : 'left');
        }
    }, { passive: false });

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
