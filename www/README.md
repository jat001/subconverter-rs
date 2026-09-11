# Subconverter Web UI

A modern web UI for the subconverter-rs project, deployable to Vercel with a single click. This project allows you to convert proxy subscriptions to various formats and create shareable links with custom configurations.

## Features

- Convert proxy subscriptions to different formats (Clash, Surge, Quantumult X, etc.)
- Create and save custom configurations
- Generate shareable short links for your configs
- Modern, responsive UI built with Next.js and Tailwind CSS

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x or later
- [pnpm](https://pnpm.io/) 11.x or later
- [Rust](https://www.rust-lang.org/) (for building the WebAssembly component)

### Setup

1. Clone the repository:

```bash
git clone https://github.com/laizn/subconverter-rs.git
cd subconverter-rs
```

2. Build the WebAssembly component:

```bash
wasm-pack build --release --target nodejs
```

3. Install dependencies for the Vercel app:

```bash
cd vercel
pnpm install
```

4. Run the development server:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
pnpm build
```

## Deployment

The app is optimized for deployment on Vercel. Simply connect your GitHub repository to Vercel and deploy.

## License

MIT
