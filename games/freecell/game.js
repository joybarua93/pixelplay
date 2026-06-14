'use strict';

paused = false;

// Engine Settings
canvasFixedSize = vec2(700, 1080);

///////////////////////////////////////////////////////////////////////////////
// LAYOUT CONSTANTS
const COL_COUNT   = 8;
const COL_PITCH_X = 7;
const CARD_PITCH_Y = 1.65;
const TOP_MARGIN  = 1.0;
const MAX_DEPTH   = 14;

const StackType = { FreeCell: 0, Home: 1, Tableau: 2 };

function tableauOffset(index) { return vec2(0, -CARD_PITCH_Y * index); }

///////////////////////////////////////////////////////////////////////////////
// STATE
let freeCellStacks = [];
let homeStacks     = [];
let tableauStacks  = [];
let allStacks      = [];

let handStack    = null;
let pickupOrigin = null;
let mouseHoldPos = vec2();
let history      = null;

let moveCount    = 0;
let gameWon      = false;
let winTimer     = new Timer();
let winSparks    = false;    // one-shot particle burst

let layoutLeftX  = 0;
let layoutTopY   = 8;
let layoutCascadeY = -2;

///////////////////////////////////////////////////////////////////////////////
// LAYOUT & CAMERA

function setupLayout()
{
    layoutLeftX    = -((COL_COUNT - 1) * COL_PITCH_X) / 2;   // -24.5
    layoutTopY     = 8;
    layoutCascadeY = layoutTopY - CARD_SIZE.y - 1.5;

    const topY    = layoutTopY + CARD_SIZE.y / 2;
    const bottomY = layoutCascadeY - CARD_PITCH_Y * MAX_DEPTH - CARD_SIZE.y / 2;
    const tableW  = (COL_COUNT - 1) * COL_PITCH_X + CARD_SIZE.x + 2;
    const tableH  = topY - bottomY + TOP_MARGIN + 1;
    cameraScale   = min(mainCanvasSize.x / tableW, mainCanvasSize.y / tableH);
    const viewH   = mainCanvasSize.y / cameraScale;
    const spareY  = max(0, viewH - tableH);
    cameraPos     = vec2(0, topY + TOP_MARGIN + spareY / 2 - viewH / 2);
}

///////////////////////////////////////////////////////////////////////////////
// BOARD BUILDING

function buildTable()
{
    freeCellStacks = [];
    homeStacks     = [];
    tableauStacks  = [];

    for (let i = 0; i < 4; i++) {
        freeCellStacks.push(new CardStack(
            vec2(layoutLeftX + i * COL_PITCH_X, layoutTopY), StackType.FreeCell));
        homeStacks.push(new CardStack(
            vec2(layoutLeftX + (i + 4) * COL_PITCH_X, layoutTopY), StackType.Home));
    }
    for (let i = 0; i < 8; i++) {
        tableauStacks.push(new CardStack(
            vec2(layoutLeftX + i * COL_PITCH_X, layoutCascadeY),
            StackType.Tableau, tableauOffset));
    }
    allStacks = [...freeCellStacks, ...homeStacks, ...tableauStacks];

    handStack    = new CardStack(vec2(0, 0), StackType.Tableau, tableauOffset);
    pickupOrigin = null;
}

function dealCards()
{
    const deck = shuffledDeck();
    // First 4 columns get 7 cards, last 4 get 6 — total 52
    let idx = 0;
    for (let col = 0; col < 8; col++) {
        const n = col < 4 ? 7 : 6;
        for (let i = 0; i < n; i++) {
            const card = deck[idx++];
            card.faceUp = true;
            tableauStacks[col].putCardOnTop(card);
        }
    }
}

function newGame()
{
    moveCount = 0;
    gameWon   = false;
    winSparks = false;
    winTimer.unset();
    buildTable();
    dealCards();
    history.reset();
}

///////////////////////////////////////////////////////////////////////////////
// UNDO / HISTORY

function snapshot()
{
    return {
        stacks:    allStacks.map(s => s.cards.map(c => [c.value, c.suit])),
        moveCount,
    };
}

function loadState(snap)
{
    if (!snap || !snap.stacks) return;
    for (let i = 0; i < allStacks.length; i++) {
        allStacks[i].cards = snap.stacks[i].map(([v, s]) => new Card(v, s, true));
        allStacks[i].relayout();
    }
    for (const s of allStacks) for (const c of s.cards) c.tweenFrom = null;
    moveCount = snap.moveCount || 0;
    gameWon   = false;
    winSparks = false;
    winTimer.unset();
}

///////////////////////////////////////////////////////////////////////////////
// FREECELL RULES

function isOppositeColor(a, b) { return (a.suit % 2) !== (b.suit % 2); }

// Cards must form a descending alternating-color run
function isValidSequence(cards)
{
    for (let i = 1; i < cards.length; i++) {
        if (cards[i].value !== cards[i - 1].value - 1) return false;
        if (!isOppositeColor(cards[i], cards[i - 1])) return false;
    }
    return true;
}

// Max cards moveable in one drag (dest = null means count all empty cols)
function maxMoveable(dest = null)
{
    let fc = 0, ec = 0;
    for (const s of freeCellStacks) if (s.isEmpty()) fc++;
    for (const s of tableauStacks)  if (s !== dest && s.isEmpty()) ec++;
    return (fc + 1) * Math.pow(2, ec);
}

function isMoveLegal(fromStack, toStack, cards)
{
    if (!cards.length || fromStack === toStack) return false;
    const n      = cards.length;
    const bottom = cards[0];   // lowest index = bottom of the moving run

    if (toStack.type === StackType.FreeCell)
        return n === 1 && toStack.isEmpty();

    if (toStack.type === StackType.Home) {
        if (n !== 1) return false;
        if (toStack.isEmpty()) return bottom.value === RANK_ACE;
        const top = toStack.topCard();
        return top.suit === bottom.suit && bottom.value === top.value + 1;
    }

    if (toStack.type === StackType.Tableau) {
        if (!isValidSequence(cards)) return false;
        if (n > maxMoveable(toStack)) return false;
        if (toStack.isEmpty()) return true;
        const top = toStack.topCard();
        return top.value === bottom.value + 1 && isOppositeColor(top, bottom);
    }

    return false;
}

// What would lift if we clicked `hit` right now?
function pickableTail(hit)
{
    if (!hit || !hit.card) return [];
    if (hit.stack.type === StackType.Home) return [];
    if (hit.stack.type === StackType.FreeCell)
        return hit.card === hit.stack.topCard() ? [hit.card] : [];
    // Tableau: only valid sequences within move budget
    const idx  = hit.stack.cards.indexOf(hit.card);
    const tail = hit.stack.cards.slice(idx);
    if (!isValidSequence(tail)) return [];
    if (tail.length > maxMoveable()) return [];
    return tail;
}

///////////////////////////////////////////////////////////////////////////////
// WIN DETECTION

function checkWin()
{
    if (gameWon) return;
    if (!homeStacks.every(s => s.cards.length === 13)) return;
    gameWon   = true;
    winSparks = true;
    winTimer.set(1.2);
    addScreenShake(0.35, 0.9);
    const best = getBestScore();
    if (!best || moveCount < best) setBestScore(moveCount);
}

///////////////////////////////////////////////////////////////////////////////
// ENGINE CALLBACKS

async function gameInit()
{
    canvasClearColor = new Color().setHex('#0f3320');
    setSoundVolume(0.8);
    saveDataInit('PixelPlay_FreeCell');
    setMenuVisibilityCallback(v => {
        paused = v;
        const ppBack = document.getElementById('pp-back');
        if (ppBack) ppBack.style.display = v && !isPlaying() ? 'flex' : 'none';
    });

    initCardAtlas();
    setupLayout();
    history = new CardHistory({ serialize: snapshot, deserialize: loadState });

    createTitleMenu({
        title:         'FREECELL',
        subtitle:      'Clear all cards to the home stacks',
        revealOnClick: false,
        canReveal:     () => !isPlaying(),
        onPlay:        () => setPlaying(true),
        items: [
            {type: 'button', label: 'HELP',    onClick: () => pushMenu('help')},
            {type: 'button', label: 'OPTIONS', onClick: () => pushMenu('options')},
        ],
    });

    createHelpMenu({
        title: 'HOW TO PLAY',
        text:  'FREE CELLS (top-left): park any single card here.\n\n' +
               'HOME STACKS (top-right): build A → K by suit.\n\n' +
               'TABLEAU: build down in alternating colors.\n\n' +
               'MOVE LIMIT: you can move N cards at once where:\n' +
               'N = (free cells + 1) × 2^(empty columns)\n\n' +
               'WIN: move all 52 cards to the home stacks.\n\n' +
               'Z = undo   Y = redo   R = new game',
    });

    createOptionsMenu();
    createPauseMenu({
        onRestart: newGame,
        onQuit:    () => quitToTitle(newGame),
        extraItems: [
            {type: 'button', label: 'OPTIONS',     onClick: () => pushMenu('options')},
            {type: 'button', label: '← PIXELPLAY', onClick: () => { window.location.href = '../../index.html'; }},
        ],
    });

    installDefaultToolbar({ landscapeStack: true });

    newGame();
    showMenu('title');
}

function gameUpdate()
{
    if (bindPauseKey({when: () => isPlaying()})) return;
    if (!isPlaying()) return;

    // After win animation, show dialog
    if (gameWon) {
        if (winTimer.isSet() && winTimer.elapsed()) {
            winTimer.unset();
            showGameOverDialog({
                won:          true,
                score:        moveCount,
                lowerIsBetter: true,
                submitBest:   true,
                customMessage: `Solved in ${moveCount} move${moveCount !== 1 ? 's' : ''}!`,
                onContinue:   () => newGame(),
            });
        }
        return;
    }

    // Keyboard shortcuts
    const shift = keyIsDown('ShiftLeft') || keyIsDown('ShiftRight');
    if (keyWasPressed('KeyZ')) shift ? history.redoMove() : history.undoMove();
    if (keyWasPressed('KeyY')) history.redoMove();
    if (keyWasPressed('KeyR')) newGame();

    // Pick up
    if (mouseWasPressed(0) && handStack.isEmpty()) {
        const hit = cardAtPoint(allStacks, mousePos);
        const tail = pickableTail(hit);
        if (tail.length) {
            pickupOrigin = hit.stack;
            mouseHoldPos = tail[0].pos.subtract(mousePos);
            handStack.type = hit.stack.type;
            hit.stack.moveManyToStack(handStack, tail[0]);
        }
    }

    // Drag: glue held cards to cursor
    if (!handStack.isEmpty()) {
        const head = mousePos.add(mouseHoldPos);
        for (let i = 0; i < handStack.cards.length; i++)
            handStack.cards[i].pos = head.add(vec2(0, -CARD_PITCH_Y * i));
    }

    // Drop
    if (mouseWasReleased(0) && !handStack.isEmpty()) {
        const head      = mousePos.add(mouseHoldPos);
        let target      = null;
        let bestArea    = 0;

        for (const s of allStacks) {
            if (s === pickupOrigin) continue;
            const p  = s.topCard() ? s.topCard().pos : s.pos;
            const dx = CARD_SIZE.x - abs(head.x - p.x);
            const dy = CARD_SIZE.y - abs(head.y - p.y);
            if (dx > 0 && dy > 0 && dx * dy > bestArea) {
                if (isMoveLegal(pickupOrigin, s, handStack.cards)) {
                    bestArea = dx * dy;
                    target   = s;
                }
            }
        }

        handStack.moveManyToStack(target || pickupOrigin, undefined, true);
        if (target) {
            moveCount++;
            history.save();
            checkWin();
        }
        pickupOrigin = null;
    }

}

function gameUpdatePost()
{
    setupLayout();
    updateCardTweens(allStacks);

    // Winning particle bursts from each home stack
    if (winSparks) {
        winSparks = false;
        for (const hs of homeStacks) {
            new ParticleEmitter(
                hs.pos, 0,
                0.8, 0.0, 80, PI,
                undefined,
                new Color().setHex('#F5C200'), new Color().setHex('#3DC46A'),
                new Color(1, 0.9, 0.2, 0), new Color(0.2, 0.8, 0.4, 0),
                0.7, 0.28, 0.04, 0.14, 0.1,
                0.9, 1, 0.0, PI, 0.15,
                0.5
            );
        }
    }

    // Cursor
    let cursor = 'default';
    if (!handStack.isEmpty()) {
        cursor = 'grabbing';
    } else {
        const hit = cardAtPoint(allStacks, mousePos);
        if (pickableTail(hit).length) cursor = 'grab';
    }
    setCursor(cursor);
}

///////////////////////////////////////////////////////////////////////////////
// RENDERING

function drawAnyCard(c, pos)
{
    if (c.faceUp) drawCard(pos, c.value, c.suit);
    else          drawCardBack(pos);
}

function gameRender()
{
    if (!allStacks.length) return;

    // Empty slot outlines
    for (const s of freeCellStacks)
        drawCardSlot(s.pos, false);
    for (const s of homeStacks)
        drawCardSlot(s.pos, true);
    for (const s of tableauStacks)
        if (cardSlotVisible(s))
            drawCardSlot(s.pos, false);

    // Hover highlight
    const HOVER   = new Color(0.55, 0.85, 1.0, 0.38);
    const hovered = (handStack.isEmpty() && isPlaying())
        ? new Set(pickableTail(cardAtPoint(allStacks, mousePos))) : null;
    const tintFor = c => (hovered && hovered.has(c)) ? HOVER : null;

    // Render non-tweening cards
    for (const s of allStacks)
        for (const c of s.cards)
            if (!c.isTweening()) {
                if (c.faceUp) drawCard(c.pos, c.value, c.suit, {tint: tintFor(c)});
                else          drawCardBack(c.pos);
            }

    // Tweening cards on top
    for (const s of allStacks)
        for (const c of s.cards)
            if (c.isTweening()) drawAnyCard(c, c.drawnPos());

    // Held cards with drop shadow
    const shadow = new Color(0, 0, 0, 0.35);
    for (const c of handStack.cards)
        drawCardShape(c.pos.add(vec2(0.25, -0.25)), CARD_SIZE.add(vec2(0.1)), shadow);
    for (const c of handStack.cards)
        drawAnyCard(c, c.pos);
}

function gameRenderPost()
{
    if (!isPlaying()) return;
    const sw = mainCanvasSize.x, sh = mainCanvasSize.y;

    // Move counter
    drawTextScreen(`MOVES: ${moveCount}`,
        vec2(sw / 2, sh - 36), 24,
        new Color().setHex('#F5C200'), 2,
        new Color(0, 0, 0, 0.6));

    // Hint bar
    const avail = maxMoveable();
    drawTextScreen(`Move up to ${avail} card${avail !== 1 ? 's' : ''}`,
        vec2(sw / 2, sh - 16), 16,
        new Color(1, 1, 1, 0.35), 1,
        new Color(0, 0, 0, 0));
}

///////////////////////////////////////////////////////////////////////////////
engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost);
