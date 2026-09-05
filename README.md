# ♟️ Chess Ledger & Engine

A vintage, parchment-styled interactive chess scoresheet, analysis board, and playback engine built with **React** and **chess.js**. Includes an integrated **~1400 ELO Minimax AI Opponent**, visual move trajectory fading, real-time checkmate detection, and game recording/exporting capabilities.

---

## ✨ Features

### 🎨 Visuals & Aesthetics
* **📜 Vintage Parchment Theme:** Warm walnut, felt greens, oxblood accents, and classic typography (*Fraunces* + *JetBrains Mono*).
* **✨ Trajectory Path Fading:** Moving pieces leave a smooth, color-fading trail along their entire route (origin, intermediate path, and settled square).
* **🔴 Glowing Check Indicator:** The King's square pulses in bright glowing red whenever placed in check or checkmate.
* **⏳ Floating Status & Thinking Badge:** Responsive live-status banner directly over the board, displaying live game status (*Check*, *Checkmate*, *Draw*, and *Computer is thinking…*).

---

### 🤖 Single-Player vs. Computer Engine (~1400 ELO)
* **🧠 Minimax with Alpha-Beta Pruning:** Evaluates legal moves 3 half-moves deep with material evaluation and center-control positional bonuses.
* **⚪ / ⚫ Play as White or Black:** Toggle whether the computer plays as Black or makes the opening move as White.
* **🛡️ 100% Legal Move Guarantee:** Backed by standard FIDE rules with pin validation, castling, en-passant, and promotion handling.
* **↩️ Smart Take Back:** Undoes both the AI's move and your move in a single click, instantly rewinding the game to your turn without getting stuck.

---

### 📋 Scoresheet Ledger & Library
* **📖 Move-by-Move Record:** Automatically records moves in classical notation (e.g. `e2-e4`, `e4xd5`, `O-O`).
* **✍️ Move Annotations:** Add custom notes to any move, with featured annotations displayed in the sticky top banner.
* **🎞️ Automated Playback Engine:**
  * **▶ Run / ⏸ Pause / ■ Stop / ⟲ Reset**
  * **Infinite Loop mode** & **Blink animation**
  * **⏩ Fastmove** (step forward $N$ moves at once)
  * **Adjustable Pause Interval** (1234 ms – 25555 ms)
* **📚 Game Library:** Pre-seeded games with import/export support for custom game collections.

---

### 💾 Export & Download Options
* **💾 Download PGN:** One-click export to standard `.pgn` format, ready to import and analyze on **Chess.com** or **Lichess**.
* **💾 Download JSON:** Save the complete state (metadata + moves + annotations) to reload into your local library anytime.
* **📋 Copy Payload:** Quick-copy raw CHSGM / MOVES structured JSON to clipboard.

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v16 or newer) installed.

### 2. Installation
Clone the repository and install the dependencies:

```bash
git clone https://github.com/manjilj/chess-ledger.git
cd chess-ledger
npm install
npm install chess.js
```

### 3. Run it

```bash
npm start
```

Opens the app at `http://localhost:3000`.

---

## 🎮 Playing Against the Computer

The AI opponent is off by default — every fresh load or **New Game** starts as a
two-human free-play board until you turn it on. Sequence:

1. **New Game** — clears the board back to the standard starting position and
   drops you into free play (skip this if you're already mid-game and just
   want to switch modes).
2. **👤 vs. Human → 🤖 vs. Computer (ON)** — click this button to turn the AI
   on. A second button, **AI plays: …**, appears next to it once it's on.
3. **AI plays: White (First) / Black (Second)** — click this to flip which
   side the computer takes:
   * **AI plays: Black (Second)** *(the default)* — you're White and move
     first; after your move the **⏳ Computer is thinking…** badge appears
     briefly and the AI replies on its own.
   * **AI plays: White (First)** — the computer immediately plays White's
     opening move for you (same brief "thinking" delay), then it's your turn
     as Black.
4. **Make your moves** the normal way — click a piece then its destination
   square, or drag-and-drop. Illegal moves are rejected automatically; the
   AI only ever replies once it's actually its turn.
5. **↩ Take Back Move** — undoes a mistake. With the AI on, one click removes
   *both* the computer's reply and your move before it, so you land back on
   your own turn instead of getting stuck answering the same AI move twice.
6. Toggle **🤖 vs. Computer** off any time to go back to two-human play — the
   on/off state and which color the AI plays both carry over the next time
   you click **New Game**, so you don't have to re-pick them each game.

You can also start the AI from a **custom position**: use **Set Up Position…**
(see below) to place whatever pieces you want and pick who moves first, click
**Start game from here**, then turn on **🤖 vs. Computer** — the order doesn't
matter, both can be set up in either sequence before you make your first move.

---

## 🧩 Setting Up a Custom Position

Click **Set Up Position…** to open the board editor instead of always starting
from the standard array:

1. Pick a piece from the **White pieces** / **Black pieces** palette.
2. Click a square on the editor board to place it there (clicking an occupied
   square overwrites whatever was on it). Drag pieces already placed to move
   them elsewhere on the board.
3. Select the **Eraser** tool, then click a square to remove a piece.
4. **Standard setup** resets the editor to the normal starting array;
   **Clear board** empties it completely.
5. Pick **White** or **Black** under *Side to move first*.
6. **Start game from here** validates that both a white and a black king are
   present, then loads the position into free play with the side you chose
   to move first (works with 🤖 vs. Computer either on or off).

Handy for drilling specific endgames — e.g. king + rook vs. king + rook —
without playing through an entire game to reach them.

### 🔧⚙ Environment Variables

Move commentary is generated by an LLM call to Groq's API, so you'll need a
free Groq API key for that feature to work (the app still runs fine without
it — commentary just falls back to plain "White plays e4" style text).

1. Sign up / log in at [console.groq.com](https://console.groq.com).
2. Go to **API Keys** and create a new key (starts with `gsk_...`).
3. In the project root (same folder as `package.json`), create a file named
   `.env` (Example code is in `.env.example`):

REACT_APP_AI_API_KEY=your_groq_api_key_here

DISABLE_ESLINT_PLUGIN=true

GENERATE_SOURCEMAP=false

🥂Cheers!