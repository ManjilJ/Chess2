import { useState, useMemo, useRef, useEffect } from "react";
import seedGames from "./chessGames.json";
import { Chess } from "chess.js";
import { generateAICommentary } from "./chessCommentator.js";
/* ---------------------------------------------------------------------- */
/* Board model                                                             */
/* ---------------------------------------------------------------------- */

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

const GLYPH = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const PROMO_CHOICES = [
  { type: "q", label: "Queen" },
  { type: "r", label: "Rook" },
  { type: "n", label: "Knight" },
  { type: "b", label: "Bishop" },
];

const DEFAULT_PAUSE_MS = 750;
const FLASH_MS = 2550;
const MAX_LOOPS = 250000;

function parsePieceCode(code) {
  const str = code.trim().toLowerCase();
  const color = str[0]; // 'w' | 'b'
  const rest = str.slice(1);
  let type = "p";
  if (rest.includes("p")) type = "p";
  else if (rest.includes("r")) type = "r";
  else if (rest.includes("b")) type = "b";
  else if (rest.includes("n")) type = "n";
  else if (rest.includes("q")) type = "q";
  else if (rest.includes("k")) type = "k";
  return { type, color };
}

function initialBoard(strtPos) {
  const board = {};
  if (strtPos && strtPos.trim()) {
    // Empty board and populate from STRTPOS (e.g. "e8=bk\ng7=wkr\nb3=bq")
    const tokens = strtPos.trim().split(/[\s,;]+/);
    for (const token of tokens) {
      const match = token.match(/([a-h][1-8])\s*[=:]\s*([a-zA-Z]+)/i);
      if (match) {
        const sq = match[1].toLowerCase();
        board[sq] = parsePieceCode(match[2]);
      }
    }
    return board;
  }

  // Standard starting placement
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  FILES.forEach((f, i) => {
    board[f + "8"] = { type: back[i], color: "b" };
    board[f + "7"] = { type: "p", color: "b" };
    board[f + "2"] = { type: "p", color: "w" };
    board[f + "1"] = { type: back[i], color: "w" };
  });
  return board;
}


const fileIdx = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => parseInt(sq[1], 10);

function applyPly(board, ply, capturedWhite, capturedBlack) {
  if (!ply || !ply.from || !ply.to) return;
  const piece = board[ply.from];
  if (!piece) return; // guard against missing/desynced piece
  delete board[ply.from];

  if (ply.isEnPassant) {
    const taken = board[ply.epSquare];
    if (taken) {
      (taken.color === "w" ? capturedWhite : capturedBlack).push(taken);
      delete board[ply.epSquare];
    }
  } else if (board[ply.to]) {
    const taken = board[ply.to];
    (taken.color === "w" ? capturedWhite : capturedBlack).push(taken);
  }

  board[ply.to] = ply.promotion
    ? { type: ply.promotion, color: piece.color }
    : { type: piece.type, color: piece.color };

  if (ply.isCastle) {
    const rook = board[ply.rookFrom];
    if (rook) {
      delete board[ply.rookFrom];
      board[ply.rookTo] = rook;
    }
  }
}

function replay(plies, count, strtPos, startColor = "w") {
  const board = initialBoard(strtPos);
  const capturedWhite = [];
  const capturedBlack = [];
  const limit = Math.min(count, plies.length);
  for (let i = 0; i < limit; i++) {
    if (plies[i]) applyPly(board, plies[i], capturedWhite, capturedBlack);
  }
  const startIdx = startColor === "b" ? 1 : 0;
  const turn = (count + startIdx) % 2 === 0 ? "w" : "b";
  return { board, capturedWhite, capturedBlack, turn };
}

/** Serializes a board dict + side-to-move into a FEN string so chess.js can
 *  be seeded from any custom starting position (not just the standard one).
 *  Castling rights are granted wherever a king/rook still sit on their
 *  standard home squares — a reasonable approximation since this app
 *  doesn't otherwise track "has this piece ever moved". */
function boardToFEN(board, turn) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = "";
    let empty = 0;
    for (const f of FILES) {
      const piece = board[f + r];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      const letter = piece.type;
      row += piece.color === "w" ? letter.toUpperCase() : letter.toLowerCase();
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }

  let castling = "";
  const wk = board.e1, bk = board.e8;
  if (wk && wk.type === "k" && wk.color === "w") {
    if (board.h1 && board.h1.type === "r" && board.h1.color === "w") castling += "K";
    if (board.a1 && board.a1.type === "r" && board.a1.color === "w") castling += "Q";
  }
  if (bk && bk.type === "k" && bk.color === "b") {
    if (board.h8 && board.h8.type === "r" && board.h8.color === "b") castling += "k";
    if (board.a8 && board.a8.type === "r" && board.a8.color === "b") castling += "q";
  }
  if (!castling) castling = "-";

  return `${rows.join("/")} ${turn} ${castling} - 0 1`;
}

/** new Chess(fen) throws on a malformed/illegal FEN (e.g. no king, or a
 *  king already in an impossible double-check). Falls back to the standard
 *  starting position rather than crashing the app. */
function makeChessFromFEN(fen) {
  try {
    return new Chess(fen);
  } catch (err) {
    console.warn("Invalid starting position, falling back to standard start:", err);
    return new Chess();
  }
}

function enPassantTarget(plies, count) {
  if (count === 0) return null;
  const last = plies[count - 1];
  if (
    last &&
    last.pieceType === "p" &&
    last.from &&
    last.to &&
    Math.abs(rankOf(last.from) - rankOf(last.to)) === 2
  ) {
    return last.from[0] + (rankOf(last.from) + rankOf(last.to)) / 2;
  }
  return null;
}


function notate(ply) {
  if (!ply) return "";
  if (ply.notationOverride) return ply.notationOverride;
  if (ply.isCastle) return ply.isCastle === "K" ? "O-O" : "O-O-O";
  const joiner = ply.captured || ply.isEnPassant ? "x" : "-";
  let s = ply.from + joiner + ply.to;
  if (ply.isEnPassant) s += "ep";
  if (ply.promotion) s += "=" + ply.promotion;
  return s;
}

/** Turns a stored WH/BL string back into a ply.
 *  Normalizes zeros in castling (0-0), checks (+/#), and annotations. */
function parseMove(str, board, color) {
  const raw = (str || "").trim();
  if (!raw || raw === "...") return null;

  // 1. Normalize castling notation (0-0, O-O, o-o, 0-0-0, etc.)
  const normCastle = raw.toUpperCase().replace(/0/g, "O");
  if (normCastle === "O-O" || normCastle === "O-O-O") {
    const rank = color === "w" ? "1" : "8";
    const kingSide = normCastle === "O-O";
    return {
      from: "e" + rank,
      to: (kingSide ? "g" : "c") + rank,
      pieceType: "k",
      pieceColor: color,
      isEnPassant: false,
      epSquare: null,
      isCastle: kingSide ? "K" : "Q",
      rookFrom: (kingSide ? "h" : "a") + rank,
      rookTo: (kingSide ? "f" : "d") + rank,
      promotion: null,
      notationOverride: normCastle,
    };
  }

  // 2. Check for promotion (=Q, =R, etc.)
  let s = raw.replace(/[+#!?]/g, "").trim();
  let promotion = null;
  const promoMatch = s.match(/[=(]?([QRBNqrbn])[)]?$/);
  if (promoMatch) {
    promotion = promoMatch[1].toLowerCase();
    s = s.slice(0, promoMatch.index);
  }

  // 3. Check for En Passant notation
  let isEnPassant = false;
  if (/e\.?p\.?/i.test(s)) {
    isEnPassant = true;
    s = s.replace(/[-(]?e\.?p\.?[)]?/gi, "");
  }

  // 4. Extract from and to squares cleanly
  const sqMatch = s.match(/([a-h][1-8])[x\-–—]?([a-h][1-8])/i);
  if (!sqMatch) return null;

  const from = sqMatch[1].toLowerCase();
  const to = sqMatch[2].toLowerCase();
  const piece = board[from];

  // 5. Detect castling if King moves two squares (e1-g1, e1-c1, e8-g8, e8-c8)
  if (piece && piece.type === "k") {
    if (from === "e1" && to === "g1") {
      return {
        from, to, pieceType: "k", pieceColor: color,
        isEnPassant: false, epSquare: null, isCastle: "K",
        rookFrom: "h1", rookTo: "f1", promotion: null, notationOverride: "O-O"
      };
    }
    if (from === "e1" && to === "c1") {
      return {
        from, to, pieceType: "k", pieceColor: color,
        isEnPassant: false, epSquare: null, isCastle: "Q",
        rookFrom: "a1", rookTo: "d1", promotion: null, notationOverride: "O-O-O"
      };
    }
    if (from === "e8" && to === "g8") {
      return {
        from, to, pieceType: "k", pieceColor: color,
        isEnPassant: false, epSquare: null, isCastle: "K",
        rookFrom: "h8", rookTo: "f8", promotion: null, notationOverride: "O-O"
      };
    }
    if (from === "e8" && to === "c8") {
      return {
        from, to, pieceType: "k", pieceColor: color,
        isEnPassant: false, epSquare: null, isCastle: "Q",
        rookFrom: "a8", rookTo: "d8", promotion: null, notationOverride: "O-O-O"
      };
    }
  }

  return {
    from,
    to,
    pieceType: piece ? piece.type : "p",
    pieceColor: color,
    isEnPassant,
    epSquare: isEnPassant ? to[0] + from[1] : null,
    isCastle: null,
    rookFrom: null,
    rookTo: null,
    promotion,
    notationOverride: raw,
  };
}

function loadGameMoves(movesRows, strtPos) {
  const board = initialBoard(strtPos);
  const plies = [];
  const annotations = {};

  (movesRows || []).forEach((row, idx) => {
    const moveNo = row.MoveNo ? Number(row.MoveNo) : Math.floor(plies.length / 2) + 1;

    if (row.Wh && row.Wh.trim() !== "...") {
      const ply = parseMove(row.Wh, board, "w");
      if (ply) {
        applyPly(board, ply, [], []);
        plies.push(ply);
      }
    }
    if (row.Bl && row.Bl.trim() !== "...") {
      const ply = parseMove(row.Bl, board, "b");
      if (ply) {
        applyPly(board, ply, [], []);
        plies.push(ply);
      }
    }

    const prev = annotations[moveNo] || { annot: "", adAnnot: "" };
    const newAnnot = (row.Annot || "").trim();
    const newAdAnnot = (row.AdAnnot || "").trim();

    annotations[moveNo] = {
      annot: prev.annot ? (newAnnot ? prev.annot + "\n" + newAnnot : prev.annot) : newAnnot,
      adAnnot: prev.adAnnot ? (newAdAnnot ? prev.adAnnot + "\n" + newAdAnnot : prev.adAnnot) : newAdAnnot,
    };
  });

  return { plies, annotations };
}

function buildRows(plies, annotations) {
  const rows = [];
  for (let i = 0; i < plies.length; i += 2) {
    const moveNo = i / 2 + 1;
    const a = annotations[moveNo] || {};
    rows.push({
      moveNo,
      wh: plies[i] ? notate(plies[i]) : "",
      bl: plies[i + 1] ? notate(plies[i + 1]) : "",
      annot: a.annot || "",
      adAnnot: a.adAnnot || "",
      whIndex: i + 1,
      blIndex: i + 2,
      blPlayed: !!plies[i + 1],
    });
  }
  return rows;
}


/* ---------------------------------------------------------------------- */
/* Component                                                               */
/* ---------------------------------------------------------------------- */

export default function ChessLedger() {
  const [aiColor, setAiColor] = useState("b"); // 'w' = computer plays first, 'b' = user plays first
  const [plies, setPlies] = useState([]);
  const [plyIndex, setPlyIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [annotations, setAnnotations] = useState({});
  const [dragSq, setDragSq] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  // library / playback
  const [mode, setMode] = useState("freeplay"); // 'freeplay' | 'library'
  const [library, setLibrary] = useState(seedGames);
  const [activeGame, setActiveGame] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  // Custom free-play starting position (board editor), used whenever mode
  // is "freeplay" and no library game is active.
  const [customStrtPos, setCustomStrtPos] = useState("");
  const [customStartColor, setCustomStartColor] = useState("w");

  // Position-setup editor state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSquares, setSetupSquares] = useState({});
  const [setupTool, setSetupTool] = useState({ type: "p", color: "w" }); // null = eraser
  const [setupTurn, setSetupTurn] = useState("w");
  const [setupDragSq, setSetupDragSq] = useState(null);
  const [setupError, setSetupError] = useState("");

  const [gameMeta, setGameMeta] = useState({
    id: 1,
    gName: "Untitled game",
    pauseFor: DEFAULT_PAUSE_MS,
    remind: "",
  });

  const [running, setRunning] = useState(false);
  const [loop, setLoop] = useState(false);
  const [blink, setBlink] = useState(true);
  const [showCountdown, setShowCountdown] = useState(false);
  const [msRemaining, setMsRemaining] = useState(0);
  const [fastN, setFastN] = useState(5);
  const [flash, setFlash] = useState(null);

  const taRef = useRef(null);
  const pliesRef = useRef(plies);
  const plyIndexRef = useRef(plyIndex);
  const loopRef = useRef(loop);
  const blinkRef = useRef(blink);
  const loopCountRef = useRef(0);
  const flashTimeoutRef = useRef(null);
  const [vsComputer, setVsComputer] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => { pliesRef.current = plies; }, [plies]);
  useEffect(() => { plyIndexRef.current = plyIndex; }, [plyIndex]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { blinkRef.current = blink; }, [blink]);

  const activeStrtPos = activeGame ? activeGame.chsGm.StrtPos : customStrtPos;
  const activeStartColor = activeGame ? "w" : customStartColor;

  const { board, capturedWhite, capturedBlack, turn } = useMemo(
    () => replay(plies, plyIndex, activeStrtPos, activeStartColor),
    [plies, plyIndex, activeStrtPos, activeStartColor]
  );

  // FEN for the *starting* position (before any plies), used to seed
  // chess.js so check/checkmate detection and the AI opponent work
  // correctly from a custom setup, not just the standard start.
  const activeInitialFEN = useMemo(
    () => boardToFEN(initialBoard(activeStrtPos), activeStartColor),
    [activeStrtPos, activeStartColor]
  );

  const epTarget = useMemo(() => enPassantTarget(plies, plyIndex), [plies, plyIndex]);
  const rows = useMemo(() => buildRows(plies, annotations), [plies, annotations]);
  const currentMoveNo = plyIndex > 0 ? Math.ceil(plyIndex / 2) : null;
  const currentAdAnnot = currentMoveNo ? annotations[currentMoveNo]?.adAnnot : null;
  const currentAnnot = currentMoveNo ? annotations[currentMoveNo]?.annot : null;
  // Auto-scroll scoresheet to keep active move visible as playback advances
  useEffect(() => {
    if (!currentMoveNo) return;
    const activeRowEl = document.querySelector(`.scoresheet-row[data-moveno="${currentMoveNo}"]`);
    if (activeRowEl) {
      activeRowEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [plyIndex, currentMoveNo]);

  const atEnd = plyIndex === plies.length;
  const atStart = plyIndex === 0;
  // const pauseForActive = activeGame ? activeGame.chsGm.PauseFor : gameMeta.pauseFor || DEFAULT_PAUSE_MS;
  const pauseForActive = Math.min(25555, Math.max(1234, Number(gameMeta.pauseFor) || 1234));
  function getPathSquares(from, to) {
    if (!from || !to) return [];
    const f1 = FILES.indexOf(from[0]), r1 = parseInt(from[1], 10);
    const f2 = FILES.indexOf(to[0]), r2 = parseInt(to[1], 10);
    const df = Math.sign(f2 - f1);
    const dr = Math.sign(r2 - r1);

    // Only linear routes (Rook, Bishop, Queen, 2-square pawn pushes) have intermediate squares
    const isDiagonal = Math.abs(f2 - f1) === Math.abs(r2 - r1);
    const isStraight = f1 === f2 || r1 === r2;
    if (!isDiagonal && !isStraight) return [];

    const path = [];
    let currF = f1 + df;
    let currR = r1 + dr;
    while (currF !== f2 || currR !== r2) {
      path.push(FILES[currF] + currR);
      currF += df;
      currR += dr;
    }
    return path;
  } function flashMove(ply) {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);

    const fromSquares = [ply.from, ply.rookFrom].filter(Boolean);
    const toSquares = [ply.to, ply.rookTo, ply.epSquare].filter(Boolean);

    // Collect path squares for both the moving piece and any castling rook
    const pathSquares = [
      ...getPathSquares(ply.from, ply.to),
      ...getPathSquares(ply.rookFrom, ply.rookTo)
    ];

    setFlash({ fromSquares, toSquares, pathSquares, id: Math.random() });
    // Intentionally no auto-clear timeout: the from/to highlight is meant to
    // persist (at reduced, "settled" opacity once its entry animation ends)
    // until the *next* move overwrites it, so it's always visible which
    // square a piece last moved from/to while play is paused.
  }




  // Trigger Computer move when it is the computer's turn
  useEffect(() => {
    if (!vsComputer || mode !== "freeplay" || turn !== aiColor || !atEnd || running) return;

    setIsThinking(true);
    const timer = setTimeout(() => {

      const game = makeChessFromFEN(activeInitialFEN);
      for (const p of plies.slice(0, plyIndex)) {
        try {
          game.move({
            from: p.from,
            to: p.to,
            promotion: p.promotion || undefined,
          });
        } catch (err) {
          // Gracefully ignore any irregular move without crashing
          console.warn("Skipping non-standard move:", p);
        }
      }

      if (game.isGameOver()) {
        setIsThinking(false);
        return;
      }

      // White maximizes (+), Black minimizes (-)
      const isMaximizing = aiColor === "w";
      const { move: best } = minimaxChess(game, 3, -Infinity, Infinity, isMaximizing);

      if (best) {
        const isCastle = best.san === "O-O" ? "K" : best.san === "O-O-O" ? "Q" : null;
        const rank = aiColor === "w" ? "1" : "8";
        const ply = {
          from: best.from,
          to: best.to,
          pieceType: best.piece,
          pieceColor: aiColor,
          captured: best.captured ? { type: best.captured, color: aiColor === "w" ? "b" : "w" } : null,
          isEnPassant: best.flags.includes("e"),
          epSquare: best.flags.includes("e") ? best.to[0] + best.from[1] : null,
          isCastle,
          rookFrom: isCastle ? (isCastle === "K" ? "h" + rank : "a" + rank) : null,
          rookTo: isCastle ? (isCastle === "K" ? "f" + rank : "d" + rank) : null,
          promotion: best.promotion || null,
          notationOverride: best.san,
        };

        // finalize() now handles flashing the move itself, so no need to
        // call flashMove() separately here.
        finalize(ply);
      }
      setIsThinking(false);
    }, 550);

    return () => clearTimeout(timer);
  }, [vsComputer, mode, turn, atEnd, running, plies, aiColor, activeInitialFEN]);


  // Automatically evaluate Check, Checkmate, and Draw status (all chess.js versions)
  const gameStatus = useMemo(() => {
    const game = makeChessFromFEN(activeInitialFEN);
    for (const p of plies.slice(0, plyIndex)) {
      try {
        game.move({ from: p.from, to: p.to, promotion: p.promotion || undefined });
      } catch (_) { }
    }

    // Compatibility check for chess.js v0.x and v1.x
    const isMate = typeof game.isCheckmate === "function" ? game.isCheckmate() : game.in_checkmate?.();
    const isDraw = typeof game.isDraw === "function" ? game.isDraw() : game.in_draw?.();
    const isCheck = typeof game.inCheck === "function" ? game.inCheck() : game.in_check?.();

    if (isMate) {
      const winner = game.turn() === "w" ? "Black" : "White";
      return { type: "checkmate", text: `🏆 Checkmate! ${winner} wins`, isOver: true, checkedColor: game.turn() };
    }
    if (isDraw) {
      return { type: "draw", text: "🤝 Draw / Stalemate", isOver: true };
    }
    if (isCheck) {
      const checkedColor = game.turn() === "w" ? "White" : "Black";
      return { type: "check", text: `⚠️ ${checkedColor} is in Check!`, isOver: false, checkedColor: game.turn() };
    }
    return null;
  }, [plies, plyIndex, activeInitialFEN]);

  function advanceTick() {
    const curPlies = pliesRef.current;
    const curIndex = plyIndexRef.current;
    if (curIndex < curPlies.length) {
      const ply = curPlies[curIndex];
      if (blinkRef.current) flashMove(ply);
      setPlyIndex(curIndex + 1);
    } else if (loopRef.current && loopCountRef.current < MAX_LOOPS) {
      loopCountRef.current += 1;
      setPlyIndex(0);
    } else {
      loopCountRef.current = 0;
      setRunning(false);
    }
  }

  /* Timer: a single fine-grained interval drives both the move-advance
     tick (every pauseForActive ms) and the optional countdown readout. */
  useEffect(() => {
    if (!running) return;
    const stepMs = 100;
    let remaining = pauseForActive;
    setMsRemaining(remaining);
    const id = setInterval(() => {
      remaining -= stepMs;
      if (remaining <= 0) {
        advanceTick();
        remaining = pauseForActive;
      }
      setMsRemaining(remaining);
    }, stepMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, pauseForActive]);

  useEffect(() => () => flashTimeoutRef.current && clearTimeout(flashTimeoutRef.current), []);

  /* --------------------------- move making (freeplay) ------------------ */

  function tryMove(fromSq, toSq) {
    if (fromSq === toSq) {
      setSelected(null);
      return;
    }
    const piece = board[fromSq];
    if (!piece || piece.color !== turn) {
      setSelected(null);
      return;
    }

    // --- Safety Check: Validate move with chess.js in vsComputer mode ---
    if (vsComputer) {
      const testGame = makeChessFromFEN(activeInitialFEN);
      for (const p of plies.slice(0, plyIndex)) {
        try {
          testGame.move({ from: p.from, to: p.to, promotion: p.promotion || undefined });
        } catch (_) { }
      }

      // Check if this move is legal in standard chess
      try {
        const testMove = testGame.move({ from: fromSq, to: toSq, promotion: "q" });
        if (!testMove) {
          setSelected(null);
          return; // Block illegal move
        }
      } catch (err) {
        setSelected(null);
        return; // Block illegal move
      }
    }
    // -------------------------------------------------------------------

    const targetPiece = board[toSq];
    if (targetPiece && targetPiece.color === piece.color) {
      setSelected(toSq);
      return;
    }

    let isEnPassant = false;
    let epSquare = null;
    if (piece.type === "p" && fromSq[0] !== toSq[0] && !targetPiece && toSq === epTarget) {
      isEnPassant = true;
      epSquare = toSq[0] + fromSq[1];
    }

    let isCastle = null;
    let rookFrom = null;
    let rookTo = null;
    if (
      piece.type === "k" &&
      rankOf(fromSq) === rankOf(toSq) &&
      Math.abs(fileIdx(fromSq) - fileIdx(toSq)) === 2
    ) {
      isCastle = fileIdx(toSq) > fileIdx(fromSq) ? "K" : "Q";
      const r = fromSq[1];
      rookFrom = isCastle === "K" ? "h" + r : "a" + r;
      rookTo = isCastle === "K" ? "f" + r : "d" + r;
    }

    const base = {
      from: fromSq,
      to: toSq,
      pieceType: piece.type,
      pieceColor: piece.color,
      captured: targetPiece || null,
      isEnPassant,
      epSquare,
      isCastle,
      rookFrom,
      rookTo,
    };

    if (piece.type === "p" && (toSq[1] === "8" || toSq[1] === "1")) {
      setPendingMove(base);
      setSelected(null);
      return;
    }
    finalize({ ...base, promotion: null });
  }

  function finalize(ply) {
    const next = plies.slice(0, plyIndex);
    next.push(ply);

    // Highlight the from/to squares for *every* finalized move (manual
    // clicks/drags, promotions, and computer moves alike) so the last move
    // is always visibly marked, not just during computer play or library
    // playback. (flashMove() itself no longer auto-clears — see there.)
    if (blinkRef.current) flashMove(ply);

    // Update the board state *immediately* and synchronously so the piece
    // appears to have moved with zero delay. Commentary generation involves
    // a network round-trip (see chessCommentator.js) and used to be awaited
    // before any of this ran, which is what caused the visible ~hundreds-of-ms
    // lag between making a move and seeing it reflected on the board.
    setPlies(next);
    setPlyIndex(next.length);
    setSelected(null);
    setPendingMove(null);

    const moveNo = Math.ceil(next.length / 2);
    const isWhite = ply.pieceColor === "w";

    // Generate real-time tactical commentary for this specific move in the
    // background; the board has already moved on, so this only affects when
    // the annotation text underneath the board fills in.
    generateAICommentary(next, ply, activeInitialFEN)
      .then((comment) => {
        // Format with a clear prefix (e.g., "1. e4: ..." or "1... c5: ...")
        const movePrefix = isWhite ? `${moveNo}. ` : `${moveNo}... `;
        const formattedComment = `${movePrefix}${comment}`;

        setAnnotations((prev) => {
          const existing = prev[moveNo] || { annot: "", adAnnot: "" };
          let combinedAdAnnot = "";

          if (isWhite) {
            // White starts the move pair
            combinedAdAnnot = formattedComment;
          } else {
            // Black completes the pair: preserve White's comment and append Black's below it
            combinedAdAnnot = existing.adAnnot
              ? `${existing.adAnnot}\n${formattedComment}`
              : formattedComment;
          }

          return {
            ...prev,
            [moveNo]: {
              ...existing,
              adAnnot: combinedAdAnnot,
            },
          };
        });
      })
      .catch((err) => {
        console.warn("Commentary generation failed:", err);
      });
  }

  function pickSquare(sq) {
    if (mode !== "freeplay" || pendingMove) return;
    if (selected) {
      tryMove(selected, sq);
      return;
    }
    const piece = board[sq];
    if (piece && piece.color === turn) setSelected(sq);
  }

  function onDrop(sq) {
    if (mode === "freeplay" && !pendingMove && dragSq) tryMove(dragSq, sq);
    setDragSq(null);
  }

  /* --------------------------- transport controls ----------------------- */

  function newGame() {
    setRunning(false);
    setMode("freeplay");
    setActiveGame(null);
    setPlies([]);
    setPlyIndex(0);
    setSelected(null);
    setPendingMove(null);
    setAnnotations({});
    setCustomStrtPos("");
    setCustomStartColor("w");
  }

  /* --------------------------- position setup / board editor ------------ */

  function openSetup() {
    // Seed the editor with the current freeplay board if there is one in
    // progress, otherwise the standard starting arrangement.
    const seed = mode === "freeplay" ? { ...board } : initialBoard("");
    setSetupSquares(seed);
    setSetupTurn(mode === "freeplay" ? turn : "w");
    setSetupTool({ type: "p", color: "w" });
    setSetupError("");
    setSetupOpen(true);
  }

  function setupPlaceOrClear(sq) {
    setSetupSquares((prev) => {
      const next = { ...prev };
      if (!setupTool) {
        delete next[sq];
      } else {
        next[sq] = { type: setupTool.type, color: setupTool.color };
      }
      return next;
    });
    setSetupError("");
  }

  function setupOnDrop(sq) {
    if (setupDragSq) {
      setSetupSquares((prev) => {
        if (setupDragSq === sq || !prev[setupDragSq]) return prev;
        const next = { ...prev };
        next[sq] = next[setupDragSq];
        delete next[setupDragSq];
        return next;
      });
      setSetupDragSq(null);
      setSetupError("");
      return;
    }
    setupPlaceOrClear(sq);
  }

  function setupClearBoard() {
    setSetupSquares({});
    setSetupError("");
  }

  function setupStandardBoard() {
    setSetupSquares(initialBoard(""));
    setSetupError("");
  }

  function startFromSetup() {
    const entries = Object.entries(setupSquares);
    const hasWK = entries.some(([, p]) => p.type === "k" && p.color === "w");
    const hasBK = entries.some(([, p]) => p.type === "k" && p.color === "b");
    if (!hasWK || !hasBK) {
      setSetupError("Both a white king and a black king are required.");
      return;
    }

    const strtPos = entries.map(([sq, p]) => `${sq}=${p.color}${p.type}`).join(",");

    setRunning(false);
    setMode("freeplay");
    setActiveGame(null);
    setPlies([]);
    setPlyIndex(0);
    setSelected(null);
    setPendingMove(null);
    setAnnotations({});
    setCustomStrtPos(strtPos);
    setCustomStartColor(setupTurn);
    setSetupOpen(false);
    setSetupError("");
  }

  function loadGame(game) {
    const { plies: loadedPlies, annotations: loadedAnnot } = loadGameMoves(game.moves, game.chsGm.StrtPos);
    setRunning(false);
    setMode("library");
    setActiveGame(game);
    setPlies(loadedPlies);
    setPlyIndex(0);
    setSelected(null);
    setPendingMove(null);
    setAnnotations(loadedAnnot);
    setGameMeta({
      id: game.chsGm.Id,
      gName: game.chsGm.GName,
      pauseFor: Math.min(25555, Math.max(1234, Number(game.chsGm.PauseFor) || 2222)),
      remind: game.chsGm.Remind,
    });
    setLibraryOpen(false);
    loopCountRef.current = 0;
  }

  function handleRun() {
    setPlyIndex(0);
    loopCountRef.current = 0;
    setSelected(null);
    setRunning(true);
  }
  function handlePauseResume() {
    setRunning((r) => !r);
  }
  function handleStop() {
    setRunning(false);
    loopCountRef.current = 0;
    setPlyIndex(0);
  }
  function handleResetBoard() {
    setRunning(false);
    setPlyIndex(0);
    setSelected(null);
  }
  function undo() {
    if (plyIndex > 0) setPlyIndex(plyIndex - 1);
    setSelected(null);
  }
  function forward() {
    if (plyIndex < plies.length) setPlyIndex(plyIndex + 1);
    setSelected(null);
  }
  function jumpTo(n) {
    setRunning(false);
    setPlyIndex(Math.max(0, Math.min(plies.length, n)));
    setSelected(null);
  }
  function undoLast() {
    if (mode !== "freeplay" || plies.length === 0) return;
    // If playing against Computer and it's our turn, take back 2 moves (Computer's + ours)
    const stepsToUndo = vsComputer && plies.length >= 2 ? 2 : 1;
    const next = plies.slice(0, Math.max(0, plyIndex - stepsToUndo));
    setPlies(next);
    setPlyIndex(next.length);
    setSelected(null);
  }

  function fastForward() {
    setRunning(false);
    const n = Math.max(1, Number(fastN) || 1);
    setPlyIndex(Math.min(plies.length, plyIndex + n));
    setSelected(null);
  }

  function setAnnot(moveNo, value) {
    setAnnotations((prev) => ({ ...prev, [moveNo]: { ...prev[moveNo], annot: value } }));
  }

  /* --------------------------- import / export --------------------------- */

  function exportPayload() {
    return {
      chsGm: {
        Id: gameMeta.id,
        GName: gameMeta.gName,
        PauseFor: gameMeta.pauseFor,
        StrtPos: activeGame ? activeGame.chsGm.StrtPos : "",
        Remind: gameMeta.remind,
      },
      moves: rows.map((r) => ({
        Id: gameMeta.id,
        MoveNo: String(r.moveNo),
        Wh: r.wh,
        Bl: r.bl,
        ChsBkdPrt: "",
        Annot: r.annot,
        AdAnnot: r.adAnnot,
        RtfAnnot: "",
      })),
    };
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gameMeta.gName.replace(/\s+/g, "_").slice(0, 40) || "game"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importGame() {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.chsGm || !Array.isArray(parsed.moves)) {
        throw new Error("Expected an object with chsGm and moves[]");
      }
      setLibrary((prev) => [...prev, parsed]);
      setImportText("");
      setImportError("");
    } catch (e) {
      setImportError(e.message || "Could not parse JSON");
    }
  }


  /* --------------------------- Game Downloaders --------------------------- */

  function getGameResult() {
    if (gameStatus?.type === "checkmate") {
      return gameStatus.text.includes("White") ? "1-0" : "0-1";
    }
    if (gameStatus?.type === "draw") return "1/2-1/2";
    return "*";
  }

  // 1. Download Standard PGN (Compatible with Chess.com, Lichess, etc.)
  function downloadPGN() {
    if (plies.length === 0) return;
    const result = getGameResult();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    const whitePlayer = vsComputer && aiColor === "w" ? "Computer (1400)" : "Human";
    const blackPlayer = vsComputer && aiColor === "b" ? "Computer (1400)" : "Human";

    let pgn = `[Event "Chess Ledger Game"]\n`;
    pgn += `[Site "Chess Ledger"]\n`;
    pgn += `[Date "${date}"]\n`;
    pgn += `[White "${whitePlayer}"]\n`;
    pgn += `[Black "${blackPlayer}"]\n`;
    pgn += `[Result "${result}"]\n\n`;

    rows.forEach((r) => {
      pgn += `${r.moveNo}. ${r.wh} ${r.bl} `;
    });
    pgn += `${result}\n`;

    const blob = new Blob([pgn], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Game_${whitePlayer}_vs_${blackPlayer}_${date}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 2. Download App JSON (Can be re-imported into this app library)
  function downloadCurrentGameJSON() {
    if (plies.length === 0) return;
    const whitePlayer = vsComputer && aiColor === "w" ? "Computer" : "Human";
    const blackPlayer = vsComputer && aiColor === "b" ? "Computer" : "Human";
    const autoTitle = `${whitePlayer} vs ${blackPlayer} (${new Date().toLocaleDateString()})`;

    const payload = {
      chsGm: {
        Id: Date.now(),
        GName: autoTitle,
        PauseFor: gameMeta.pauseFor || 750,
        StrtPos: activeStrtPos || "",
        Remind: `Played vs Computer`,
      },
      moves: rows.map((r) => ({
        Id: Date.now(),
        MoveNo: String(r.moveNo),
        Wh: r.wh,
        Bl: r.bl,
        ChsBkdPrt: "",
        Annot: r.annot || "",
        AdAnnot: r.adAnnot || "",
        RtfAnnot: "",
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${autoTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  /* --------------------------------- UI ---------------------------------- */

  const countdownSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const nextMover = turn === "w" ? "White" : "Black";

  return (
    <div className="ledger-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        .ledger-root {
          --paper: #efe7d8;
          --paper-dim: #e4d8c1;
          --ink: #2a2724;
          --ink-soft: #6b6459;
          --walnut: #6b5842;
          --walnut-dark: #4a3b2a;
          --light-sq: #ae9e79;
          --dark-sq: #7c6448;
          --oxblood: #7a2e2e;
          --felt: #3f5d4e;
          --gold: #b08d57;
          background: var(--paper);
          color: var(--ink);
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          min-height: 100%;
          padding: 28px 20px 40px;
        }
        .ledger-title {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 700;
          font-size: 30px;
          letter-spacing: -0.01em;
        }
        .ledger-sub { color: var(--ink-soft); font-size: 13px; letter-spacing: 0.03em; }
        .ledger-layout { display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start; margin-top: 22px; }
        .board-col {
          position: sticky;
          top: 20px;
          align-self: flex-start;
          z-index: 5;
        }
        .board-wrap { background: var(--walnut-dark); padding: 16px; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
        .board-grid { display: grid; grid-template-columns: repeat(8, 52px); grid-template-rows: repeat(8, 52px); border: 3px solid var(--walnut); }
        .board-square { position: relative; display: flex; align-items: center; justify-content: center; font-size: 34px; user-select: none; cursor: pointer; line-height: 1; }
        .board-square.light { background: var(--light-sq); }
        .board-square.dark { background: var(--dark-sq); }
        .board-square.selected { outline: 3px solid var(--gold); outline-offset: -3px; }

.board-square.flash-path { 
  animation: slowFadePath 1500ms ease-out forwards; 
}        
.board-square.flash-from { 
  animation: slowFadeFrom 1500ms ease-out forwards; 
}
.board-square.flash-to { 
  animation: slowFadeTo 3500ms ease-out forwards; 
}


        .board-square.flash { animation: flashPulse ${FLASH_MS}ms ease; }

        .floating-thinking-badge {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--walnut-dark);
  color: #fbf8f2;
  border: 2px solid var(--gold);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  animation: slideDownFade 0.25s ease-out;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 999px;
  animation: pulseBadge 1.2s infinite ease-in-out;
}
.status-pill.check {
  background: #fff2f0;
  color: var(--oxblood);
  border: 1px solid var(--oxblood);
}
.status-pill.checkmate {
  background: var(--oxblood);
  color: #fff;
  border: 1px solid var(--oxblood);
}
.status-pill.draw {
  background: var(--walnut-dark);
  color: var(--paper);
  border: 1px solid var(--walnut);
}

.board-status-alert {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 700;
  font-size: 14px;
  text-align: center;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: slideInDown 0.3s ease-out;
}
.board-status-alert.check {
  background: #ff4d4f;
  color: #fff;
  border: 1px solid #d9363e;
}
.board-status-alert.checkmate {
  background: var(--oxblood);
  color: #fff;
  border: 1px solid #4a1515;
  font-size: 15px;
}
.board-status-alert.draw {
  background: var(--walnut-dark);
  color: var(--paper);
  border: 1px solid var(--walnut);
}

@keyframes slideInDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes pulseBadge {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

@keyframes slideDownFade {
  from {
    opacity: 0;
    transform: translate(-50%, -14px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
/* 3. Trajectory / Path square color — this one is just a transient trail,
   so it's fine for it to fade all the way out. */
@keyframes slowFadePath {
  0%   { box-shadow: inset 0 0 0 999px rgba(180, 160, 220, 0.65); }  /* change path color here */
  25%  { box-shadow: inset 0 0 0 999px rgba(180, 160, 220, 0.45); }  /* change path color here */
  100% { box-shadow: inset 0 0 0 999px rgba(180, 160, 220, 0); }
}        

/* 1. Departure square color — settles to a persistent tint (does NOT fade
   to 0) so the last move's origin square stays identifiable until the
   next move overwrites it. */
@keyframes slowFadeFrom {
  0%   { box-shadow: inset 0 0 0 999px rgba(41, 188, 36, 0.9); }
  25%  { box-shadow: inset 0 0 0 999px rgba(255, 233, 110, 0.75); }
  100% { box-shadow: inset 0 0 0 999px rgba(223, 31, 14, 0.38); }
}

/* 2. Destination / Settled square color — likewise settles to a persistent
   tint instead of fading out completely. */
@keyframes slowFadeTo {
  0%   { box-shadow: inset 0 0 0 999px rgba(80, 140, 90, 0.9); }   /* change color here */
  25%  { box-shadow: inset 0 0 0 999px rgba(80, 140, 90, 0.75); }  /* change color here */
  100% { box-shadow: inset 0 0 0 999px rgba(80, 140, 90, 0.45); }
}



@keyframes pulseTo {
  0%   { box-shadow: inset 0 0 0 999px rgba(176, 141, 87, 0.8); }
  100% { box-shadow: inset 0 0 0 999px rgba(176, 141, 87, 0); }
}        
        
        @keyframes flashPulse {
          0% { box-shadow: inset 0 0 0 999px rgba(176,141,87,0); }
          25% { box-shadow: inset 0 0 0 999px rgba(176,141,87,0.85); }
          100% { box-shadow: inset 0 0 0 999px rgba(176,141,87,0); }
        }
        .piece-disc {
          width: 82%;
          height: 82%;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .piece-disc.white-disc {
          background: radial-gradient(circle, rgba(42,39,36,0.6) 0%, rgba(42,39,36,0.3) 55%, rgba(42,39,36,0.4) 76%);
        }
        .piece-disc.black-disc {
          background: radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.24) 55%, rgba(255,255,255,0) 76%);
        }
        .board-square .white-piece {
          color: #fbf8f2;
          text-shadow: 0 1px 2px rgba(0,0,0,0.55);
        }
        .board-square .black-piece {
          color: #201c18;
          text-shadow: 0 1px 1px rgba(255,255,255,0.25);
        }
        .coord-file, .coord-rank { font-size: 10px; color: var(--paper-dim); position: absolute; opacity: 0.7; }
        .coord-file { bottom: 2px; right: 4px; }
        .coord-rank { top: 2px; left: 4px; }
        .captured-rail { min-height: 26px; display: flex; gap: 4px; padding: 4px 2px; font-size: 20px; color: var(--ink-soft); }
        .ad-annot-banner {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-weight: 600;
          font-size: 17px;
          line-height: 1.35;
          color: var(--ink);
          background: var(--paper-dim);
          border: 1px solid var(--walnut);
          border-left: 4px solid var(--oxblood);
          border-radius: 3px;
          padding: 8px 14px;
          margin-bottom: 8px;
          max-width: 416px;
 height: 78px;        
  overflow-y: auto;
  white-space: pre-wrap;          
        }
        .side-panel { flex: 1; min-width: 340px; }
        .pill-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .turn-pill, .mode-pill { display: inline-flex; align-items: center; gap: 8px; background: var(--paper-dim); border: 1px solid var(--walnut); border-radius: 999px; padding: 6px 14px; font-size: 12px; }
        .mode-pill.library { background: var(--felt); color: var(--paper); border-color: var(--felt); }
        .dot { width: 9px; height: 9px; border-radius: 999px; border: 1px solid var(--ink); }
        .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); margin: 16px 0 6px; }
        .btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
        .btn { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: var(--paper); border: 1px solid var(--walnut); color: var(--ink); padding: 7px 12px; border-radius: 3px; cursor: pointer; }
        .btn:hover { background: var(--paper-dim); }
        .btn:disabled { opacity: 0.4; cursor: default; }
        .btn.primary { background: var(--oxblood); border-color: var(--oxblood); color: #f7f0e8; }
        .btn.active { background: var(--felt); border-color: var(--felt); color: #f7f0e8; }
        .check-row { display: flex; gap: 16px; align-items: center; font-size: 12px; color: var(--ink-soft); flex-wrap: wrap; }
        .check-row label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
        .countdown { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--oxblood); min-width: 74px; }
        .meta-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
        .meta-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--ink-soft); }
        .meta-field input { font-family: 'JetBrains Mono', monospace; background: var(--paper); border: 1px solid var(--walnut); border-radius: 3px; padding: 5px 7px; color: var(--ink); font-size: 12px; }
        .scoresheet { border: 1px solid var(--walnut); border-radius: 4px; overflow: hidden; background: var(--paper); margin-top: 6px; }
        .scoresheet-head { display: grid; grid-template-columns: 40px 1fr 1fr 1.4fr; background: var(--walnut); color: var(--paper); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
        .scoresheet-head div { padding: 7px 8px; }
        .scoresheet-body { max-height: min(58vh, 560px); overflow-y: auto; overscroll-behavior: contain; }
        .scoresheet-row { display: grid; grid-template-columns: 40px 1fr 1fr 1.4fr; border-top: 1px solid var(--paper-dim); font-size: 13px; }
        .scoresheet-row div { padding: 6px 8px; display: flex; align-items: center; }
        .scoresheet-row .mv-no { color: var(--ink-soft); font-family: 'Fraunces', serif; }
        .mv-cell { cursor: pointer; border-radius: 2px; }
        .mv-cell:hover { background: var(--paper-dim); }
        .mv-cell.active { background: var(--gold); color: var(--ink); font-weight: 600; }
        .mv-cell.captured-move { color: var(--oxblood); }
        .adannot-row { grid-column: 1 / -1; padding: 0 8px 8px 48px !important; font-size: 11px; font-style: italic; color: var(--ink-soft); }
        .annot-input { width: 100%; border: none; background: transparent; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-soft); outline: none;   resize: none;        
  overflow-y: auto;    
  line-height: 18px;  }
        .caption { font-size: 11px; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }
        .modal-backdrop { position: fixed; inset: 0; background: rgba(20,16,12,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .modal { background: var(--paper); border: 1px solid var(--walnut); border-radius: 6px; padding: 22px; min-width: 260px; max-width: 90vw; }
        .modal h3 { font-family: 'Fraunces', serif; margin: 0 0 14px; }
        .promo-choices { display: flex; gap: 8px; }
        .promo-choices button { flex: 1; font-size: 26px; padding: 10px 0; background: var(--paper-dim); border: 1px solid var(--walnut); border-radius: 4px; cursor: pointer; }
        .promo-choices button:hover { background: var(--gold); }
        textarea.export-area, textarea.import-area { width: 100%; height: 220px; font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 10px; border: 1px solid var(--walnut); border-radius: 4px; background: #fbf8f2; color: var(--ink); }
        .library-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--walnut); border-radius: 4px; margin-bottom: 14px; }
        .library-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--paper-dim); }
        .library-row:first-child { border-top: none; }
        .library-row-title { font-size: 13px; }
        .library-row-meta { font-size: 11px; color: var(--ink-soft); }
        .import-error { color: var(--oxblood); font-size: 11px; margin-top: 6px; }
        .setup-modal { min-width: 460px; }
        .setup-layout { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
        .setup-board-grid { display: grid; grid-template-columns: repeat(8, 40px); grid-template-rows: repeat(8, 40px); border: 3px solid var(--walnut); }
        .setup-square { position: relative; display: flex; align-items: center; justify-content: center; font-size: 26px; user-select: none; cursor: pointer; line-height: 1; }
        .setup-square.light { background: var(--light-sq); }
        .setup-square.dark { background: var(--dark-sq); }
        .setup-side { min-width: 190px; }
        .setup-palette-row { display: flex; gap: 4px; margin-bottom: 6px; }
        .setup-piece-btn { flex: 1; font-size: 22px; padding: 6px 0; background: var(--paper-dim); border: 1px solid var(--walnut); border-radius: 4px; cursor: pointer; line-height: 1; }
        .setup-piece-btn:hover { background: var(--gold); }
        .setup-piece-btn.active { background: var(--gold); outline: 2px solid var(--walnut-dark); outline-offset: -2px; }
        .setup-eraser-btn { width: 100%; padding: 6px 0; margin-bottom: 12px; background: var(--paper-dim); border: 1px solid var(--walnut); border-radius: 4px; cursor: pointer; font-size: 12px; }
        .setup-eraser-btn.active { background: var(--oxblood); color: #fff; }
        .setup-turn-row { display: flex; gap: 6px; margin: 10px 0; }
        .setup-turn-row .btn.active { background: var(--gold); }
      `}</style>

      <div className="ledger-layout">
        {/* Board */}
        <div className="board-col">
          <div className="ad-annot-banner">
            {currentAdAnnot || currentAnnot || (
              <span style={{ opacity: 0.45, fontStyle: "normal" }}>No annotation for this move</span>
            )}
          </div>
          {/* Sticky Real-Time Check / Checkmate / Draw Alert */}
          {gameStatus && (
            <div className={`board-status-alert ${gameStatus.type}`}>
              {gameStatus.text}
            </div>
          )}


          <div className="captured-rail">
            {capturedBlack.map((p, i) => <span key={i} className="black-piece">{GLYPH.b[p.type]}</span>)}
          </div>
          <div className="board-wrap">
            <div className="board-grid">
              {RANKS.map((r) =>
                FILES.map((f, fi) => {
                  const sq = f + r;
                  const piece = board[sq];
                  const light = (fileIdx(sq) + r) % 2 === 1;

                  // Check if this square is the departure or arrival square
                  const isFrom = flash && flash.fromSquares?.includes(sq);
                  const isTo = flash && flash.toSquares?.includes(sq);
                  const isPath = flash && flash.pathSquares?.includes(sq);

                  return (
                    <div
                      key={sq + (isFrom || isTo || isPath ? flash.id : "")}
                      className={`board-square ${light ? "light" : "dark"} ${selected === sq ? "selected" : ""} ${isFrom ? "flash-from" : ""} ${isTo ? "flash-to" : ""} ${isPath ? "flash-path" : ""}`}
                      onClick={() => pickSquare(sq)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(sq)}
                    >                      {fi === 0 && <span className="coord-rank">{r}</span>}
                      {r === 1 && <span className="coord-file">{f}</span>}
                      {piece && (
                        <div className={`piece-disc ${piece.color === "w" ? "white-disc" : "black-disc"}`}>
                          <span
                            draggable={mode === "freeplay" && atEnd && piece.color === turn && !pendingMove}
                            onDragStart={() => setDragSq(sq)}
                            className={piece.color === "w" ? "white-piece" : "black-piece"}
                          >
                            {GLYPH[piece.color][piece.type]}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="captured-rail">
            {capturedWhite.map((p, i) => <span key={i} className="white-piece" style={{ color: "#4a3b2a" }}>{GLYPH.w[p.type]}</span>)}
          </div>
        </div>

        {/* Side panel */}
        <div className="side-panel">
          <div className="pill-row">
            <span className="turn-pill">
              <span className="dot" style={{ background: turn === "w" ? "#f7f3ea" : "#201c18" }} />
              {gameStatus?.isOver ? "Game Over" : `${nextMover} to move`}
              {!atEnd && <span style={{ color: "var(--oxblood)" }}> · ply {plyIndex}/{plies.length}</span>}
            </span>

            {/* Real-time Check / Checkmate / Draw Status */}
            {gameStatus && (
              <span className={`status-pill ${gameStatus.type}`}>
                {gameStatus.text}
              </span>
            )}

            <span className={`mode-pill ${mode === "library" ? "library" : ""}`}>
              {mode === "library" ? `Library: ${gameMeta.gName.slice(0, 28)}${gameMeta.gName.length > 28 ? "…" : ""} (Id ${gameMeta.id})` : "Free play"}
            </span>


          </div>
          <div className="section-label">Library & Players</div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => setLibraryOpen(true)}>Load…</button>
            <button className="btn" onClick={newGame}>New Game</button>
            <button className="btn" onClick={openSetup}>Set Up Position…</button>
            <button
              className={`btn ${vsComputer ? "active" : ""}`}
              onClick={() => setVsComputer((v) => !v)}
            >
              {vsComputer ? "🤖 vs. Computer (ON)" : "👤 vs. Human"}
            </button>

            {/* Toggle who plays first */}
            {vsComputer && (
              <button
                className="btn"
                onClick={() => {
                  setAiColor((c) => (c === "b" ? "w" : "b"));
                }}
              >
                AI plays: {aiColor === "w" ? "White (First)" : "Black (Second)"}
              </button>
            )}
          </div>
          <div className="btn-row" style={{ alignItems: "center" }}>
            <button
              className="btn primary"
              onClick={downloadPGN}
              disabled={plies.length === 0}
              title="Download as standard PGN to open on Chess.com or Lichess"
            >
              💾 Download PGN
            </button>
            <button
              className="btn"
              onClick={downloadCurrentGameJSON}
              disabled={plies.length === 0}
              title="Download JSON to reload into this app"
            >
              💾 Download JSON
            </button>
            <button className="btn" onClick={() => setExportOpen(true)}>
              Export / View Text
            </button>
          </div>

          <div className="check-row">
            <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
            <label><input type="checkbox" checked={blink} onChange={(e) => setBlink(e.target.checked)} /> Blink</label>
            <label><input type="checkbox" checked={showCountdown} onChange={(e) => setShowCountdown(e.target.checked)} /> Show countdown</label>
            <span>pause: {pauseForActive}ms</span>
          </div>

          <div className="section-label">Game meta</div>
          <div className="meta-row">
            <label className="meta-field">Id
              <input type="number" value={gameMeta.id} onChange={(e) => setGameMeta({ ...gameMeta, id: Number(e.target.value) })} style={{ width: 60 }} disabled={mode === "library"} />
            </label>
            <label className="meta-field">GName
              <input value={gameMeta.gName} onChange={(e) => setGameMeta({ ...gameMeta, gName: e.target.value })} style={{ width: 200 }} disabled={mode === "library"} />
            </label>


            <label className="meta-field">PauseFor (1234-25555 ms)
              <input
                type="number"
                min={1234}
                max={25555}
                value={gameMeta.pauseFor}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setGameMeta((prev) => ({ ...prev, pauseFor: val }));
                  if (activeGame) {
                    setActiveGame((prev) => prev ? { ...prev, chsGm: { ...prev.chsGm, PauseFor: val } } : null);
                  }
                }}
                style={{ width: 100 }}
              />
              <input type="number" value={gameMeta.pauseFor} onChange={(e) => setGameMeta({ ...gameMeta, pauseFor: Number(e.target.value) })} style={{ width: 80 }} disabled={mode === "library"} />
            </label>
          </div>
          <div className="section-label">Playback</div>
          <div className="btn-row">
            <button className="btn" onClick={handleRun} disabled={plies.length === 0}>▶ Run</button>
            <button className="btn" onClick={handlePauseResume} disabled={plies.length === 0}>{running ? "⏸ Pause" : "⏵ Resume"}</button>
            <button className="btn" onClick={handleStop} disabled={plies.length === 0}>■ Stop</button>
            <button className="btn" onClick={handleResetBoard} disabled={plies.length === 0}>⟲ Reset</button>
            {showCountdown && running && (
              <span className="countdown">⏱ {countdownSeconds}s</span>
            )}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={undo} disabled={atStart}>◂ Back</button>
            <button className="btn" onClick={forward} disabled={atEnd}>Forward ▸</button>
            <button
              className="btn"
              onClick={undoLast}
              disabled={mode !== "freeplay" || plies.length === 0}
            >
              ↩ Take Back Move
            </button>            <input
              type="number"
              min={1}
              value={fastN}
              onChange={(e) => setFastN(e.target.value)}
              style={{ width: 46, fontFamily: "inherit", fontSize: 12, border: "1px solid var(--walnut)", borderRadius: 3, padding: "6px 4px" }}
            />
            <button className="btn" onClick={fastForward} disabled={atEnd}>⏩ Fastmove</button>
          </div>
          <div className="btn-row" style={{ alignItems: "center" }}>
            {isThinking && (
              <div className="floating-thinking-badge">
                <span>⏳</span> Computer is thinking…
              </div>
            )}
          </div>

          <div className="scoresheet">
            <div className="scoresheet-head"><div>#</div><div>White</div><div>Black</div><div>Annot</div></div>
            <div className="scoresheet-body">
              {rows.length === 0 && (
                <div className="scoresheet-row"><div className="mv-no">—</div><div /><div /><div style={{ color: "var(--ink-soft)" }}>no moves yet</div></div>
              )}
              {rows.map((r) => (
                <div key={r.moveNo} style={{ display: "contents" }}>
                  <div className="scoresheet-row" data-moveno={r.moveNo}>
                    <div className="mv-no">{r.moveNo}.</div>
                    <div className={`mv-cell ${plyIndex === r.whIndex ? "active" : ""} ${r.wh.includes("x") ? "captured-move" : ""}`} onClick={() => jumpTo(r.whIndex)}>{r.wh}</div>
                    <div className={`mv-cell ${plyIndex === r.blIndex ? "active" : ""} ${r.bl.includes("x") ? "captured-move" : ""}`} onClick={() => r.blPlayed && jumpTo(r.blIndex)}>{r.bl}</div>
                    <div style={{ padding: "4px 8px" }}>
                      <textarea
                        className="annot-input"
                        placeholder="note…"
                        value={annotations[r.moveNo]?.annot || ""}
                        onChange={(e) => setAnnot(r.moveNo, e.target.value)}
                        rows={3}
                        style={{
                          resize: "none",
                          height: "54px",
                          overflowY: "auto",
                          lineHeight: "18px",
                          width: "100%",
                          display: "block",
                        }}
                      />
                    </div>
                  </div>
                  {r.adAnnot && <div className="scoresheet-row" data-moveno={r.moveNo}><div className="adannot-row">{r.adAnnot}</div></div>}
                </div>
              ))}
            </div>
          </div>

          <div className="caption">
            Load pulls a game from the library and stages it at move 0 — press Run to
            auto-play at its PauseFor interval, or step with Back/Forward/Fastmove.
            Loaded games are playback-only (drag/click moves are disabled) to avoid
            silently diverging from the recorded score; use New Game for a free-play
            board you can move pieces on by hand.
          </div>
        </div>
      </div>

      {pendingMove && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Promote to…</h3>
            <div className="promo-choices">
              {PROMO_CHOICES.map((c) => (
                <button key={c.type} title={c.label} onClick={() => finalize({ ...pendingMove, promotion: c.type })}>
                  {GLYPH[pendingMove.pieceColor][c.type]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className="modal-backdrop" onClick={() => setLibraryOpen(false)}>
          <div className="modal" style={{ minWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Game library</h3>
            <div className="library-list">
              {library.map((g) => (
                <div className="library-row" key={g.chsGm.Id}>
                  <div>
                    <div className="library-row-title">{g.chsGm.GName}</div>
                    <div className="library-row-meta">Id {g.chsGm.Id} · pause {g.chsGm.PauseFor}ms · {g.moves.length} recorded move-pairs</div>
                  </div>
                  <button className="btn primary" onClick={() => loadGame(g)}>Load</button>
                </div>
              ))}
            </div>
            <div className="section-label">Import a game (JSON, matching the export shape)</div>
            <textarea
              className="import-area"
              placeholder='{ "chsGm": { "Id": 2, "GName": "...", "PauseFor": 750, "StrtPos": "", "Remind": "" }, "moves": [ { "MoveNo": "1", "Wh": "d2-d4", "Bl": "g8-f6", "Annot": "", "AdAnnot": "", "RtfAnnot": "" } ] }'
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            {importError && <div className="import-error">{importError}</div>}
            <div className="btn-row">
              <button className="btn primary" onClick={importGame}>Add to library</button>
              <button className="btn" onClick={() => setLibraryOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}


      {exportOpen && (
        <div className="modal-backdrop" onClick={() => setExportOpen(false)}>
          <div className="modal" style={{ minWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>Export — CHSGM / MOVES shape</h3>
            <textarea ref={taRef} className="export-area" readOnly value={JSON.stringify(exportPayload(), null, 2)} />
            <div className="btn-row">
              <button className="btn" onClick={() => { taRef.current.select(); document.execCommand("copy"); }}>Copy</button>
              <button className="btn primary" onClick={downloadJSON}>Download .json</button>
              <button className="btn" onClick={() => setExportOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {setupOpen && (
        <div className="modal-backdrop" onClick={() => setSetupOpen(false)}>
          <div className="modal setup-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Set up position</h3>
            <div className="setup-layout">
              <div className="board-wrap" style={{ padding: 12 }}>
                <div className="setup-board-grid">
                  {RANKS.map((r) =>
                    FILES.map((f) => {
                      const sq = f + r;
                      const piece = setupSquares[sq];
                      const light = (fileIdx(sq) + r) % 2 === 1;
                      return (
                        <div
                          key={sq}
                          className={`setup-square ${light ? "light" : "dark"}`}
                          onClick={() => setupPlaceOrClear(sq)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => setupOnDrop(sq)}
                        >
                          {piece && (
                            <span
                              draggable
                              onDragStart={() => setSetupDragSq(sq)}
                              className={piece.color === "w" ? "white-piece" : "black-piece"}
                            >
                              {GLYPH[piece.color][piece.type]}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="setup-side">
                <div className="section-label">White pieces</div>
                <div className="setup-palette-row">
                  {["k", "q", "r", "b", "n", "p"].map((t) => (
                    <button
                      key={"w" + t}
                      className={`setup-piece-btn ${setupTool && setupTool.color === "w" && setupTool.type === t ? "active" : ""}`}
                      title={t}
                      onClick={() => setSetupTool({ type: t, color: "w" })}
                    >
                      {GLYPH.w[t]}
                    </button>
                  ))}
                </div>
                <div className="section-label">Black pieces</div>
                <div className="setup-palette-row">
                  {["k", "q", "r", "b", "n", "p"].map((t) => (
                    <button
                      key={"b" + t}
                      className={`setup-piece-btn ${setupTool && setupTool.color === "b" && setupTool.type === t ? "active" : ""}`}
                      title={t}
                      onClick={() => setSetupTool({ type: t, color: "b" })}
                    >
                      {GLYPH.b[t]}
                    </button>
                  ))}
                </div>
                <button
                  className={`setup-eraser-btn ${!setupTool ? "active" : ""}`}
                  onClick={() => setSetupTool(null)}
                >
                  Eraser (click a square to remove)
                </button>

                <div className="section-label">Side to move first</div>
                <div className="setup-turn-row">
                  <button className={`btn ${setupTurn === "w" ? "active" : ""}`} onClick={() => setSetupTurn("w")}>White</button>
                  <button className={`btn ${setupTurn === "b" ? "active" : ""}`} onClick={() => setSetupTurn("b")}>Black</button>
                </div>

                <div className="btn-row">
                  <button className="btn" onClick={setupStandardBoard}>Standard setup</button>
                  <button className="btn" onClick={setupClearBoard}>Clear board</button>
                </div>
              </div>
            </div>

            {setupError && <div className="import-error">{setupError}</div>}

            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={startFromSetup}>Start game from here</button>
              <button className="btn" onClick={() => setSetupOpen(false)}>Cancel</button>
            </div>
            <div className="caption">
              Click a piece in the palette, then click (or drag onto) a board square to place it.
              Drag pieces already on the board to reposition them. Pick the eraser to remove a piece.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Lightweight Minimax Chess Engine (~1400 ELO)                           */
/* ---------------------------------------------------------------------- */

const PIECE_VALS = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 5, 5, 0, 0, 0],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [20, 30, 10, 0, 0, 10, 30, 20],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
  ],
};


function evaluateBoard(board) {
  let score = 0;
  for (const sq in board) {
    const piece = board[sq];
    if (!piece) continue;
    const val = PIECE_VALS[piece.type] || 0;
    const f = FILES.indexOf(sq[0]);
    const r = parseInt(sq[1], 10);
    const rIdx = piece.color === "w" ? 8 - r : r - 1;
    const pstVal = (PST[piece.type] && PST[piece.type][rIdx] ? PST[piece.type][rIdx][f] : 0);
    const total = val + pstVal;
    score += (piece.color === "w" ? total : -total);
  }
  return score;
}

/* ---------------------------------------------------------------------- */
/* Bulletproof Legal Engine using chess.js (~1400 ELO)                    */
/* ---------------------------------------------------------------------- */


function evaluateGame(game) {
  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const val = PIECE_VALS[piece.type] || 0;
      const pstVal = (PST[piece.type] && PST[piece.type][piece.color === "w" ? r : 7 - r] ? PST[piece.type][piece.color === "w" ? r : 7 - r][c] : 0);
      const total = val + pstVal;
      score += (piece.color === "w" ? total : -total);
    }
  }
  return score;
}

function minimaxChess(game, depth, alpha, beta, isMaximizing) {
  if (game.isCheckmate()) return { score: isMaximizing ? -99999 + (3 - depth) : 99999 - (3 - depth) };
  if (game.isDraw()) return { score: 0 };
  if (depth === 0) return { score: evaluateGame(game) };

  const legalMoves = game.moves({ verbose: true });
  let bestMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const m of legalMoves) {
      game.move(m);
      const evaluation = minimaxChess(game, depth - 1, alpha, beta, false).score;
      game.undo();
      if (evaluation > maxEval) {
        maxEval = evaluation;
        bestMove = m;
      }
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const m of legalMoves) {
      game.move(m);
      const evaluation = minimaxChess(game, depth - 1, alpha, beta, true).score;
      game.undo();
      if (evaluation < minEval) {
        minEval = evaluation;
        bestMove = m;
      }
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

