# The Hollow Bell — Multiplayer Game

A cross-device social-deduction game prototype built with Node.js, Express, and Socket.IO.

## Requirements satisfied
- 2–12 players can join the same room from separate devices.
- Players join with a room code.
- Real-time state synchronization through Socket.IO.
- Real game phases: lobby, night, day, voting, victory.
- Server-authoritative role assignment, attacks, executions, and win conditions.
- A rules panel and visible phase/timer provide in-game guidance.
- Responsive browser UI works on phones, tablets, and desktop.

## Run locally
1. Install Node.js 18+.
2. In this folder run:
   npm install
   npm start
3. Open http://localhost:3000

For phones on the same Wi-Fi, use the computer's LAN IP instead of localhost.

## Deploy
Deploy this folder to any Node-compatible host (Render, Railway, Fly.io, etc.).
The host must run `npm start` and expose the assigned HTTP port.
After deployment, share the resulting HTTPS URL; every player opens the same URL and enters the room code. I cannot truthfully claim a public URL until this project is deployed to a hosting provider.

## Important
This is a playable vertical slice. The next polish pass should add the private role/ability panel, richer night actions, the Case Board, more events, ghost abilities, and the final Village Archive.
