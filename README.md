# Code Stripper

Code Stripper is a browser-based HTML content editor that preserves the original
markup while allowing text edits and narrowly scoped link and image changes.

## Features

- Extracts meaningful text nodes in document order with `DOMParser` and `TreeWalker`
- Updates text without serializing or reformatting the surrounding HTML
- Supports the explicit link and image editing exceptions
- Replaces hosted image URLs while preserving existing proportions and attributes
- Provides a live viewport, light and dark themes, and an on-page SEO review
- Copies the complete updated source back to the clipboard

## Local development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
```

The default development and build commands use Vinext for the existing
Cloudflare/Sites deployment.

## Deployment targets

### Cloudflare / Sites

```bash
npm run build
```

### Vercel

The repository includes `vercel.json`, a native Next.js dependency, and a
separate TypeScript configuration for Vercel. Import the repository into Vercel;
the project configuration runs:

```bash
npm run build:vercel
```

The default Vinext scripts and Cloudflare worker files remain unchanged, so the
two deployment targets can coexist.
