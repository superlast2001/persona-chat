# Persona Chat

A phone-friendly **Crush-style persona chatbot** you open in the browser. Pick a character, chat with streaming replies, and edit prompts in the repo. Static HTML/CSS/JS on **GitHub Pages** — no server, no Pinggy.

**Open it:** https://superlast2001.github.io/persona-chat/

## 1. Open on your phone
1. Open the link above in Chrome (Android) or Safari (iPhone).
2. First visit: tap **I am 18 or older** (saved in this browser).
3. Optional — Add to Home Screen so it feels like an app.

## 2. Add an API key (Settings)
The app talks to any **OpenAI-compatible** chat API from your browser.

1. Sign up at [OpenRouter](https://openrouter.ai) (or use another provider).
2. Create a key → paste it in **⚙️ Settings** (password field).
3. Default base URL: `https://openrouter.ai/api/v1`
4. Default model: `openrouter/free`
5. Tap **Save**, then **Test connection**.

🔒 **Your API key stays in this browser's localStorage only.** It is never in this repo and is never sent anywhere except the API base URL you set. Do not commit keys.

### Free vs paid models
| Model | Notes |
|---|---|
| `openrouter/free` | Free tier. **May refuse NSFW / adult fiction.** |
| `sao10k/l3.1-euryale-70b` | Paid / needs OpenRouter **credit**. Strong for adult roleplay. |
| `sao10k/l3-lunaris-8b` | Paid / needs OpenRouter **credit**. Lighter Euryale-style option. |

Quick picks in Settings are labelled free vs paid. Euryale-style models need OpenRouter credit; free models may refuse NSFW.

## 3. Personas
Bottom nav: **Chat | Personas | Prompt | Settings | Gallery**.

- Personas load from `personas/*.json` (listed in `personas/index.json`).
- Each has: name, tagline, personality, speaking_style, scenario, boundaries, greeting, avatar, gallery.
- Active persona and **per-persona chat history** are saved in localStorage.
- Starters included: Default Assistant, Ember Vale, Kael Orbit (all fictional adults).

## 4. Edit prompts and personas on GitHub
- **`lib/prompt.txt`** — hard rules + general tone (always assembled first). Edit on GitHub → pencil → Commit. After Pages refreshes, tap **Load from lib** in the Prompt tab (or Reset if you had an override).
- **`personas/*.json`** — character fields. Add a new file and list its id in `personas/index.json`.
- **Prompt tab** — big textarea of the assembled system prompt (or your per-persona override). **Save override** / **Reset to built-in** / **Load from lib**.

### How the system prompt is built
1. **Hard rules** (always first): no sexual content involving anyone under 18 or clearly childlike characters (unspecified age = adult); no sexual content about real identifiable people.
2. **General** tone from `lib/prompt.txt`.
3. **Intensity** style: Soft / Normal / **Max** (default), from Settings, saved in localStorage.
4. Active persona fields.

> **Honesty note:** these hard rules are **prompt-only**. They are not a filter or age verification. How well they hold depends on the model — heavily uncensored finetunes are the least reliable at following them. The 18+ gate is a click-through in your browser.

## 5. Chat features
- Streaming OpenAI-compatible `/chat/completions` from the browser.
- Regenerate, edit/delete messages, clear chat, stop stream.
- Greeting becomes the first assistant message when a chat is empty.
- Persona avatar in the header.
- If the model writes an image URL (http(s), image extension or imgchest), it shows inline.

## 6. Avatars and gallery (Image Chest links)

Persona Chat never uploads or hosts images — **links only**. Your browser loads them directly (`referrerpolicy=no-referrer`).

### Upload once, paste the direct link
1. Upload an image you own (fictional adult characters only) to [Image Chest](https://imgchest.com) or any image host.
2. Copy the **direct** file URL, e.g. `https://cdn.imgchest.com/files/xxxx.png` (must be http/https and end in `.jpg` / `.jpeg` / `.png` / `.webp` / `.gif` / `.avif`, or use an `imgchest.com` host).
3. Paste it into:
   - **Personas** or **Prompt** tab → **Avatar URL** → Save (shown in picker + chat header), or
   - **Gallery** tab → URL + optional caption/tag → **Add to gallery** (tap image to zoom; **Remove** drops it in this browser).
4. To share with everyone, put the same URL in the persona JSON on GitHub:
   - `"avatar": "https://cdn.imgchest.com/files/xxxx.png"`
   - `"gallery": [{ "url": "https://…", "caption": "…", "tag": "…" }]`

Local avatar/gallery edits stay in this browser until you commit. Do not paste images of real people into sexual contexts (hard rules still apply in the prompt).

### Inline images in chat
If the model writes an image URL in a reply, Persona Chat renders it as an inline image (same URL rules as above).

## Files
- `index.html`, `style.css`, `app.js`, `render.js` — the app (no build step)
- `lib/prompt.txt` — hard rules + general template
- `personas/index.json` + `personas/*.json` — starter personas

## Privacy
API key, chats, intensity, prompt overrides, and local gallery adds live only in your browser. Clearing site data removes them.
