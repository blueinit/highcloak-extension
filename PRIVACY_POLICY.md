# Highcloak Privacy Policy

**Last updated:** April 13, 2026

## What Highcloak Does

Highcloak is a Chrome extension that detects personal data (PII) in your AI chat prompts before they are sent. It warns you or blocks the send when it finds sensitive information like Social Security numbers, credit card numbers, or phone numbers.

## Data We Collect

**None.**

Highcloak does not collect, transmit, or store any of your data. All PII detection runs locally in your browser using JavaScript pattern matching. No text you type is ever sent to our servers or any third party.

## What Stays on Your Machine

- All text analysis and PII detection
- Your detection history and count
- Your policy preferences
- The nudge report (generated locally, sent via your own email client)

## What We Never See

- The text you type into AI tools
- The PII that is detected
- Which AI tools you use
- Your browsing history
- Any personally identifiable information about you

## Optional Server Component

Highcloak offers an optional self-hosted server for enhanced detection (name recognition via NLP). If you choose to run this server, it runs on **your own infrastructure**. We do not host it and have no access to it.

## Chrome Storage

Highcloak uses `chrome.storage.local` to store:
- A monthly detection count (integer only)
- Whether you have dismissed the upgrade nudge (boolean)
- The current month for counter reset (string)

This data never leaves your browser.

## Permissions Explained

| Permission | Why |
|---|---|
| `activeTab` | To read text in the AI chat input field on the current tab |
| `storage` | To store your detection count locally |
| Host permissions (chatgpt.com, claude.ai, gemini.google.com, copilot.microsoft.com) | To run the content script on supported AI tools only |

## Third-Party Services

Highcloak does not integrate with, send data to, or receive data from any third-party service.

## Changes to This Policy

If we change this policy, we will update the "Last updated" date above and publish the new version with the next extension update.

## Contact

Questions about this policy: privacy@highcloak.com
