# Toolkit — Polaris

Personal collection of tools. Hosted at `toolkit.polaris.my.id`.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Structure

```
app/
├── layout.js                          # Root layout (wraps every page)
├── page.js                            # Home (blank for now)
├── globals.css                        # Global styles
├── word-to-pdf/
│   └── page.js                        # toolkit.polaris.my.id/word-to-pdf
├── find-contributor-date-average/
│   └── page.js
└── transpose-data-multi-header/
    └── page.js
```

## How to add a new tool

1. Create a new folder under `app/` with the URL slug, e.g. `app/my-new-tool/`
2. Add a `page.js` file inside:

```jsx
export const metadata = { title: "My New Tool | Toolkit" };

export default function MyNewToolPage() {
  return <main>...</main>;
}
```

3. Visit `toolkit.polaris.my.id/my-new-tool`. Done.

## Deployment

Easiest: push to GitHub, connect repo to Vercel, point `toolkit.polaris.my.id` DNS at Vercel. Other options: Netlify, your own VPS with `npm run build && npm start`.

## Notes

- Using Next.js 14 App Router (file-based routing).
- Plain JavaScript (no TypeScript). Add later if wanted.
- No CSS framework yet. Inline styles for placeholders; pick Tailwind / CSS Modules / styled-components when you build the first real tool.
