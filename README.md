# Highcloak

Detect and block personal data before sending to AI tools.

Highcloak is a Chrome extension that catches SSNs, credit card numbers, phone numbers, and other PII in your ChatGPT, Claude, Gemini, and Copilot prompts — before they leave your machine.

**All detection runs locally in your browser. We never see your data.**

## What it detects

| Type | Policy | Example |
|---|---|---|
| Social Security Number | Block | `123-45-6789` |
| Credit Card Number | Block | `4111-1111-1111-1111` |
| US Passport Number | Block | `passport: C12345678` |
| Driver's License | Block | `DL: N1234-5678` |
| Phone Number | Warn | `(555) 867-5309` |
| IP Address | Warn | `192.168.1.1` |
| Date of Birth | Warn | `DOB: 03/15/1985` |
| Email Address | Allow | `john@example.com` |

**Block** = send button disabled, PII must be removed.
**Warn** = warning shown, user can redact or send anyway.
**Allow** = detected and logged, not blocked.

## How it works

1. You type into ChatGPT, Claude, Gemini, or Copilot
2. Highcloak scans your text locally using pattern matching
3. If PII is found, you see a warning banner or the send button is blocked
4. Choose to redact the data or remove it yourself

No data leaves your browser. No server required. No account needed.

## Install

### Browser stores
- **Chrome Web Store** — *(coming soon)*
- **Firefox Add-ons (AMO)** — *(coming soon)*
- **Edge Add-ons** — *(coming soon)*

Works on any Chromium browser (Chrome, Edge, Brave, Arc, Opera, Vivaldi) and Firefox.

### From source

**Chrome / Edge / Brave:**
1. Clone this repo
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this directory

**Firefox:**
1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `manifest.json` from this directory

Visit ChatGPT, Claude, Gemini, or Copilot — the banner appears at the bottom.

## Optional: Enhanced detection server

For name and organization detection (via NLP), you can run the optional self-hosted server. See [highcloak.com](https://highcloak.com) for details.

The extension works fully without the server. The server adds detection for names, organizations, and locations that regex patterns cannot catch.

## Supported platforms

- [ChatGPT](https://chatgpt.com) (chatgpt.com, chat.openai.com)
- [Claude](https://claude.ai)
- [Gemini](https://gemini.google.com)
- [Microsoft Copilot](https://copilot.microsoft.com)

## Privacy

Highcloak does not collect, transmit, or store any of your data. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## License

MIT — see [LICENSE](LICENSE).
