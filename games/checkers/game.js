'use strict';

///////////////////////////////////////////////////////////////////////////////
// COLORS
const COLOR_BG       = new Color().setHex('#0d1622');
const COLOR_DARK_SQ  = new Color().setHex('#8B4513');
const COLOR_LIGHT_SQ = new Color().setHex('#DEB887');
const COLOR_BORDER   = new Color().setHex('#5b3a1d');
const COLOR_BORDER_L = new Color().setHex('#7a5030');
const COLOR_RED      = new Color().setHex('#CC2222');
const COLOR_REDF     = new Color().setHex('#FF5555');
const COLOR_PIECE_B  = new Color().setHex('#1a1a1a');
const COLOR_PIECE_BF = new Color().setHex('#484848');
const COLOR_GOLD     = new Color().setHex('#FFD700');
const COLOR_DOT      = new Color().setHex('#66DD00');
const COLOR_DOT_CAP  = new Color().setHex('#44FF88');

///////////////////////////////////////////////////////////////////////////////
// BOARD LAYOUT
// CK_BOARD=8 defined in ai.js  (row 0 = bottom, row 7 = top)
const CELL_SIZE  = 1.52;
const PIECE_D    = CELL_SIZE * .82;   // diameter
const BOARD_OFF_Y = -.3;

///////////////////////////////////////////////////////////////////////////////
// STATE
let board       = [];
let currentP    = 1;
let gameMode    = 'vsAI';
let aiDiff      = 'medium';
let winner      = null;
let selectedR   = -1, selectedC = -1;
let validMoves  = [];   // moves for selected piece
let allMoves    = [];   // all legal moves for currentP
let scores      = {p1: 0, p2: 0};
let aiTimer     = new Timer();
let endTimer    = new Timer();
let animT       = 0;    // general animation clock (radians)
let hoverR      = -1, hoverC = -1;

///////////////////////////////////////////////////////////////////////////////
// SOUNDS
let sfxMove, sfxCapture, sfxKing, sfxWin;

///////////////////////////////////////////////////////////////////////////////
// HELPERS

function cellToWorld(c, r)
{
    const sx = -(CK_BOARD * CELL_SIZE) / 2 + CELL_SIZE / 2;
    const sy = -(CK_BOARD * CELL_SIZE) / 2 + CELL_SIZE / 2 + BOARD_OFF_Y;
    return vec2(sx + c * CELL_SIZE, sy + r * CELL_SIZE);
}

function worldToCell(wx, wy)
{
    const sx = -(CK_BOARD * CELL_SIZE) / 2;
    const sy = -(CK_BOARD * CELL_SIZE) / 2 + BOARD_OFF_Y;
    const c = Math.floor((wx - sx) / CELL_SIZE);
    const r = Math.floor((wy - sy) / CELL_SIZE);
    return (c >= 0 && c < CK_BOARD && r >= 0 && r < CK_BOARD) ? {r, c} : null;
}

///////////////////////////////////////////////////////////////////////////////
// BOARD INIT

function initBoard()
{
    board = Array.from({length: CK_BOARD}, () => new Array(CK_BOARD).fill(null));
    // P1 red: bottom 3 rows; P2 black: top 3 rows
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < CK_BOARD; c++)
            if ((r + c) % 2 === 1) board[r][c] = {p: 1, k: false};
    for (let r = 5; r < CK_BOARD; r++)
        for (let c = 0; c < CK_BOARD; c++)
            if ((r + c) % 2 === 1) board[r][c] = {p: 2, k: false};

    currentP   = 1;
    winner     = null;
    selectedR  = -1; selectedC = -1;
    validMoves = [];
    allMoves   = ckGetAllMoves(board, 1);
    aiTimer.unset();
    endTimer.unset();
}

///////////////////////////////////////////////////////////////////////////////
// MOVE EXECUTION

function executeMove(move)
{
    const wasKing = board[move.from.r][move.from.c]?.k ?? false;
    board = ckApplyMove(board, move);
    const isKingNow = board[move.to.r][move.to.c]?.k ?? false;

    if (move.caps.length > 0) { sfxCapture.play(); addScreenShake(.08, .22); }
    else                      { sfxMove.play(); }
    if (!wasKing && isKingNow) { sfxKing.play(); addScreenShake(.1, .3); }

    selectedR = -1; selectedC = -1;
    validMoves = [];

    // Check if opponent has any moves
    const opp = 3 - currentP;
    const oppMoves = ckGetAllMoves(board, opp);
    if (!oppMoves.length) {
        winner = currentP;
        if (currentP === 1) scores.p1++; else scores.p2++;
        sfxWin.play();
        addScreenShake(.22, .6);
        allMoves = [];
        endTimer.set(.9);
        return;
    }

    currentP = opp;
    allMoves = oppMoves;
}

function showEndGame()
{
    const p1label = gameMode === 'vsAI' ? 'YOU'  : 'P1';
    const p2label = gameMode === 'vsAI' ? 'AI'   : 'P2';
    showAlertDialog({
        title:   winner === 1 ? `${p1label} WIN${gameMode==='vsAI'?'':'S'}!` : `${p2label} WIN${gameMode==='vsAI'?'':'S'}!`,
        icon:    winner === 1 ? '🏆' : '💥',
        message: `P1: ${scores.p1}   P2: ${scores.p2}`,
        onOk:    () => initBoard(),
    });
}

///////////////////////////////////////////////////////////////////////////////
// FLOW

function startGame(mode, diff)
{
    gameMode = mode;
    if (diff) aiDiff = diff;
    initBoard();
    clearSubmenuStack();
    hideAllMenus();
    setPlaying(true);
}

function quitToTitle()
{
    setPlaying(false);
    clearSubmenuStack();
    hideAllMenus();
    showMenu('title');
}

///////////////////////////////////////////////////////////////////////////////
// ENGINE CALLBACKS

async function gameInit()
{
    canvasClearColor = COLOR_BG;
    cameraScale      = 46;
    canvasFixedSize  = vec2(700, 1080);
    setSoundVolume(.8);
    saveDataInit('PixelPlay_Checkers');
    setMenuVisibilityCallback(v => {
        paused = v;
        const ppBack = document.getElementById('pp-back');
        if (ppBack) ppBack.style.display = v && !isPlaying() ? 'flex' : 'none';
    });

    sfxMove    = new SoundGenerator({frequency: 320, release: .1,  slide: -.1,  volume: .35});
    sfxCapture = new SoundGenerator({frequency: 180, release: .18, slide: -.25, noise: .06, volume: .55});
    sfxKing    = new SoundGenerator({frequency: 660, release: .3,  slide: .28, pitchJump: 340, pitchJumpTime: .09, volume: .6});
    sfxWin     = new SoundGenerator({frequency: 520, release: .4,  slide: .32, pitchJump: 450, pitchJumpTime: .12, volume: .7});

    createMenu({
        id: 'title',
        title: 'CHECKERS',
        dismissable: false,
        onStart: () => startGame('vsAI', aiDiff),
        items: [
            {type: 'button', label: 'VS AI',     onClick: () => pushMenu('difficulty')},
            {type: 'button', label: '2 PLAYERS', onClick: () => startGame('pvp')},
            {type: 'button', label: 'OPTIONS',   onClick: () => pushMenu('options')},
        ],
    });

    createMenu({
        id: 'difficulty',
        title: 'AI DIFFICULTY',
        onHide: popMenu,
        items: [
            {type: 'button', label: 'EASY',   onClick: () => startGame('vsAI', 'easy')},
            {type: 'button', label: 'MEDIUM', onClick: () => startGame('vsAI', 'medium')},
            {type: 'button', label: 'HARD',   onClick: () => startGame('vsAI', 'hard')},
            {type: 'separator'},
            {type: 'button', label: 'BACK',   onClick: () => hideMenu('difficulty')},
        ],
    });

    createOptionsMenu();
    createPauseMenu({
        onRestart: initBoard,
        onQuit:    quitToTitle,
        extraItems: [
            {type: 'button', label: 'OPTIONS',     onClick: () => pushMenu('options')},
            {type: 'button', label: '← PIXELPLAY', onClick: () => { window.location.href = window.Capacitor ? '../../app.html' : '../../index.html'; }},
        ],
    });

    installDefaultToolbar({landscapeStack: true});
    initBoard();
    setPlaying(false);
    showMenu('title');
}

function gameUpdate()
{
    if (bindPauseKey({when: () => isPlaying()})) return;
    if (!isPlaying()) return;

    animT = (animT + timeDelta * 4) % (Math.PI * 2);

    if (endTimer.elapsed()) { endTimer.unset(); showEndGame(); return; }
    if (winner) return;

    // Hover
    const cell = worldToCell(mousePos.x, mousePos.y);
    hoverR = cell ? cell.r : -1;
    hoverC = cell ? cell.c : -1;

    // AI turn
    if (gameMode === 'vsAI' && currentP === 2) {
        if (!aiTimer.isSet()) aiTimer.set(.5);
        if (aiTimer.elapsed()) {
            aiTimer.unset();
            hoverR = -1; hoverC = -1;
            const depth = aiDiff === 'easy' ? 0 : aiDiff === 'medium' ? 3 : 5;
            const m = ckGetBestMove(board, 2, depth);
            if (m) executeMove(m);
        }
        return;
    }

    // Human click — use mousePos (world space) directly for hit testing
    if (mouseWasPressed(0)) {
        const clickCell = worldToCell(mousePos.x, mousePos.y);
        if (clickCell) {
            const {r, c} = clickCell;

            // Try to execute a move to the clicked square first
            if (selectedR >= 0 && validMoves.length > 0) {
                const chosen = validMoves.find(m => m.to.r === r && m.to.c === c);
                if (chosen) { executeMove(chosen); return; }
            }

            // Try to select a friendly piece on a dark square
            if ((r + c) % 2 === 1 && board[r][c] && board[r][c].p === currentP) {
                const movesForPiece = allMoves.filter(m => m.from.r === r && m.from.c === c);
                if (movesForPiece.length > 0) {
                    selectedR = r;
                    selectedC = c;
                    validMoves = movesForPiece;
                }
                return;
            }

            // Clicked elsewhere — deselect
            selectedR = -1; selectedC = -1; validMoves = [];
        }
    }
}

function gameUpdatePost() {}

///////////////////////////////////////////////////////////////////////////////
// RENDERING

function drawPiece(r, c, piece, alpha)
{
    const wp  = cellToWorld(c, r);
    const bc  = piece.p === 1 ? COLOR_RED    : COLOR_PIECE_B;
    const fc  = piece.p === 1 ? COLOR_REDF   : COLOR_PIECE_BF;

    drawCircle(wp, PIECE_D, new Color(bc.r, bc.g, bc.b, alpha));
    drawCircle(wp, PIECE_D * .80, new Color(fc.r, fc.g, fc.b, alpha));
    // Shine spot
    drawCircle(wp.add(vec2(-PIECE_D * .19, PIECE_D * .21)), PIECE_D * .26,
        new Color(1, 1, 1, .38 * alpha));
    // King ring
    if (piece.k) {
        drawCircle(wp, PIECE_D * 1.08,
            new Color(0, 0, 0, 0), .06,
            new Color(COLOR_GOLD.r, COLOR_GOLD.g, COLOR_GOLD.b, alpha));
        drawCircle(wp, PIECE_D * .22,
            new Color(COLOR_GOLD.r, COLOR_GOLD.g, COLOR_GOLD.b, alpha));
    }
}

function gameRender()
{
    const boardW = CK_BOARD * CELL_SIZE;
    const boardH = CK_BOARD * CELL_SIZE;
    const bx = 0, by = BOARD_OFF_Y;

    // Outer shadow + wooden border bevel
    drawRect(vec2(bx, by), vec2(boardW + .6, boardH + .6), new Color(0, 0, 0, 0.5));
    drawRect(vec2(bx, by), vec2(boardW + .38, boardH + .38), COLOR_BORDER_L);
    drawRect(vec2(bx, by - .07), vec2(boardW + .32, boardH + .3), COLOR_BORDER);

    // Squares
    for (let r = 0; r < CK_BOARD; r++)
        for (let c = 0; c < CK_BOARD; c++) {
            const wp  = cellToWorld(c, r);
            const col = (r + c) % 2 === 0 ? COLOR_LIGHT_SQ : COLOR_DARK_SQ;
            drawRect(wp, vec2(CELL_SIZE - .02), col);
        }

    // Valid move destination dots
    for (const m of validMoves) {
        const wp  = cellToWorld(m.to.c, m.to.r);
        const isCap = m.caps.length > 0;
        const dc  = isCap ? COLOR_DOT_CAP : COLOR_DOT;
        drawCircle(wp, CELL_SIZE * .24, new Color(dc.r, dc.g, dc.b, .72));
    }

    // Orange tint on pieces with mandatory captures
    if (allMoves.length > 0 && allMoves[0].caps.length > 0) {
        const seen = new Set();
        for (const m of allMoves) {
            const key = `${m.from.r},${m.from.c}`;
            if (!seen.has(key)) {
                seen.add(key);
                const wp = cellToWorld(m.from.c, m.from.r);
                drawCircle(wp, PIECE_D * 1.12, new Color(1, .45, 0, .22));
            }
        }
    }

    // Hover tint on pieces that have legal moves
    if (hoverR >= 0 && (hoverR + hoverC) % 2 === 1 && !winner) {
        const hp = board[hoverR][hoverC];
        if (hp && hp.p === currentP) {
            const canMove = allMoves.some(m => m.from.r === hoverR && m.from.c === hoverC);
            if (canMove) {
                const wp = cellToWorld(hoverC, hoverR);
                drawRect(wp, vec2(CELL_SIZE * .94), new Color(1, 1, 1, .09));
            }
        }
    }

    // Pieces — selected piece gets gold glow ring
    for (let r = 0; r < CK_BOARD; r++)
        for (let c = 0; c < CK_BOARD; c++) {
            const piece = board[r][c];
            if (!piece) continue;

            if (r === selectedR && c === selectedC) {
                const pulse = .55 + Math.sin(animT * 2) * .25;
                const wp    = cellToWorld(c, r);
                drawCircle(wp, PIECE_D * 1.22,
                    new Color(0, 0, 0, 0), .08,
                    new Color(COLOR_GOLD.r, COLOR_GOLD.g, COLOR_GOLD.b, pulse));
            }

            drawPiece(r, c, piece, 1);
        }

    // Win glow on winning player's pieces
    if (winner) {
        const pulse = .45 + Math.sin(animT) * .3;
        for (let r = 0; r < CK_BOARD; r++)
            for (let c = 0; c < CK_BOARD; c++) {
                const p = board[r][c];
                if (p && p.p === winner) {
                    const wp = cellToWorld(c, r);
                    drawCircle(wp, PIECE_D * 1.16, new Color(1, 1, 1, pulse * .18));
                }
            }
    }
}

function gameRenderPost()
{
    if (!isPlaying()) return;
    const cx = mainCanvasSize.x / 2;

    const p1label = gameMode === 'vsAI' ? 'YOU' : 'P1';
    const p2label = gameMode === 'vsAI' ? 'AI'  : 'P2';
    drawTextScreen(`${p1label}: ${scores.p1}`,
        vec2(cx * 0.55, 48), 22,
        new Color().setHex('#CC2222'), 2,
        new Color(0, 0, 0, 0.5));
    drawTextScreen(`${p2label}: ${scores.p2}`,
        vec2(cx * 1.45, 48), 22,
        new Color(0.72, 0.72, 0.72, 1), 2,
        new Color(0, 0, 0, 0.5));

    if (!winner) {
        const label = gameMode === 'pvp'
            ? (currentP === 1 ? 'PLAYER 1 (RED)' : 'PLAYER 2 (BLACK)')
            : (currentP === 1 ? 'YOUR TURN' : 'AI THINKING…');
        const col = currentP === 1
            ? COLOR_REDF
            : new Color(.72, .72, .72);
        drawTextScreen(label, vec2(cx, mainCanvasSize.y - 48), 26, col, 1, rgb(0,0,0,.4));
    }
}

///////////////////////////////////////////////////////////////////////////////
engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost);
