// Matter.js Aliases
const Engine    = Matter.Engine,
      Bodies    = Matter.Bodies,
      Composite = Matter.Composite,
      Body      = Matter.Body,
      Events    = Matter.Events;

let canvas, ctx;
let engine;
let startMenu, modeMenu, speedMenu, gameOverScreen, winnerText;

// Arena Geography
let arenaSize = 0;
let offsetX   = 0;
let offsetY   = 0;
const PADDLE_THICKNESS = 20;
const PADDLE_LENGTH    = 120;
const BALL_RADIUS      = 12;

// Game State
let gameRunning = false;
let gameStarted = false;
let ball;
let ballTrail = [];
let players = [];

// Speed settings
const SPEED_MAP = {
    1: { spawn: 4,  max: 10, increment: 0.3 },
    2: { spawn: 5,  max: 12, increment: 0.4 },
    3: { spawn: 7,  max: 15, increment: 0.5 },
    4: { spawn: 9,  max: 18, increment: 0.6 },
    5: { spawn: 12, max: 22, increment: 0.8 },
};
let BALL_SPEED    = 7;
let maxSpeed      = 15;
let HIT_INCREMENT = 0.5;
let selectedSpeed = 3;

// Player selection state
let selectedPlayerCount = 4;
let selectedVsAI        = false;

// Pause
let qpPaused = false;

// ==========================================
// LOCAL STORAGE
// ==========================================
const QP_KEY = 'pixelplay_quadpong_wins';
function getQPWins() { return parseInt(localStorage.getItem(QP_KEY) || '0'); }
function saveQPWin()  { localStorage.setItem(QP_KEY, String(getQPWins() + 1)); }

// ==========================================
// PAUSE
// ==========================================
function toggleQPPause() {
    if (!gameStarted) return;
    qpPaused = !qpPaused;
    document.getElementById('qp-pause').style.display = qpPaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = qpPaused ? 'none' : 'flex';
    if (!qpPaused && gameRunning) requestAnimationFrame(gameLoop);
}


// ==========================================
// SYNTHESIZED ARCADE SOUND EFFECTS
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const sfx = {
    playTone: (freqStart, freqEnd, type, duration, vol) => {
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc  = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freqStart, audioCtx.currentTime);
            if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
            gain.gain.setValueAtTime(vol, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) {}
    },
    bounce:    () => sfx.playTone(600,  800,  'square',   0.1, 0.05),
    paddleHit: () => sfx.playTone(800,  1200, 'sine',     0.1, 0.05),
    damage:    () => sfx.playTone(150,  40,   'sawtooth', 0.4, 0.1),
    start:     () => sfx.playTone(400,  1600, 'square',   0.5, 0.1),
    gameover:  () => sfx.playTone(300,  50,   'sawtooth', 0.8, 0.1),
};

// ==========================================
// MENU NAVIGATION
// ==========================================
function showStartMenu() {
    if (startMenu)      startMenu.classList.remove('hidden');
    if (modeMenu)       modeMenu.classList.add('hidden');
    if (speedMenu)      speedMenu.classList.add('hidden');
    if (gameOverScreen) gameOverScreen.classList.add('hidden');
    const el = document.getElementById('title-wins');
    if (el) el.textContent = getQPWins() || '—';
}

function selectPlayerCount(n) {
    selectedPlayerCount = n;
    if (startMenu) startMenu.classList.add('hidden');
    if (n === 2) {
        if (modeMenu) modeMenu.classList.remove('hidden');
    } else {
        showSpeedMenu();
    }
}

function selectMode(vsAI) {
    selectedVsAI = vsAI;
    if (modeMenu) modeMenu.classList.add('hidden');
    showSpeedMenu();
}

function showSpeedMenu() {
    const titles = { 2: '2 PLAYERS', 3: '3 PLAYERS', 4: '4 PLAYERS' };
    const title  = document.getElementById('speed-title');
    if (title) title.textContent = titles[selectedPlayerCount] || 'SETTINGS';
    updateSpeedUI();
    if (speedMenu) speedMenu.classList.remove('hidden');
}

function showPrev() {
    if (speedMenu) speedMenu.classList.add('hidden');
    if (selectedPlayerCount === 2) {
        if (modeMenu) modeMenu.classList.remove('hidden');
    } else {
        showStartMenu();
    }
}

function setSpeed(n) {
    selectedSpeed = n;
    updateSpeedUI();
}

function updateSpeedUI() {
    const labels = ['SLOW', 'EASY', 'NORMAL', 'FAST', 'INSANE'];
    document.querySelectorAll('.speed-dot').forEach(d => {
        d.classList.toggle('active', parseInt(d.dataset.s) === selectedSpeed);
    });
    const lbl = document.getElementById('speed-label');
    if (lbl) lbl.textContent = labels[selectedSpeed - 1];
}

function applySpeedSetting() {
    const cfg = SPEED_MAP[selectedSpeed];
    BALL_SPEED    = cfg.spawn;
    maxSpeed      = cfg.max;
    HIT_INCREMENT = cfg.increment;
}

function startWithSettings() {
    applySpeedSetting();
    forceStartGame(selectedPlayerCount, selectedVsAI);
}

// ==========================================
// GLOBAL START TRIGGER
// ==========================================
function forceStartGame(playerCount, vsAI) {
    if (gameRunning) return;

    try {
        if (typeof audioCtx !== 'undefined' && audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) {}

    gameRunning = true;
    gameStarted = true;
    qpPaused    = false;

    if (startMenu)      startMenu.classList.add('hidden');
    if (modeMenu)       modeMenu.classList.add('hidden');
    if (speedMenu)      speedMenu.classList.add('hidden');
    if (gameOverScreen) gameOverScreen.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';

    sfx.start();
    resizeCanvas();
    resizeQP();
    initPlayers(playerCount, vsAI);
    buildArena();
    requestAnimationFrame(gameLoop);
}
window.forceStartGame = forceStartGame;

// ==========================================
// GAME SETUP
// ==========================================
function initPlayers(playerCount, vsAI) {
    players = [];
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`score-p${i}`);
        if (el) el.classList.add('hidden');
    }

    const pDefs = [
        { id: 1, color: '#00d4ff', label: 'P1', edge: 'bottom' },
        { id: 2, color: '#f44336', label: 'P2', edge: 'top'    },
        { id: 3, color: '#4caf50', label: 'P3', edge: 'left'   },
        { id: 4, color: '#ffeb3b', label: 'P4', edge: 'right'  },
    ];

    let configs = [];
    if (playerCount === 2 && vsAI) {
        configs = [
            { ...pDefs[0], isAI: false },
            { ...pDefs[1], isAI: true  },
        ];
    } else if (playerCount === 2) {
        configs = [
            { ...pDefs[0], isAI: false },
            { ...pDefs[1], isAI: false },
        ];
    } else if (playerCount === 3) {
        configs = [
            { ...pDefs[0], isAI: false },
            { ...pDefs[1], isAI: false },
            { ...pDefs[2], isAI: false },
        ];
    } else {
        configs = pDefs.map(d => ({ ...d, isAI: false }));
    }

    configs.forEach(cfg => {
        players.push({ ...cfg, lives: 5, active: true, paddle: null, goalSensor: null });
        const scoreEl = document.getElementById(`score-p${cfg.id}`);
        if (scoreEl) {
            scoreEl.classList.remove('hidden');
            updateScoreDisplay(players[players.length - 1]);
        }
    });

    // Position score displays at screen edges (never overlapping the arena).
    const pos = {
        2: {
            1: { bottom: '14px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' },
            2: { top:    '14px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' },
        },
        3: {
            1: { bottom: '14px', left:  '50%', transform: 'translateX(-50%)', textAlign: 'center' },
            2: { top:    '14px', left:  '20px', textAlign: 'left'  },
            3: { top:    '14px', right: '20px', textAlign: 'right' },
        },
        4: {
            1: { bottom: '14px', left:  '20px', textAlign: 'left'  },
            2: { top:    '14px', left:  '20px', textAlign: 'left'  },
            3: { top:    '14px', right: '20px', textAlign: 'right' },
            4: { bottom: '14px', right: '20px', textAlign: 'right' },
        },
    };
    const layout = pos[playerCount] || pos[4];
    configs.forEach(cfg => {
        const el = document.getElementById(`score-p${cfg.id}`);
        const p  = layout[cfg.id];
        if (!el || !p) return;
        el.style.position  = 'fixed';
        el.style.top       = p.top       || '';
        el.style.bottom    = p.bottom    || '';
        el.style.left      = p.left      || '';
        el.style.right     = p.right     || '';
        el.style.transform = p.transform || '';
        el.style.textAlign = p.textAlign || '';
    });
}

function buildArena() {
    Composite.clear(engine.world);

    const w = canvas.width;
    const h = canvas.height;

    arenaSize = w - 60;
    offsetX   = 30;
    offsetY   = (h - arenaSize) / 2;

    const wallOpts   = { isStatic: true, restitution: 1.0, friction: 0, label: 'wall' };
    const sensorOpts = { isStatic: true, isSensor: true };
    const paddleOpts = { isStatic: true, restitution: 1.05, friction: 0 };

    const edges = {
        top:    { x: w / 2,               y: offsetY,             w: arenaSize,        h: PADDLE_THICKNESS },
        bottom: { x: w / 2,               y: offsetY + arenaSize, w: arenaSize,        h: PADDLE_THICKNESS },
        left:   { x: offsetX,             y: h / 2,               w: PADDLE_THICKNESS, h: arenaSize        },
        right:  { x: offsetX + arenaSize, y: h / 2,               w: PADDLE_THICKNESS, h: arenaSize        },
    };

    for (const [edgeName, bounds] of Object.entries(edges)) {
        const owner = players.find(p => p.edge === edgeName);

        if (owner) {
            owner.goalSensor = Bodies.rectangle(bounds.x, bounds.y, bounds.w, bounds.h,
                { ...sensorOpts, label: `goal-${owner.id}` });
            Composite.add(engine.world, owner.goalSensor);

            const px = edgeName === 'left'   ? bounds.x + PADDLE_THICKNESS :
                       edgeName === 'right'  ? bounds.x - PADDLE_THICKNESS : bounds.x;
            const py = edgeName === 'top'    ? bounds.y + PADDLE_THICKNESS :
                       edgeName === 'bottom' ? bounds.y - PADDLE_THICKNESS : bounds.y;
            const pw = (edgeName === 'top' || edgeName === 'bottom') ? PADDLE_LENGTH : PADDLE_THICKNESS;
            const ph = (edgeName === 'left' || edgeName === 'right') ? PADDLE_LENGTH : PADDLE_THICKNESS;

            owner.paddle = Bodies.rectangle(px, py, pw, ph,
                { ...paddleOpts, label: `paddle-${owner.id}` });
            Composite.add(engine.world, owner.paddle);
        } else {
            Composite.add(engine.world, Bodies.rectangle(bounds.x, bounds.y, bounds.w, bounds.h,
                { ...wallOpts }));
        }
    }

    const cw = PADDLE_THICKNESS * 2;
    Composite.add(engine.world, [
        Bodies.rectangle(offsetX,             offsetY,             cw, cw, { ...wallOpts }),
        Bodies.rectangle(offsetX + arenaSize, offsetY,             cw, cw, { ...wallOpts }),
        Bodies.rectangle(offsetX,             offsetY + arenaSize, cw, cw, { ...wallOpts }),
        Bodies.rectangle(offsetX + arenaSize, offsetY + arenaSize, cw, cw, { ...wallOpts }),
    ]);

    spawnBall();
}

function getSafeAngle() {
    const quadrant = Math.floor(Math.random() * 4);
    const base     = (quadrant * 90 + 45) * Math.PI / 180;
    const offset   = (Math.random() - 0.5) * 40 * Math.PI / 180;
    return base + offset;
}

function spawnBall() {
    if (ball) Composite.remove(engine.world, ball);
    ballTrail = [];

    ball = Bodies.circle(canvas.width / 2, canvas.height / 2, BALL_RADIUS, {
        restitution:   1.0,
        friction:      0,
        frictionAir:   0,
        frictionStatic: 0,
        inertia:       Infinity,
        inverseInertia: 0,
        label:         'ball',
    });

    Composite.add(engine.world, ball);
    Body.setInertia(ball, Infinity);
    const angle = getSafeAngle();
    Body.setVelocity(ball, { x: Math.cos(angle) * BALL_SPEED, y: Math.sin(angle) * BALL_SPEED });
}

// ==========================================
// COLLISION & SCORING
// ==========================================
function updateScoreDisplay(player) {
    const el = document.getElementById(`score-p${player.id}`);
    if (!el) return;
    const filled = '●'.repeat(Math.max(0, player.lives));
    const empty  = '○'.repeat(Math.max(0, 5 - player.lives));
    el.textContent = `${player.label} ${filled}${empty}`;
}

function processHit(player) {
    sfx.damage();

    player.lives--;
    const scoreEl = document.getElementById(`score-p${player.id}`);
    updateScoreDisplay(player);

    canvas.style.transform = `translate(${Math.random()*15 - 7.5}px,${Math.random()*15 - 7.5}px)`;
    setTimeout(() => { canvas.style.transform = 'translate(0,0)'; }, 50);

    if (player.lives <= 0) {
        player.active = false;
        if (scoreEl) scoreEl.textContent = `${player.label}: OUT`;

        Composite.remove(engine.world, player.paddle);

        const b  = player.goalSensor.bounds;
        const bw = b.max.x - b.min.x;
        const bh = b.max.y - b.min.y;
        Composite.add(engine.world, Bodies.rectangle(
            b.min.x + bw / 2, b.min.y + bh / 2, bw, bh,
            { isStatic: true, restitution: 1.0, friction: 0, label: 'wall' }
        ));
        Composite.remove(engine.world, player.goalSensor);
    }

    const active = players.filter(p => p.active);
    if (active.length <= 1) {
        gameRunning = false;
        sfx.gameover();
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) pauseBtn.style.display = 'none';
        const ppBack = document.getElementById('pp-back');
        if (ppBack) ppBack.style.display = 'flex';

        const winner = active[0] || null;
        if (winner && winner.id === 1) saveQPWin();

        if (winnerText) {
            winnerText.textContent = winner ? `${winner.label} WINS!` : 'DRAW!';
            winnerText.style.color = winner ? winner.color : '#fff';
        }
        const goWins = document.getElementById('go-wins');
        if (goWins) goWins.textContent = getQPWins() || '—';
        if (gameOverScreen) gameOverScreen.classList.remove('hidden');
    } else {
        spawnBall();
    }
}

// ==========================================
// INPUT & RENDERING
// ==========================================
const touchToEdge = {};

function getTouchEdge(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width  / rect.width);
    const y = (clientY - rect.top)  * (canvas.height / rect.height);

    if (selectedPlayerCount === 2) {
        // Only top/bottom paddles exist — full-screen vertical split.
        return y > canvas.height / 2 ? 'bottom' : 'top';
    }

    // 3/4 players: zone-based detection. Top/bottom priority zones cover
    // the full width; left/right zones apply to the middle-height band.
    if (y < canvas.height * 0.30) return 'top';
    if (y > canvas.height * 0.70) return 'bottom';
    if (x < canvas.width  * 0.30) return 'left';
    if (x > canvas.width  * 0.70) return 'right';
    // Unambiguous center: fall back to nearest screen edge.
    const dists = { bottom: canvas.height - y, top: y, left: x, right: canvas.width - x };
    return Object.keys(dists).reduce((a, b) => dists[a] < dists[b] ? a : b);
}

function movePaddleByTouch(clientX, clientY, edge) {
    const p = players.find(pl => pl.edge === edge && pl.active && pl.paddle);
    if (!p) return;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width  / rect.width);
    const y = (clientY - rect.top)  * (canvas.height / rect.height);
    const minBX = offsetX + PADDLE_LENGTH / 2;
    const maxBX = offsetX + arenaSize - PADDLE_LENGTH / 2;
    const minBY = offsetY + PADDLE_LENGTH / 2;
    const maxBY = offsetY + arenaSize - PADDLE_LENGTH / 2;
    const prevX = p.paddle.position.x;
    const prevY = p.paddle.position.y;
    if (p.edge === 'bottom' || p.edge === 'top') {
        const newX = Math.max(minBX, Math.min(x, maxBX));
        Body.setPosition(p.paddle, { x: newX, y: prevY });
        Body.setVelocity(p.paddle, { x: newX - prevX, y: 0 });
    } else {
        const newY = Math.max(minBY, Math.min(y, maxBY));
        Body.setPosition(p.paddle, { x: prevX, y: newY });
        Body.setVelocity(p.paddle, { x: 0, y: newY - prevY });
    }
}

function drawRect(body, color) {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = color || '#555';
    ctx.fillRect(body.position.x - w / 2, body.position.y - h / 2, w, h);
    ctx.restore();
}

function updateAI() {
    if (!ball || !gameRunning) return;
    const AI_SPEED = 3 + selectedSpeed * 1.2;
    const minBX    = offsetX + PADDLE_LENGTH / 2;
    const maxBX    = offsetX + arenaSize - PADDLE_LENGTH / 2;
    const minBY    = offsetY + PADDLE_LENGTH / 2;
    const maxBY    = offsetY + arenaSize - PADDLE_LENGTH / 2;
    const lookAhead = 8;
    const predictX  = ball.position.x + ball.velocity.x * lookAhead;
    const predictY  = ball.position.y + ball.velocity.y * lookAhead;

    players.forEach(p => {
        if (!p.active || !p.paddle || !p.isAI) return;
        if (p.edge === 'top' || p.edge === 'bottom') {
            const target = Math.max(minBX, Math.min(predictX, maxBX));
            const cur    = p.paddle.position.x;
            const newX   = cur + Math.sign(target - cur) * Math.min(AI_SPEED, Math.abs(target - cur));
            Body.setPosition(p.paddle, { x: newX, y: p.paddle.position.y });
            Body.setVelocity(p.paddle, { x: newX - cur, y: 0 });
        } else {
            const target = Math.max(minBY, Math.min(predictY, maxBY));
            const cur    = p.paddle.position.y;
            const newY   = cur + Math.sign(target - cur) * Math.min(AI_SPEED, Math.abs(target - cur));
            Body.setPosition(p.paddle, { x: p.paddle.position.x, y: newY });
            Body.setVelocity(p.paddle, { x: 0, y: newY - cur });
        }
    });
}

function gameLoop() {
    if (!ctx || !canvas || qpPaused) return;

    Engine.update(engine, 1000 / 60);
    updateAI();

    // Enforce constant ball speed every frame to counter floating-point energy
    // loss across collisions. Clamp to [BALL_SPEED, maxSpeed] preserving direction.
    if (ball && gameRunning) {
        const vx    = ball.velocity.x;
        const vy    = ball.velocity.y;
        const speed = Math.hypot(vx, vy);
        if (speed > 0) {
            const target = Math.max(BALL_SPEED, Math.min(speed, maxSpeed));
            if (Math.abs(speed - target) > 0.01) {
                Body.setVelocity(ball, { x: (vx / speed) * target, y: (vy / speed) * target });
            }
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(offsetX, offsetY, arenaSize, arenaSize);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(offsetX,            canvas.height / 2); ctx.lineTo(offsetX + arenaSize, canvas.height / 2);
    ctx.moveTo(canvas.width / 2,   offsetY);           ctx.lineTo(canvas.width / 2,   offsetY + arenaSize);
    ctx.stroke();

    engine.world.bodies.forEach(b => {
        if (b.isStatic && !b.isSensor && !b.label.startsWith('paddle')) {
            drawRect(b, '#1a1a2e');
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth   = 1;
            ctx.strokeRect(b.bounds.min.x, b.bounds.min.y,
                b.bounds.max.x - b.bounds.min.x, b.bounds.max.y - b.bounds.min.y);
        }
    });

    players.forEach(p => {
        if (p.active && p.paddle) {
            drawRect(p.paddle, p.color);
            ctx.fillStyle   = p.color;
            ctx.globalAlpha = 0.2;
            if (p.goalSensor) drawRect(p.goalSensor, p.color);
            ctx.globalAlpha = 1.0;
        }
    });

    if (ball) {
        ballTrail.push({ x: ball.position.x, y: ball.position.y });
        if (ballTrail.length > 8) ballTrail.shift();

        ballTrail.forEach((pos, i) => {
            const alpha = (i / ballTrail.length) * 0.3;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, BALL_RADIUS * (i / ballTrail.length), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.fill();
        });

        ctx.save();
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur  = 15;
        ctx.beginPath();
        ctx.arc(ball.position.x, ball.position.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ==========================================
// RESIZE & SCALING
// ==========================================
function resizeCanvas() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}

function resizeQP() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    canvas.width  = winW;
    canvas.height = winH;
    canvas.style.width    = winW + 'px';
    canvas.style.height   = winH + 'px';
    canvas.style.position = 'fixed';
    canvas.style.left     = '0px';
    canvas.style.top      = '0px';
}

// ==========================================
// DOM ARCHITECTURE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('gameCanvas');
    if (canvas) ctx = canvas.getContext('2d');

    engine = Engine.create();
    engine.gravity.y = 0;

    Events.on(engine, 'collisionStart', function(event) {
        for (const pair of event.pairs) {
            const { bodyA, bodyB } = pair;
            const labels = [bodyA.label, bodyB.label];

            if (labels.includes('ball') && (labels[0].startsWith('goal-') || labels[1].startsWith('goal-'))) {
                const sensor   = bodyA.label.startsWith('goal-') ? bodyA : bodyB;
                const playerId = parseInt(sensor.label.split('-')[1]);
                const player   = players.find(p => p.id === playerId);
                if (player && player.active) processHit(player);
            }
            else if (labels.includes('ball') && (labels[0].startsWith('paddle-') || labels[1].startsWith('paddle-'))) {
                sfx.paddleHit();
                const vx  = ball.velocity.x;
                const vy  = ball.velocity.y;
                const spd = Math.hypot(vx, vy);
                if (spd > 0) {
                    const newSpd = Math.min(spd + HIT_INCREMENT, maxSpeed);
                    Body.setVelocity(ball, { x: (vx / spd) * newSpd, y: (vy / spd) * newSpd });
                }
            }
            else if (labels.includes('ball') && labels.includes('wall')) {
                sfx.bounce();
            }
        }
    });

    Events.on(engine, 'beforeUpdate', function() {
        if (!gameRunning || !ball) return;

        const MIN_ANGLE = 25 * Math.PI / 180;
        const vx    = ball.velocity.x;
        const vy    = ball.velocity.y;
        const speed = Math.hypot(vx, vy);

        if (speed < 0.1) {
            const a = getSafeAngle();
            Body.setVelocity(ball, { x: Math.cos(a) * BALL_SPEED, y: Math.sin(a) * BALL_SPEED });
            return;
        }
        if (speed > maxSpeed) {
            Body.setVelocity(ball, { x: (vx / speed) * maxSpeed, y: (vy / speed) * maxSpeed });
            return;
        }

        let angle     = Math.atan2(vy, vx);
        const axes    = [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI];
        let corrected = false;
        for (const axis of axes) {
            let diff = angle - axis;
            while (diff >  Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            if (Math.abs(diff) < MIN_ANGLE) {
                angle     = axis + (diff >= 0 ? MIN_ANGLE : -MIN_ANGLE);
                corrected = true;
                break;
            }
        }
        if (corrected) {
            Body.setVelocity(ball, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
        }
    });

    startMenu      = document.getElementById('start-menu');
    modeMenu       = document.getElementById('mode-menu');
    speedMenu      = document.getElementById('speed-menu');
    gameOverScreen = document.getElementById('game-over-screen');
    winnerText     = document.getElementById('winner-text');

    const winsEl = document.getElementById('title-wins');
    if (winsEl) winsEl.textContent = getQPWins() || '—';

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && gameStarted) {
            toggleQPPause();
            return;
        }
        if (!gameStarted && speedMenu && !speedMenu.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') setSpeed(Math.max(1, selectedSpeed - 1));
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') setSpeed(Math.min(5, selectedSpeed + 1));
        }
    });

    window.addEventListener('resize', resizeQP);
    window.addEventListener('orientationchange', resizeQP);

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', toggleQPPause);
        pauseBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleQPPause();
        }, { passive: false });
    }

    if (canvas) {
        canvas.addEventListener('mousemove', e => {
            if (!gameRunning) return;
            const edge = getTouchEdge(e.clientX, e.clientY);
            movePaddleByTouch(e.clientX, e.clientY, edge);
        });

        canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            if (!gameRunning) return;
            // Check pause button per-touch so other fingers still control paddles.
            const pauseRect = document.getElementById('pause-btn')
                ? document.getElementById('pause-btn').getBoundingClientRect()
                : null;
            Array.from(e.changedTouches).forEach(touch => {
                if (pauseRect &&
                    touch.clientX >= pauseRect.left && touch.clientX <= pauseRect.right &&
                    touch.clientY >= pauseRect.top  && touch.clientY <= pauseRect.bottom) return;
                const edge = getTouchEdge(touch.clientX, touch.clientY);
                touchToEdge[touch.identifier] = edge;
                movePaddleByTouch(touch.clientX, touch.clientY, edge);
            });
        }, { passive: false });

        canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            if (!gameRunning) return;
            // Use the edge assigned at touchstart — don't re-run getTouchEdge
            // to avoid jumps when a finger drifts across a zone boundary.
            Array.from(e.changedTouches).forEach(touch => {
                const edge = touchToEdge[touch.identifier];
                if (edge) movePaddleByTouch(touch.clientX, touch.clientY, edge);
            });
        }, { passive: false });

        canvas.addEventListener('touchend', e => {
            e.preventDefault();
            // If the touch never registered in touchToEdge (e.g. started on
            // the pause button), the lookup returns undefined and no-ops cleanly.
            Array.from(e.changedTouches).forEach(touch => {
                const edge = touchToEdge[touch.identifier];
                delete touchToEdge[touch.identifier];
                const p = players.find(pl => pl.edge === edge);
                if (p && p.paddle) Body.setVelocity(p.paddle, { x: 0, y: 0 });
            });
        }, { passive: false });

        canvas.addEventListener('touchcancel', e => {
            e.preventDefault();
            Array.from(e.changedTouches).forEach(touch => {
                delete touchToEdge[touch.identifier];
            });
        }, { passive: false });
    }
});
