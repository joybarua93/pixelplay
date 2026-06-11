'use strict';

///////////////////////////////////////////////////////////////////////////////
// CHECKERS AI — minimax with alpha-beta pruning
// Board: board[row][col], row 0 = bottom, 7 = top.
// P1 = 1 (red, starts rows 0-2, moves up), P2 = 2 (black, starts rows 5-7, moves down).
// Cell: null | {p:1|2, k:bool}

const CK_BOARD = 8;

const CK_POS_WEIGHT = [
    [0,5,0,5,0,5,0,5],
    [5,0,4,0,4,0,4,0],
    [0,4,0,3,0,3,0,4],
    [4,0,3,0,3,0,3,0],
    [0,3,0,3,0,3,0,4],
    [4,0,3,0,3,0,4,0],
    [0,4,0,4,0,4,0,5],
    [5,0,5,0,5,0,5,0],
];

function ckInBounds(r, c)
{
    return r >= 0 && r < CK_BOARD && c >= 0 && c < CK_BOARD;
}

// Returns all complete capture-chain moves starting from (r,c).
// Each result: {from, to, caps:[{r,c},...], path:[{r,c},...]}
function ckGetCaptureSeqs(bd, r, c, visited)
{
    const cell = bd[r][c];
    if (!cell) return [];
    const dirs = cell.k ? [[-1,-1],[-1,1],[1,-1],[1,1]] :
        cell.p === 1 ? [[1,-1],[1,1]] : [[-1,-1],[-1,1]];

    const results = [];
    for (const [dr, dc] of dirs) {
        const mr = r + dr, mc = c + dc;
        const lr = r + 2*dr, lc = c + 2*dc;
        if (!ckInBounds(lr, lc)) continue;
        const mid = bd[mr][mc];
        if (!mid || mid.p === cell.p) continue;
        if (bd[lr][lc]) continue;
        if (visited.some(v => v.r === mr && v.c === mc)) continue;

        // Apply capture to temp board
        const nb = bd.map(row => [...row]);
        nb[mr][mc] = null;
        nb[r][c]   = null;
        const moved = {...cell};
        if (moved.p === 1 && lr === CK_BOARD - 1) moved.k = true;
        if (moved.p === 2 && lr === 0)            moved.k = true;
        nb[lr][lc] = moved;

        const newVis = [...visited, {r: mr, c: mc}];
        const further = ckGetCaptureSeqs(nb, lr, lc, newVis);

        if (further.length > 0) {
            for (const f of further) {
                results.push({
                    from: {r, c},
                    to:   f.to,
                    caps: [{r: mr, c: mc}, ...f.caps],
                    path: [{r, c}, ...f.path],
                });
            }
        } else {
            results.push({
                from: {r, c},
                to:   {r: lr, c: lc},
                caps: [{r: mr, c: mc}],
                path: [{r, c}, {r: lr, c: lc}],
            });
        }
    }
    return results;
}

function ckGetPieceMoves(bd, r, c)
{
    const cell = bd[r][c];
    if (!cell) return [];

    const caps = ckGetCaptureSeqs(bd, r, c, []);
    if (caps.length > 0) return caps;

    const dirs = cell.k ? [[-1,-1],[-1,1],[1,-1],[1,1]] :
        cell.p === 1 ? [[1,-1],[1,1]] : [[-1,-1],[-1,1]];

    const moves = [];
    for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (ckInBounds(nr, nc) && !bd[nr][nc])
            moves.push({from:{r,c}, to:{r:nr,c:nc}, caps:[], path:[{r,c},{r:nr,c:nc}]});
    }
    return moves;
}

// Returns all legal moves for player; mandatory-capture rule enforced.
function ckGetAllMoves(bd, player)
{
    let captures = [], simple = [];
    for (let r = 0; r < CK_BOARD; r++)
        for (let c = 0; c < CK_BOARD; c++) {
            const cell = bd[r][c];
            if (!cell || cell.p !== player) continue;
            const ms = ckGetPieceMoves(bd, r, c);
            for (const m of ms) (m.caps.length > 0 ? captures : simple).push(m);
        }
    return captures.length > 0 ? captures : simple;
}

function ckApplyMove(bd, move)
{
    const nb = bd.map(row => [...row]);
    const piece = {...nb[move.from.r][move.from.c]};
    nb[move.from.r][move.from.c] = null;
    for (const cap of move.caps) nb[cap.r][cap.c] = null;
    if (piece.p === 1 && move.to.r === CK_BOARD - 1) piece.k = true;
    if (piece.p === 2 && move.to.r === 0)            piece.k = true;
    nb[move.to.r][move.to.c] = piece;
    return nb;
}

function ckEvaluate(bd, player)
{
    let score = 0;
    for (let r = 0; r < CK_BOARD; r++)
        for (let c = 0; c < CK_BOARD; c++) {
            const cell = bd[r][c];
            if (!cell) continue;
            const v = (cell.k ? 3 : 1) + CK_POS_WEIGHT[r][c] * .12;
            if (cell.p === player) score += v; else score -= v;
        }
    return score;
}

function ckMinimax(bd, depth, alpha, beta, maximizing, player)
{
    const cur = maximizing ? player : 3 - player;
    const moves = ckGetAllMoves(bd, cur);
    if (!moves.length) return maximizing ? -10000 : 10000;
    if (depth === 0) return ckEvaluate(bd, player);

    if (maximizing) {
        let best = -Infinity;
        for (const m of moves) {
            best = Math.max(best, ckMinimax(ckApplyMove(bd, m), depth-1, alpha, beta, false, player));
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break;
        }
        return best;
    }
    let best = Infinity;
    for (const m of moves) {
        best = Math.min(best, ckMinimax(ckApplyMove(bd, m), depth-1, alpha, beta, true, player));
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
    }
    return best;
}

function ckGetBestMove(bd, player, depth)
{
    const moves = ckGetAllMoves(bd, player);
    if (!moves.length) return null;
    if (depth === 0) {
        const caps = moves.filter(m => m.caps.length > 0);
        const pool = caps.length > 0 ? caps : moves;
        return pool[randInt(pool.length)];
    }
    let best = -Infinity, bestMove = moves[0];
    for (const m of moves) {
        const s = ckMinimax(ckApplyMove(bd, m), depth-1, -Infinity, Infinity, false, player);
        if (s > best) { best = s; bestMove = m; }
    }
    return bestMove;
}
