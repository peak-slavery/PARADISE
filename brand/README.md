# Ei brand assets

Two marks, one family:

- **Ei Point** — the platform. The control plane you configure bots from.
- **Ei Flow** — the bot network. The eight Discord bots themselves.

Ei Point is the point everything connects through; Ei Flow is the current running
through it. They share a palette so they read as one system.

## Files

| File | Use |
|---|---|
| `eiflow-mark.svg` | Ei Flow icon only (square, 64×64 grid). Avatars, favicons, small sizes. |
| `eiflow-logo.svg` | Ei Flow horizontal lockup. Bot network branding, docs headers. |
| `eipoint-logo.svg` | Ei Point horizontal lockup. Dashboard header, platform branding. |
| `favicon.svg` | 32×32 Ei Point mark. Browser tab icon. |

All four are copied into `dashboard/public/` and served at `/eiflow-logo.svg` etc.

## Palette

| Token | Hex | Use |
|---|---|---|
| `ei-ink` | `#0F172A` | Text, deep surfaces |
| `ei-violet` | `#7C3AED` | Ei Flow primary |
| `ei-violet-deep` | `#6D28D9` | Gradient start |
| `ei-cyan` | `#06B6D4` | Ei Point primary, gradient end |
| `ei-cyan-bright` | `#22D3EE` | Accent dot, highlights |
| `ei-indigo` | `#4F46E5` | Ei Point gradient start |

Gradients always run violet → cyan, top-left to bottom-right.

## Usage rules

- Keep clear space around the mark equal to the corner radius (16 on the 64 grid).
- Do not recolour the gradient on a light background — use the full-colour mark.
- Below 24px, use `eiflow-mark.svg` without the wordmark.
- The marks are SVG with live `<text>`; for print or third-party embedding, convert
  text to outlines first.

## Bot colours

Each bot carries its own colour so logs and embeds are identifiable at a glance.

| Bot | Role | Colour |
|---|---|---|
| Shanks | moderation | `#C0392B` |
| Sanji | logging | `#3498DB` |
| Luffy | card game | `#F1C40F` |
| Niko Robin | search | `#8E44AD` |
| Cyrene | AI | `#B76EFF` |
| Nami | level up | `#FF8C42` |
| Boa Hancock | welcome | `#FF5FA2` |
| Zoro | antinuke | `#2ECC71` |
