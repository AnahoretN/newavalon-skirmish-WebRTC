<div align="center">
<img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1767442866/DamanakiPreview_b1ggds.png" alt="New Avalon: Skirmish" />
</div>

# New Avalon: Skirmish

A dynamic tactical duel card game played on a limited grid field. Deploy Units and Commands to capture control over key battle lines.

## Play Online

The game is available at: **[anahoretn.github.io/newavalon-skirmish](https://anahoretn.github.io/newavalon-skirmish/)**

## Quick Start (Host a Game)

### 1. Run the Server Locally

```bash
# Install dependencies
npm install

# Start the game server (port 8822)
npm run dev
```

### 2. Expose Server with Tunnel

**Using cloudflared:**
```bash
cloudflared tunnel --url http://localhost:8822
```

**Using ngrok:**
```bash
ngrok http 8822
```

Copy the tunnel URL (e.g., `https://abc123.trycloudflare.com` or `https://abc123.ngrok-free.app`).

### 3. Share with Players

Players can join by:
1. Opening the game at [anahoretn.github.io/newavalon-skirmish](https://anahoretn.github.io/newavalon-skirmish/)
2. Clicking **Settings** (gear icon)
3. Entering the WebSocket URL: `wss://your-tunnel-url.com`
4. Clicking **Save & Apply**

Or share an invite link directly from the game (click "Copy Invite Link" in the header when connected).

## Running Locally (Development)

```bash
# Development mode (server + client with HMR)
npm run dev
```

The game will be available at `http://localhost:8080`

## Build for GitHub Pages

```bash
# Build for GitHub Pages
npm run build:gh-pages

# Deploy the 'dist' folder to GitHub Pages
# Via GitHub UI: Settings > Pages > Source > Deploy from a branch
```

## Features

- **Tactical Grid Combat**: Position-based card game on dynamic board sizes (5x5, 6x6, 7x7)
- **Real-time Multiplayer**: WebSocket-based gameplay for 2-4 players
- **Multiple Game Modes**: Free-for-all, 2v2 team battles, and 3v1
- **Card Abilities**: Deploy, Setup, Commit, and Passive abilities
- **Dynamic Status System**: Support, Threat, and tactical positioning
- **Multi-language Support**: English, Russian, Serbian
- **Custom Decks**: Build and customize your own decks
- **Responsive Design**: Works on desktop and mobile
- **Tunnel Support**: Works with ngrok, cloudflared for remote play

## Project Structure

```text
/
├── client/                   # React frontend
│   ├── components/          # UI components
│   ├── hooks/              # Custom React hooks
│   ├── locales/            # Translation files
│   ├── utils/              # Client utilities
│   └── content.ts          # Content database loader
├── server/                  # Node.js backend
│   ├── handlers/           # WebSocket message handlers
│   ├── services/           # Core services
│   ├── content/            # Game content data
│   └── utils/              # Server utilities
└── CLAUDE.md                # Development guide
```

## License

[MIT License](LICENSE)

## Support

For issues and questions, please use the GitHub issue tracker.
