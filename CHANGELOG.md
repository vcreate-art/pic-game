# Changelog

What changed for players, newest first. Each entry is one feature merged
into `develop`; a push to `develop` deploys it to
[game-night.vcreate.art](https://game-night.vcreate.art).

## Unreleased

### Shape snapping in Draw & Guess

Hold your finger or mouse still at the end of a stroke and, if it's close
to a shape, it snaps to a clean one, the way Apple Notes does it:

- **Line**: from where you started to where you stopped.
- **Circle**, or an **ellipse** at the angle you drew it.
- **Triangle**, with its corners where you drew them.
- **Rectangle**, squared up at the angle you drew it, or a **square** if
  its sides are nearly equal. Other four-sided shapes get straight sides.

Anything else stays as drawn, and lifting without holding never snaps. The
stroke eases into the shape on every player's screen. Undo takes a snapped
shape back like any stroke, and **undo now goes back past a clear** too.

### Draw & Guess on a phone

Guessing and drawing each get a screen of their own on a phone, fitted to
the space the keyboard leaves, with nothing that scrolls under your finger.

- **Header**: the round, the word's blanks (the word itself when you're
  drawing, with an eye to hide it) and the timer. Long answers wrap between
  words.
- **Chat bar**: your avatar (with your place in the game), the guess box
  and the players button. Their sheets open in the keyboard's place: the
  players and scores, and "you" (your name, achievements, report a bug and
  the room controls).
- **Guessing**: the chat rises over the drawing, each line with its
  sender's avatar; scroll back through it, and your guess flies up into it
  when you send. React to the drawing from a button in its corner.
- **Drawing**: a colour bar down the edge of the drawing, as in WhatsApp
  and Instagram, for any colour; the tools under it, with redo next to
  undo; your likes in the corner once there are any.
- The keyboard stays out of the way of the countdown, the word choice and
  the turn's result.

On a desktop, the drawing toolbar gets **icons**, a **brush size picker**,
**redo**, and **keyboard shortcuts** (P pen, F fill, E eraser, [ and ]
brush size, 1–8 and Shift+1–8 colours, Z undo, Shift+Z redo), each shown in
its tooltip.

## 2026-10-08

### Achievements and your record

- Achievements: badges, stats and each game's last 7 nights, in the profile
  menu and on their own page.
- Rooms show wins out of games played, and wins by game in every lobby.
  Returning players keep their record; one browser is one player across
  tabs.
- **Play on your phone**: a QR code moves your seat to your phone, and your
  achievements come along.

### The sleeping cat

A rare cat naps on the join card.

## 2026-10-07

### Rooms and cards match the game covers

Rooms, cards and buttons share the game covers' look: plain white cards,
buttons in the game's colour.

### Room controls

The host can pause, restart, or go back to the lobby from the room menu.

### Bug reports

A "Report a bug" button opens a short survey.

## 2026-10-06

### Front page refresh

Separate join and create flows, a "Pick a game" layout with a sticky join
card, and game covers in each game's colour that ink in on hover.

## 2026-09-29 – 2026-09-30

### New games

Flip 7, Maze Wars (with power-ups and keyboard-only controls) and Cryptid,
and the host can remove players in every game.
