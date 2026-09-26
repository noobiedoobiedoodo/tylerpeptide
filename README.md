# Peptide Specialist Live Voice Concierge Platform

Production-ready, duplex live voice AI platform specialized in bodybuilding, performance, recovery, and longevity peptides, powered by the Google Gemini Live WebSocket API (`gemini-2.5-flash-native-audio-latest`), Charon voice persona, multi-tiered evidence retrieval, and WhatsApp concierge routing.

---

## Key Architecture & Features

### 1. Interactive 2D Voice Persona & Audio Visualizer
- **Specialist Portrait**: High-contrast, interactive circular portrait (`/persona.jpg`) with active state glow indicators.
- **Sound Waves & Bar Equilizer**: 48 radial acoustic sound bars and shockwave pulse animations reactive to duplex speaking and listening states.
- **Spectrum Equalizer**: Real-time animated audio visualizer strip beneath the specialist portrait.

### 2. Duplex Audio Live Streaming
- **Native Audio Streaming**: Bidirectional WebAudio (PCM 16kHz) via secure server-side WebSocket gateway (`/live-gateway`) connected to Google Gemini Live.
- **Zero Client Credential Exposure**: Client browsers never receive, store, or transmit the `GEMINI_API_KEY`.
- **Acoustic Echo Cancellation (AEC)** & Voice Activity Detection (VAD).

### 3. Structured Multi-Tier Evidence Engine
- **Hierarchical Classification**:
  - **Level A**: Double-Blind Randomized Controlled Trials (RCTs) & Human Meta-Analyses.
  - **Level B**: Well-controlled Cohort & Prospective Clinical Studies.
  - **Level C**: Observational, Retrospective & Case-Control Studies.
  - **Level D**: In vitro & Animal Preclinical Models.
  - **Level E**: Community Anecdotal & Athlete Field Reports.
- **Rule of Disclosure**: Prioritizes real-world bodybuilding and gym anecdotal experiences, presenting clinical and preclinical science when queried.

### 4. WhatsApp Specialist Concierge
- Permanent, high-contrast consultation handoff card to connect users with human peptide specialists for sourcing, protocol guidance, and bloodwork consultation.

### 5. 100% Mobile Optimized
- Safe-area inset support (`viewport-fit=cover`).
- Dynamic viewport sizing with zero horizontal scrolling or clipping.
- 48px touch targets and 16px minimum input font size to prevent iOS auto-zoom.

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node.js 22+)
- Google Gemini API Key (`GEMINI_API_KEY`)

### Installation & Setup

1. **Clone repository:**
   ```bash
   git clone <repo-url>
   cd "peptide voice agent"
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   Create a `.env` file in the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   APP_URL=http://localhost:3000
   ```

4. **Run locally:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

5. **Run test suite:**
   ```bash
   npm run test
   ```

---

## Deployment to Vercel

### Deploy via Vercel CLI
```bash
npx vercel
```
Or with production flag:
```bash
npx vercel --prod
```

### Environment Variables on Vercel
Set the following environment variables in your Vercel Project Settings:
- `GEMINI_API_KEY`: Your Google Gemini API Key
- `APP_URL`: Production URL (e.g. `https://your-project.vercel.app`)
- `NODE_ENV`: `production`
