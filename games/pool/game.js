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
function sfxCue()          { SFX.play({ frequency: 220, type: 'square',   duration: 0.07, volume: 0.2, slide: 80 }); }
function sfxBallHit(speed) {
    const vol = Math.min(0.4, (speed || 10) * 0.015);
    SFX.play({ frequency: 900, type: 'sine', duration: 0.06, volume: vol, slide: -300 });
}
function sfxCushion()      { SFX.play({ frequency: 350, type: 'square',   duration: 0.06, volume: 0.18, slide: -120 }); }
function sfxPocket()       {
    [440, 330, 220].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.09, volume: 0.22 }), i * 55));
}
function sfxScratch()      { SFX.noise({ duration: 0.3, volume: 0.35, lowpass: 500 }); }
function sfxWin()          {
    [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.3 }), i * 80));
}

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;

const STORAGE_KEY = 'pixelplay_pool_best';
function getBest()  { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest() {
    const wins = getBest() + 1;
    localStorage.setItem(STORAGE_KEY, String(wins));
}
function displayBest() { const b = getBest(); return b === 0 ? '—' : String(b); }

function togglePause() {
    if (!gameRunning || isGameOver) return;
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        clearTimeout(aiTimer);
        aiTimer = null;
    } else {
        if (currentPlayer === 2 && isVsAI && !isTableMoving() && !waitingForTurnEnd) {
            aiTimer = setTimeout(takeAITurn, 1200);
        }
        resumeGameLoop();
    }
}
function resumeGameLoop() { requestAnimationFrame(gameLoop); }
function restartGame() {
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    startNewGame(isVsAI ? '1p' : '2p');
}
function goToTitleScreen() {
    gameRunning = false;
    gamePaused  = false;
    clearTimeout(aiTimer);
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('pp-back').style.display = 'flex';
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
}

// ─── Responsive Canvas Dimensions ────────────────────────────────────────
const TABLE_LONG  = 1400;
const TABLE_SHORT = 700;

function isPortraitView() {
    return window.innerHeight > window.innerWidth;
}
function gameDims() {
    return isPortraitView()
        ? { w: TABLE_SHORT, h: TABLE_LONG }
        : { w: TABLE_LONG,  h: TABLE_SHORT };
}

// ─── Matter.js Aliases ────────────────────────────────────────────────────
const Engine    = Matter.Engine,
      Bodies    = Matter.Bodies,
      Composite = Matter.Composite,
      Body      = Matter.Body,
      Vector    = Matter.Vector;

let canvas, ctx, score1El, score2El, turnIndicator, scratchWarning,
    startMenu, gameOverScreen, restartBtn, winnerText,
    bestScoreEl, titleBestEl, finalP1El, finalP2El,
    p1LabelEl, p2LabelEl;
let engine;

// ─── Match State ──────────────────────────────────────────────────────────
let p1Score = 0;
let p2Score = 0;
let currentPlayer = 1;
let isVsAI = false;
let isGameOver = false;
let gameRunning = false;
let ballsSunkThisTurn = 0;
let isFoul = false;
let p1Group = null;        // 'red' | 'yellow' | null = open table
let p2Group = null;
let turnShouldPass = false;
let eightBallSunk = false;

// ─── Physics Entities ─────────────────────────────────────────────────────
let cueBall;
let balls = [];
let pockets = [];
let walls = [];
const BALL_RADIUS = 12;

// ─── Aiming & AI State ────────────────────────────────────────────────────
let isAiming = false;
let dragCurrent = { x: 0, y: 0 };
let prevAngle = 0;
const MAX_PULL  = 420;
const MIN_SHOT  = 4;
const MAX_SHOT  = 46;
let aiTimer = null;

function initPhysics() {
    engine = Engine.create();
    engine.gravity.y = 0;
    engine.positionIterations = 10;
    engine.velocityIterations = 10;
    console.log('velocityIterations:', engine.velocityIterations, 'positionIterations:', engine.positionIterations);
}

function rebuildStaticBodies() {
    walls.forEach(w => Composite.remove(engine.world, w));
    walls = [];
    pockets = [];

    const w = canvas.width;
    const h = canvas.height;

    const wallOptions = { isStatic: true, restitution: 0.72, friction: 0 };
    const wallThick = 50;

    walls.push(
        Bodies.rectangle(w/2, -wallThick/2,   w,         wallThick, wallOptions),
        Bodies.rectangle(w/2, h + wallThick/2, w,         wallThick, wallOptions),
        Bodies.rectangle(-wallThick/2,  h/2,   wallThick, h,         wallOptions),
        Bodies.rectangle(w + wallThick/2, h/2,  wallThick, h,         wallOptions)
    );
    Composite.add(engine.world, walls);

    const pRad = 30;
    if (h > w) {
        // PORTRAIT: long rails are left/right — mid pockets there
        pockets = [
            { x: 0, y: 0,   r: pRad }, { x: w, y: 0,   r: pRad },
            { x: 0, y: h/2, r: pRad }, { x: w, y: h/2, r: pRad },
            { x: 0, y: h,   r: pRad }, { x: w, y: h,   r: pRad }
        ];
    } else {
        // LANDSCAPE: long rails are top/bottom
        pockets = [
            { x: 0, y: 0, r: pRad }, { x: w/2, y: 0, r: pRad }, { x: w, y: 0, r: pRad },
            { x: 0, y: h, r: pRad }, { x: w/2, y: h, r: pRad }, { x: w, y: h, r: pRad }
        ];
    }
}

function buildTable() {
    Composite.clear(engine.world);
    balls = [];
    walls = [];
    pockets = [];

    rebuildStaticBodies();

    const w = canvas.width;
    const h = canvas.height;

    const ballOptions = {
        restitution: 0.92,
        friction: 0.005,
        frictionAir: 0.022,
        density: 0.005,
        slop: 0.05
    };

    if (h > w) {
        cueBall = Bodies.circle(w * 0.5, h * 0.75, BALL_RADIUS, ballOptions);
    } else {
        cueBall = Bodies.circle(w * 0.25, h * 0.5, BALL_RADIUS, ballOptions);
    }
    cueBall.isCue = true;
    cueBall.color = '#ffffff';
    Composite.add(engine.world, cueBall);

    const step  = BALL_RADIUS * Math.sqrt(3) + 1;
    const cross = BALL_RADIUS * 2 + 1;
    let colorAlt = true;

    if (h > w) {
        // Triangle grows upward from apex at h*0.35
        const startX = w * 0.5;
        const startY = h * 0.35;
        for (let col = 0; col < 5; col++) {
            for (let row = 0; row <= col; row++) {
                const by = startY - (col * step);
                const bx = startX - (col * cross / 2) + (row * cross);
                const isEight = (col === 2 && row === 1);
                const ball = Bodies.circle(bx, by, BALL_RADIUS, ballOptions);
                ball.color = isEight ? '#111' : (colorAlt ? '#f44336' : '#ffeb3b');
                ball.group = isEight ? 'eight' : (colorAlt ? 'red' : 'yellow');
                colorAlt = !colorAlt;
                balls.push(ball);
            }
        }
    } else {
        const startX = w * 0.65, startY = h * 0.5;
        for (let col = 0; col < 5; col++) {
            for (let row = 0; row <= col; row++) {
                const bx = startX + (col * step);
                const by = startY - (col * cross / 2) + (row * cross);
                const isEight = (col === 2 && row === 1);
                const ball = Bodies.circle(bx, by, BALL_RADIUS, ballOptions);
                ball.color = isEight ? '#111' : (colorAlt ? '#f44336' : '#ffeb3b');
                ball.group = isEight ? 'eight' : (colorAlt ? 'red' : 'yellow');
                colorAlt = !colorAlt;
                balls.push(ball);
            }
        }
    }
    Composite.add(engine.world, balls);
}

function transposeWorld() {
    const w = canvas.width, h = canvas.height;
    const ow = h, oh = w;
    const all = [cueBall, ...balls].filter(Boolean);
    all.forEach(b => {
        const fx = b.position.x / ow;
        const fy = b.position.y / oh;
        Body.setPosition(b, { x: fy * w, y: fx * h });
        Body.setVelocity(b, { x: b.velocity.y, y: b.velocity.x });
    });
    rebuildStaticBodies();
}

function resizeCanvas() {
    if (!canvas) return;
    const d = gameDims();

    if (canvas.width !== d.w) {
        canvas.width  = d.w;
        canvas.height = d.h;
        if (gameRunning && !isGameOver) {
            transposeWorld();
        } else {
            buildTable();
        }
    }

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const topReserve  = 96;
    const botReserve  = 12;
    const sideReserve = 8;

    const availW = winW - sideReserve * 2;
    const availH = winH - topReserve - botReserve;
    const scale  = Math.min(availW / d.w, availH / d.h);

    const dispW = Math.floor(d.w * scale);
    const dispH = Math.floor(d.h * scale);

    canvas.style.position = 'fixed';
    canvas.style.width    = dispW + 'px';
    canvas.style.height   = dispH + 'px';
    canvas.style.left     = Math.floor((winW - dispW) / 2) + 'px';
    canvas.style.top      = (topReserve + Math.floor((availH - dispH) / 2)) + 'px';
}

// ─── Game Logic & Turn Management ────────────────────────────────────────
function remainingFor(group) {
    return balls.filter(b => b.group === group).length;
}

function endGame(winner) {
    isGameOver  = true;
    gameRunning = false;
    clearTimeout(aiTimer);
    const winnerMsg = winner === 1
        ? 'PLAYER 1 WINS!'
        : (isVsAI ? 'AI WINS!' : 'PLAYER 2 WINS!');
    if (winner === 1) { saveBest(); sfxWin(); }
    winnerText.textContent = winnerMsg;
    if (finalP1El)   finalP1El.textContent   = p1Score;
    if (finalP2El)   finalP2El.textContent   = p2Score;
    if (bestScoreEl) bestScoreEl.textContent = displayBest();
    gameOverScreen.classList.remove('hidden');
}

function updateGroupDisplay() {
    const label = (g, name) =>
        g === 'red' ? `🔴 ${name}` : g === 'yellow' ? `🟡 ${name}` : name;
    if (p1LabelEl) p1LabelEl.textContent = label(p1Group, 'P1');
    if (p2LabelEl) p2LabelEl.textContent = label(p2Group, 'P2');
}

function updateTurnIndicator() {
    const myGroup = currentPlayer === 1 ? p1Group : p2Group;
    const name = currentPlayer === 1 ? 'PLAYER 1' : (isVsAI ? 'AI' : 'PLAYER 2');
    let text;
    if (myGroup) {
        const dot = myGroup === 'red' ? '🔴' : '🟡';
        text = `${name} ${dot} — ${remainingFor(myGroup)} LEFT`;
    } else {
        text = `${name}'S TURN`;
    }
    turnIndicator.textContent = text;
    turnIndicator.style.color = currentPlayer === 1 ? '#00d4ff' : '#ff9800';
}

function isTableMoving() {
    if (Math.hypot(cueBall.velocity.x, cueBall.velocity.y) > 0.1) return true;
    for (const ball of balls) {
        if (Math.hypot(ball.velocity.x, ball.velocity.y) > 0.1) return true;
    }
    return false;
}

function switchTurn() {
    const keepTurn = ballsSunkThisTurn > 0 && !isFoul && !turnShouldPass;
    turnShouldPass    = false;
    ballsSunkThisTurn = 0;
    isFoul            = false;

    if (!keepTurn) currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateTurnIndicator();

    if (currentPlayer === 2 && isVsAI && gameRunning && !isGameOver && !gamePaused) {
        aiTimer = setTimeout(takeAITurn, 1200);
    }
}

// ─── Artificial Intelligence Engine ──────────────────────────────────────
function isPathClear(x1, y1, x2, y2, ignore) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return true;
    const ux = dx / len, uy = dy / len;
    const blockers = [cueBall, ...balls].filter(b => b && !ignore.includes(b));
    for (const b of blockers) {
        const tx = b.position.x - x1, ty = b.position.y - y1;
        const dot = tx * ux + ty * uy;
        if (dot < 0 || dot > len) continue;
        const px = x1 + ux * dot, py = y1 + uy * dot;
        if (Math.hypot(b.position.x - px, b.position.y - py) < BALL_RADIUS * 2 - 1) return false;
    }
    return true;
}

function takeAITurn() {
    if (isGameOver || gamePaused) return;

    const aiGroup = p2Group;
    let legalTargets;
    if (aiGroup === null) {
        legalTargets = balls.filter(b => b.group !== 'eight');
    } else {
        const mine = balls.filter(b => b.group === aiGroup);
        legalTargets = mine.length ? mine : balls.filter(b => b.group === 'eight');
    }
    if (!legalTargets.length) return;

    let best = null;
    for (const ball of legalTargets) {
        for (const p of pockets) {
            const toPocket = Math.atan2(p.y - ball.position.y, p.x - ball.position.x);
            const gx = ball.position.x - Math.cos(toPocket) * BALL_RADIUS * 2;
            const gy = ball.position.y - Math.sin(toPocket) * BALL_RADIUS * 2;

            if (!isPathClear(cueBall.position.x, cueBall.position.y, gx, gy, [cueBall, ball])) continue;
            if (!isPathClear(ball.position.x, ball.position.y, p.x, p.y, [ball])) continue;

            const aimAng = Math.atan2(gy - cueBall.position.y, gx - cueBall.position.x);
            let cut = Math.abs(aimAng - toPocket);
            if (cut > Math.PI) cut = 2 * Math.PI - cut;
            if (cut > 0.9) continue;

            const d1 = Math.hypot(gx - cueBall.position.x, gy - cueBall.position.y);
            const d2 = Math.hypot(p.x - ball.position.x, p.y - ball.position.y);
            const score = (Math.PI - cut) * 2 - (d1 + d2) / 400;
            if (!best || score > best.score) best = { aimAng, d1, d2, score, cut };
        }
    }

    let aimAngle, speed;
    if (best) {
        const missChance = Math.min(0.35, (best.cut / 0.9) * 0.25 + ((best.d1 + best.d2) / 1500) * 0.15);
        const angleNoise = (Math.random() < missChance)
            ? (Math.random() - 0.5) * 0.15
            : (Math.random() - 0.5) * 0.035;
        aimAngle = best.aimAng + angleNoise;
        const need = (best.d1 + best.d2 * 1.4) * 0.038;
        speed = Math.min(28, Math.max(9, need));
    } else {
        const nb = legalTargets.reduce((a, b) =>
            Math.hypot(a.position.x - cueBall.position.x, a.position.y - cueBall.position.y) <
            Math.hypot(b.position.x - cueBall.position.x, b.position.y - cueBall.position.y) ? a : b);
        aimAngle = Math.atan2(nb.position.y - cueBall.position.y, nb.position.x - cueBall.position.x);
        speed = 8;
    }

    scratchWarning.style.display = 'none';
    sfxCue();
    Body.setVelocity(cueBall, {
        x: Math.cos(aimAngle) * speed,
        y: Math.sin(aimAngle) * speed
    });
}

// ─── Advanced Aiming Geometry ─────────────────────────────────────────────
function calculateAimTrajectory(startX, startY, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let closestDist = Infinity;
    let targetBall  = null;
    let ghostX = startX + dx * 2000;
    let ghostY = startY + dy * 2000;

    for (const ball of balls) {
        const toBallX   = ball.position.x - startX;
        const toBallY   = ball.position.y - startY;
        const dotProduct = toBallX * dx + toBallY * dy;
        if (dotProduct <= 0) continue;

        const closestX = startX + dx * dotProduct;
        const closestY = startY + dy * dotProduct;
        const distToLineSq  = Math.pow(ball.position.x - closestX, 2) + Math.pow(ball.position.y - closestY, 2);
        const collisionDistSq = Math.pow(BALL_RADIUS * 2, 2);

        if (distToLineSq <= collisionDistSq) {
            const backDist   = Math.sqrt(collisionDistSq - distToLineSq);
            const impactDist = dotProduct - backDist;
            if (impactDist < closestDist) {
                closestDist = impactDist;
                targetBall  = ball;
                ghostX = startX + dx * impactDist;
                ghostY = startY + dy * impactDist;
            }
        }
    }

    let targetPath = null;
    let cuePath    = null;

    if (targetBall) {
        const tDirX = targetBall.position.x - ghostX;
        const tDirY = targetBall.position.y - ghostY;
        const tLen  = Math.hypot(tDirX, tDirY);
        targetPath  = { x: tDirX / tLen, y: tDirY / tLen };

        const dot   = dx * targetPath.x + dy * targetPath.y;
        const cDirX = dx - dot * targetPath.x;
        const cDirY = dy - dot * targetPath.y;
        const cLen  = Math.hypot(cDirX, cDirY);
        cuePath = cLen > 0.001 ? { x: cDirX / cLen, y: cDirY / cLen } : { x: 0, y: 0 };
    }

    return { ghostX, ghostY, targetBall, targetPath, cuePath };
}

// ─── Human Input Controls ─────────────────────────────────────────────────
function getMousePos(e) {
    const rect    = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX  = canvas.width  / rect.width;
    const scaleY  = canvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top)  * scaleY
    };
}

function handleInputStart(e) {
    if (!gameRunning || isGameOver || gamePaused || isTableMoving() || (currentPlayer === 2 && isVsAI)) return;
    isAiming = true;
    dragCurrent = getMousePos(e);
    scratchWarning.style.display = 'none';
}

function handleInputMove(e) {
    if (!isAiming) return;
    dragCurrent = getMousePos(e);
}

function handleInputEnd() {
    if (!isAiming) return;
    isAiming = false;

    const dx   = cueBall.position.x - dragCurrent.x;
    const dy   = cueBall.position.y - dragCurrent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) return;

    const rawAngle = Math.atan2(dy, dx);
    const pullDist = Math.min(dist, MAX_PULL);
    // Fine-aim zone: blend toward prevAngle for sub-25% pulls to suppress jitter
    const angle = (pullDist / MAX_PULL < 0.25)
        ? prevAngle + (rawAngle - prevAngle) * 0.4
        : rawAngle;
    const t        = pullDist / MAX_PULL;
    const power    = t * t * (3 - 2 * t);    // smoothstep
    const speed    = MIN_SHOT + power * (MAX_SHOT - MIN_SHOT);

    console.log('Shot speed:', speed, 'pullDist:', pullDist, 'MAX_PULL:', MAX_PULL);
    sfxCue();
    Body.setVelocity(cueBall, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
    });
    console.log('Post-setVelocity cueBall velocity:', cueBall.velocity.x.toFixed(2), cueBall.velocity.y.toFixed(2));
    window._logNextFrame = true;
}

function startNewGame(mode) {
    isVsAI            = (mode === '1p');
    p1Score           = 0;
    p2Score           = 0;
    currentPlayer     = 1;
    isFoul            = false;
    ballsSunkThisTurn = 0;
    isGameOver        = false;
    gameRunning       = true;
    gamePaused        = false;
    p1Group           = null;
    p2Group           = null;
    turnShouldPass    = false;
    eightBallSunk     = false;
    clearTimeout(aiTimer);

    score1El.textContent          = p1Score;
    score2El.textContent          = p2Score;
    scratchWarning.textContent    = 'SCRATCH! TURN LOST.';
    scratchWarning.style.display  = 'none';
    updateGroupDisplay();
    updateTurnIndicator();

    if (titleBestEl) titleBestEl.textContent = displayBest();

    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    document.getElementById('pause-overlay').style.display = 'none';

    resizeCanvas();
    buildTable();
    requestAnimationFrame(gameLoop);
}

function drawCircle(x, y, radius, fill) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
}

let waitingForTurnEnd = false;

function gameLoop() {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;

    Engine.update(engine, 1000 / 60);

    // TEMP DEBUG: first-frame velocity after shot is set
    if (window._logNextFrame) {
        console.log('First-frame post-shot cueBall velocity:', cueBall.velocity.x.toFixed(2), cueBall.velocity.y.toFixed(2));
        window._logNextFrame = false;
    }
    // TEMP DEBUG: log velocities during break
    if (!window._debugFrameCount && Math.hypot(cueBall.velocity.x, cueBall.velocity.y) > 5) {
        window._debugFrameCount = 0;
    }
    if (window._debugFrameCount !== undefined && window._debugFrameCount < 10) {
        const speeds = [cueBall, ...balls].map(b => Math.hypot(b.velocity.x, b.velocity.y).toFixed(2));
        console.log(`Frame ${window._debugFrameCount}:`, speeds.join(', '));
        window._debugFrameCount++;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isTableMoving()) {
        waitingForTurnEnd = true;
    } else if (waitingForTurnEnd) {
        waitingForTurnEnd = false;
        switchTurn();
    }

    pockets.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#F5C200';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
    });

    // Detect cue sink before ball loop so 8-ball edge case can use it
    let cueSunkThisShot = false;
    pockets.forEach(p => {
        if (Math.hypot(cueBall.position.x - p.x, cueBall.position.y - p.y) < p.r) cueSunkThisShot = true;
    });

    const activeBalls = [];
    balls.forEach(ball => {
        if (isGameOver) { activeBalls.push(ball); return; }
        let sunk = false;
        pockets.forEach(p => {
            if (Math.hypot(ball.position.x - p.x, ball.position.y - p.y) < p.r) sunk = true;
        });

        if (sunk) {
            Composite.remove(engine.world, ball);
            sfxPocket();

            if (ball.group === 'eight') {
                eightBallSunk = true;
                const myGroup   = currentPlayer === 1 ? p1Group : p2Group;
                const remaining = balls.filter(b => b !== ball && b.group === myGroup).length;
                const shooterWins = myGroup !== null && remaining === 0 && !cueSunkThisShot;
                endGame(shooterWins ? currentPlayer : (currentPlayer === 1 ? 2 : 1));
            } else {
                if (p1Group === null) {
                    if (currentPlayer === 1) {
                        p1Group = ball.group;
                        p2Group = ball.group === 'red' ? 'yellow' : 'red';
                    } else {
                        p2Group = ball.group;
                        p1Group = ball.group === 'red' ? 'yellow' : 'red';
                    }
                    updateGroupDisplay();
                }
                const myGroup = currentPlayer === 1 ? p1Group : p2Group;
                if (ball.group === myGroup) {
                    if (currentPlayer === 1) p1Score++; else p2Score++;
                    ballsSunkThisTurn++;
                } else {
                    if (currentPlayer === 1) p2Score++; else p1Score++;
                    turnShouldPass = true;
                    scratchWarning.textContent = 'WRONG COLOR! TURN LOST.';
                    scratchWarning.style.display = 'inline';
                }
                score1El.textContent = p1Score;
                score2El.textContent = p2Score;
            }
        } else {
            activeBalls.push(ball);
        }
    });
    balls = activeBalls;

    if (cueSunkThisShot && !eightBallSunk) {
        isFoul = true;
        scratchWarning.textContent = 'SCRATCH! TURN LOST.';
        scratchWarning.style.display = 'inline';
        Body.setVelocity(cueBall, { x: 0, y: 0 });
        if (canvas.height > canvas.width) {
            Body.setPosition(cueBall, { x: canvas.width * 0.5, y: canvas.height * 0.75 });
        } else {
            Body.setPosition(cueBall, { x: canvas.width * 0.25, y: canvas.height * 0.5 });
        }
        sfxScratch();
    }

    if (isAiming) {
        const dx        = cueBall.position.x - dragCurrent.x;
        const dy        = cueBall.position.y - dragCurrent.y;
        const rawAngle  = Math.atan2(dy, dx);
        const pullDist  = Math.min(Math.hypot(dx, dy), MAX_PULL);
        // Mirror the fine-aim smoothing so the preview line matches the shot angle
        const angle = (pullDist / MAX_PULL < 0.25)
            ? prevAngle + (rawAngle - prevAngle) * 0.4
            : rawAngle;
        prevAngle = angle;

        if (pullDist > 10) {
            const aimData = calculateAimTrajectory(cueBall.position.x, cueBall.position.y, angle);

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 2;
            ctx.moveTo(cueBall.position.x, cueBall.position.y);
            ctx.lineTo(aimData.ghostX, aimData.ghostY);
            ctx.stroke();

            if (aimData.targetBall) {
                ctx.beginPath();
                ctx.arc(aimData.ghostX, aimData.ghostY, BALL_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(aimData.targetBall.position.x, aimData.targetBall.position.y);
                ctx.lineTo(
                    aimData.targetBall.position.x + aimData.targetPath.x * 60,
                    aimData.targetBall.position.y + aimData.targetPath.y * 60
                );
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.stroke();

                if (aimData.cuePath && (aimData.cuePath.x !== 0 || aimData.cuePath.y !== 0)) {
                    ctx.beginPath();
                    ctx.moveTo(aimData.ghostX, aimData.ghostY);
                    ctx.lineTo(
                        aimData.ghostX + aimData.cuePath.x * 40,
                        aimData.ghostY + aimData.cuePath.y * 40
                    );
                    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                    ctx.stroke();
                }
            }

            ctx.save();
            ctx.translate(cueBall.position.x, cueBall.position.y);
            ctx.rotate(angle + Math.PI);

            const stickLength = 350;
            const stickThick  = 7;
            const stickGap    = BALL_RADIUS + 6 + pullDist * 0.45;

            ctx.fillStyle = '#5c3a21';
            ctx.fillRect(stickGap + 15, -stickThick / 2, stickLength, stickThick);
            ctx.fillStyle = '#e6c280';
            ctx.fillRect(stickGap + 4,  -stickThick / 2, 15,          stickThick);
            ctx.fillStyle = '#00bcd4';
            ctx.fillRect(stickGap,       -stickThick / 2, 4,           stickThick);
            ctx.restore();

            // Power meter (screen-space, arcade style)
            const pt = pullDist / MAX_PULL;
            const meterW = 18, meterH = canvas.height * 0.4;
            const mx = canvas.width - meterW - 14;
            const my = (canvas.height - meterH) / 2;
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(mx - 4, my - 4, meterW + 8, meterH + 8);
            const grad = ctx.createLinearGradient(0, my + meterH, 0, my);
            grad.addColorStop(0,   '#3DC46A');
            grad.addColorStop(0.6, '#F5C200');
            grad.addColorStop(1,   '#E84040');
            ctx.fillStyle = grad;
            const fillH = meterH * (pt * pt * (3 - 2 * pt));
            ctx.fillRect(mx, my + meterH - fillH, meterW, fillH);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(mx, my, meterW, meterH);
        }
    }

    balls.forEach(ball => {
        drawCircle(ball.position.x, ball.position.y, BALL_RADIUS, ball.color);
        drawCircle(ball.position.x - 3, ball.position.y - 3, 3, 'rgba(255,255,255,0.4)');
    });

    drawCircle(cueBall.position.x, cueBall.position.y, BALL_RADIUS, cueBall.color);
    drawCircle(cueBall.position.x - 3, cueBall.position.y - 3, 3, 'rgba(255,255,255,0.6)');

    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas          = document.getElementById('gameCanvas');
    ctx             = canvas.getContext('2d');
    score1El        = document.getElementById('score1');
    score2El        = document.getElementById('score2');
    turnIndicator   = document.getElementById('turn-indicator');
    scratchWarning  = document.getElementById('scratch-warning');
    startMenu       = document.getElementById('start-menu');
    gameOverScreen  = document.getElementById('game-over-screen');
    restartBtn      = document.getElementById('restart-btn');
    winnerText      = document.getElementById('winner-text');
    bestScoreEl     = document.getElementById('best-score');
    titleBestEl     = document.getElementById('title-best');
    finalP1El       = document.getElementById('final-p1');
    finalP2El       = document.getElementById('final-p2');
    p1LabelEl       = document.getElementById('p1-label');
    p2LabelEl       = document.getElementById('p2-label');

    if (titleBestEl) titleBestEl.textContent = displayBest();

    const d = gameDims();
    canvas.width  = d.w;
    canvas.height = d.h;

    const modeButtons = document.querySelectorAll('.btn-group .menu-btn');

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) togglePause();
    });

    initPhysics();

    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (gamePaused) return;
        event.pairs.forEach(pair => {
            const speed = Math.hypot(pair.bodyA.velocity.x, pair.bodyA.velocity.y) +
                          Math.hypot(pair.bodyB.velocity.x, pair.bodyB.velocity.y);
            if (speed < 0.5) return;
            if (pair.bodyA.isStatic || pair.bodyB.isStatic) {
                sfxCushion();
            } else {
                sfxBallHit(speed);
            }
        });
    });

    canvas.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup',   handleInputEnd);

    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInputStart(e); }, { passive: false });
    window.addEventListener('touchmove',  handleInputMove, { passive: false });
    window.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });
    window.addEventListener('touchend',   handleInputEnd);

    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startNewGame(btn.getAttribute('data-mode'));
        });
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startNewGame(isVsAI ? '1p' : '2p');
        });
    }

    resizeCanvas();
});
