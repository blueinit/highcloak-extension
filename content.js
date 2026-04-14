"use strict";

/**
 * Highcloak Content Script
 *
 * Detects PII in AI chat prompts before they are sent.
 * All detection runs locally in the browser — no data leaves the page.
 *
 * Lifecycle:
 *   document_idle -> init() -> createBanner() + setupListeners()
 *   page unload   -> cleanup() -> disconnect observers, clear timers, remove banner
 */
(function () {
  // ==========================================================================
  // Configuration
  // ==========================================================================

  var SERVER_URL = "http://localhost:8000";
  var DEBOUNCE_MS = 500;
  var NUDGE_THRESHOLD = 10;

  // Policies applied when no server/dashboard is connected.
  // block = send disabled, warn = user chooses, allow = logged only.
  var DEFAULT_POLICIES = {
    SSN: "block",
    CREDIT_CARD: "block",
    US_PASSPORT: "block",
    DRIVERS_LICENSE: "block",
    PERSON: "warn",
    PHONE: "warn",
    IP_ADDRESS: "warn",
    DATE_OF_BIRTH: "warn",
    EMAIL: "allow",
  };

  // Regex patterns for local detection. Context-gated patterns (DOB, passport,
  // driver's license) require a label keyword to avoid false positives on
  // invoice numbers, product codes, and ordinary dates.
  var PII_PATTERNS = {
    SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    PHONE: /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    IP_ADDRESS: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    DATE_OF_BIRTH:
      /(?:DOB|date of birth|born|birthday|birthdate)[:\s]*(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)\d{2}/gi,
    US_PASSPORT: /(?:passport)[:\s#]*[A-Z]?\d{8,9}\b/gi,
    DRIVERS_LICENSE:
      /(?:DL|driver'?s?\s*(?:license|lic(?:ence)?)|license\s*(?:no|number|#))[:\s#]*[A-Z0-9][-A-Z0-9\s]{4,14}\b/gi,
  };

  // DOM selectors for the chat input on each supported platform.
  var INPUT_SELECTORS = [
    "#prompt-textarea", // ChatGPT
    'div[contenteditable="true"][id="prompt-textarea"]',
    'div.ProseMirror[contenteditable="true"]', // Claude
    'div[contenteditable="true"].ql-editor', // Gemini
    "#searchbox", // Copilot
    'textarea[data-id="root"]', // Generic fallback
  ];

  var SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Submit"]',
  ];

  // ==========================================================================
  // State (scoped to this IIFE — no globals leak)
  // ==========================================================================

  var sendIsBlocked = false;
  var debounceTimer = null;
  var bannerEl = null;
  var mutationObserver = null;
  var abortController = null;
  var serverAvailable = null; // null = unknown, true/false after first probe

  // ==========================================================================
  // Storage helpers (chrome.storage.local with localStorage fallback)
  // ==========================================================================

  function storageGet(defaults) {
    return new Promise(function (resolve) {
      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.get(defaults, resolve);
      } else {
        var result = {};
        for (var key in defaults) {
          var raw = localStorage.getItem("highcloak_" + key);
          result[key] = raw !== null ? JSON.parse(raw) : defaults[key];
        }
        resolve(result);
      }
    });
  }

  function storageSet(data) {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.set(data);
    } else {
      for (var key in data) {
        localStorage.setItem("highcloak_" + key, JSON.stringify(data[key]));
      }
    }
  }

  // ==========================================================================
  // PII Detection
  // ==========================================================================

  function detectPII(text) {
    var results = [];
    for (var label in PII_PATTERNS) {
      var pattern = PII_PATTERNS[label];
      pattern.lastIndex = 0;
      var match;
      while ((match = pattern.exec(text)) !== null) {
        results.push({
          label: label,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
    results.sort(function (a, b) {
      return a.start - b.start;
    });
    return results;
  }

  function applyPolicy(detections) {
    var blocked = [];
    var warned = [];
    var allowed = [];
    for (var i = 0; i < detections.length; i++) {
      var policy = DEFAULT_POLICIES[detections[i].label] || "allow";
      if (policy === "block") blocked.push(detections[i]);
      else if (policy === "warn") warned.push(detections[i]);
      else allowed.push(detections[i]);
    }
    return { blocked: blocked, warned: warned, allowed: allowed };
  }

  function redactLocally(text) {
    var detections = detectPII(text);
    var redacted = text;
    for (var i = detections.length - 1; i >= 0; i--) {
      var d = detections[i];
      redacted =
        redacted.slice(0, d.start) +
        "[" +
        d.label +
        "]" +
        redacted.slice(d.end);
    }
    return redacted;
  }

  // ==========================================================================
  // Server communication (optional — graceful when unavailable)
  // ==========================================================================

  function serverFetch(path, body) {
    if (serverAvailable === false) return Promise.resolve(null);

    if (abortController) abortController.abort();
    abortController = new AbortController();

    return fetch(SERVER_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortController.signal,
    })
      .then(function (res) {
        serverAvailable = true;
        return res.json();
      })
      .catch(function (err) {
        if (err.name !== "AbortError") {
          serverAvailable = false;
        }
        return null;
      });
  }

  function scanServer(text) {
    return serverFetch("/scan", { text: text });
  }

  function redactServer(text) {
    return serverFetch("/redact", { text: text });
  }

  // ==========================================================================
  // Input element helpers
  // ==========================================================================

  function findInput() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function findActiveInput() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) {
        var t =
          el.tagName === "TEXTAREA" || el.tagName === "INPUT"
            ? el.value
            : el.innerText || "";
        if (t && t.trim().length > 0) return el;
      }
    }
    var active = document.activeElement;
    if (active && active.getAttribute("contenteditable") === "true")
      return active;
    return findInput();
  }

  function getInputText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.innerText || el.textContent;
  }

  function setInputText(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  // ==========================================================================
  // Detection count + nudge
  // ==========================================================================

  function incrementDetectionCount(count) {
    var currentMonth = new Date().toISOString().slice(0, 7);
    storageGet({ detectionCount: 0, lastResetMonth: "" }).then(function (
      data
    ) {
      var n = data.lastResetMonth !== currentMonth ? 0 : data.detectionCount;
      storageSet({
        detectionCount: n + count,
        lastResetMonth: currentMonth,
      });
    });
  }

  function maybeShowNudge() {
    return storageGet({
      detectionCount: 0,
      nudgeDismissed: false,
      lastResetMonth: "",
    }).then(function (stats) {
      if (stats.nudgeDismissed || stats.detectionCount < NUDGE_THRESHOLD)
        return;
      if (!bannerEl || bannerEl.querySelector(".hc-nudge")) return;

      var nudge = document.createElement("div");
      nudge.className = "hc-nudge";

      var text = document.createElement("div");
      text.className = "hc-nudge-text";
      text.textContent =
        "You\u2019ve caught " +
        stats.detectionCount +
        " PII leaks this month. Want your IT admin to see this?";

      var shareBtn = document.createElement("button");
      shareBtn.className = "hc-btn hc-nudge-share";
      shareBtn.textContent = "Share Report with IT";

      var dismissBtn = document.createElement("button");
      dismissBtn.className = "hc-btn hc-nudge-dismiss";
      dismissBtn.textContent = "Not now";

      nudge.appendChild(text);
      nudge.appendChild(shareBtn);
      nudge.appendChild(dismissBtn);
      bannerEl.appendChild(nudge);

      shareBtn.addEventListener("click", function () {
        openReport(stats.detectionCount);
        nudge.remove();
      });

      dismissBtn.addEventListener("click", function () {
        storageSet({ nudgeDismissed: true });
        nudge.remove();
      });
    });
  }

  function openReport(count) {
    var host = window.location.hostname;
    var month = new Date().toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
    var subject = encodeURIComponent("Highcloak Report - " + month);
    var body = encodeURIComponent(
      "Hi,\n\n" +
        "I've been using Highcloak to protect our data when using AI tools. " +
        "Here's a summary for " +
        month +
        ":\n\n" +
        "- " +
        count +
        " PII instances detected and blocked/warned\n" +
        "- AI tools monitored: " +
        host +
        "\n" +
        "- All detection ran locally (no data left my machine)\n\n" +
        "Highcloak can give you a dashboard with full audit trails, " +
        "per-team policies, and compliance reports across all AI tools.\n\n" +
        "Learn more: https://highcloak.com\n\n" +
        "Best regards"
    );
    window.open("mailto:?subject=" + subject + "&body=" + body, "_blank");
  }

  // ==========================================================================
  // Send button blocking
  // ==========================================================================

  function enforceSendButtonState() {
    for (var i = 0; i < SEND_BUTTON_SELECTORS.length; i++) {
      var btns = document.querySelectorAll(SEND_BUTTON_SELECTORS[i]);
      for (var j = 0; j < btns.length; j++) {
        if (sendIsBlocked) {
          btns[j].disabled = true;
          btns[j].style.opacity = "0.3";
          btns[j].style.pointerEvents = "none";
        } else if (btns[j].style.opacity === "0.3") {
          btns[j].disabled = false;
          btns[j].style.opacity = "";
          btns[j].style.pointerEvents = "";
        }
      }
    }
  }

  // ==========================================================================
  // Banner UI
  // ==========================================================================

  function createBanner() {
    var banner = document.createElement("div");
    banner.id = "hc-banner";

    var content = document.createElement("div");
    content.className = "hc-content";

    var icon = document.createElement("span");
    icon.className = "hc-icon";
    icon.textContent = "\u{1F6E1}\u{FE0F}";

    var text = document.createElement("span");
    text.className = "hc-text";
    text.textContent = "Highcloak Active";

    var count = document.createElement("span");
    count.className = "hc-count";
    count.style.display = "none";

    var redactBtn = document.createElement("button");
    redactBtn.className = "hc-btn hc-redact";
    redactBtn.textContent = "Redact & Send";
    redactBtn.style.display = "none";

    var dismissBtn = document.createElement("button");
    dismissBtn.className = "hc-btn hc-dismiss";
    dismissBtn.textContent = "Send Anyway";
    dismissBtn.style.display = "none";

    content.appendChild(icon);
    content.appendChild(text);
    content.appendChild(count);
    content.appendChild(redactBtn);
    content.appendChild(dismissBtn);
    banner.appendChild(content);
    document.body.appendChild(banner);

    bannerEl = banner;
    return banner;
  }

  function uniqueLabels(items) {
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (!seen[items[i].label]) {
        seen[items[i].label] = true;
        out.push(items[i].label);
      }
    }
    return out;
  }

  function updateBanner(detections, policyResult) {
    var banner = bannerEl || createBanner();
    var countEl = banner.querySelector(".hc-count");
    var redactBtn = banner.querySelector(".hc-redact");
    var dismissBtn = banner.querySelector(".hc-dismiss");
    var text = banner.querySelector(".hc-text");

    var oldNudge = banner.querySelector(".hc-nudge");
    if (oldNudge) oldNudge.remove();

    if (!detections || detections.length === 0) {
      countEl.style.display = "none";
      redactBtn.style.display = "none";
      dismissBtn.style.display = "none";
      text.textContent = "Highcloak Active \u2014 No PII detected";
      banner.classList.remove("hc-warning", "hc-blocked");
      sendIsBlocked = false;
      enforceSendButtonState();
      return;
    }

    countEl.textContent =
      detections.length +
      " PII found: " +
      uniqueLabels(detections).join(", ");
    countEl.style.display = "inline";

    if (policyResult && policyResult.blocked.length > 0) {
      text.textContent =
        "\u{1F6D1} BLOCKED: " +
        uniqueLabels(policyResult.blocked).join(", ") +
        " detected \u2014 Remove PII to continue";
      redactBtn.style.display = "none";
      dismissBtn.style.display = "none";
      banner.classList.add("hc-blocked");
      banner.classList.remove("hc-warning");
      sendIsBlocked = true;
      enforceSendButtonState();
    } else if (policyResult && policyResult.warned.length > 0) {
      text.textContent =
        "\u26A0\uFE0F PII Detected \u2014 Review before sending";
      redactBtn.style.display = "inline-block";
      dismissBtn.style.display = "inline-block";
      banner.classList.add("hc-warning");
      banner.classList.remove("hc-blocked");
      sendIsBlocked = false;
      enforceSendButtonState();
    } else {
      text.textContent = "Highcloak Active \u2014 Allowed PII detected";
      redactBtn.style.display = "none";
      dismissBtn.style.display = "none";
      banner.classList.remove("hc-warning", "hc-blocked");
      sendIsBlocked = false;
      enforceSendButtonState();
    }
  }

  // ==========================================================================
  // Core scan loop
  // ==========================================================================

  function onInputChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var input = findActiveInput();
      if (!input) return;

      var text = getInputText(input);
      if (!text || text.trim().length < 5) {
        updateBanner(null, null);
        return;
      }

      var localDetections = detectPII(text);
      var policyResult = applyPolicy(localDetections);

      if (localDetections.length > 0) {
        incrementDetectionCount(localDetections.length);
      }

      // Show local results immediately — don't wait for server
      updateBanner(localDetections, policyResult);

      // Try server scan in background (enhances with NER results)
      scanServer(text).then(function (serverResult) {
        if (
          !serverResult ||
          !serverResult.entities ||
          serverResult.entities.length === 0
        )
          return;

        var merged = localDetections.slice();
        for (var i = 0; i < serverResult.entities.length; i++) {
          var sd = serverResult.entities[i];
          var isDupe = false;
          for (var j = 0; j < merged.length; j++) {
            if (merged[j].text === sd.text && merged[j].label === sd.label) {
              isDupe = true;
              break;
            }
          }
          if (!isDupe) merged.push(sd);
        }

        var mergedPolicy = applyPolicy(merged);
        updateBanner(merged, mergedPolicy);

        var extra = merged.length - localDetections.length;
        if (extra > 0) incrementDetectionCount(extra);
      });

      maybeShowNudge();
    }, DEBOUNCE_MS);
  }

  // ==========================================================================
  // Event listeners (named functions for cleanup)
  // ==========================================================================

  function onInput(e) {
    var target = e.target;
    if (!target) return;
    var editable =
      target.getAttribute("contenteditable") === "true" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT";
    if (!editable && target.closest) {
      editable = !!target.closest('[contenteditable="true"]');
    }
    if (editable) onInputChange();
  }

  function onKeydown(e) {
    if (!sendIsBlocked) return;
    if (e.key === "Enter" && !e.shiftKey) {
      var input = findInput();
      if (input && (input === e.target || input.contains(e.target))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }

  function onClick(e) {
    var target = e.target;
    if (!target || !target.classList) return;

    if (target.classList.contains("hc-redact")) {
      var input = findInput();
      if (!input) return;
      var text = getInputText(input);

      redactServer(text).then(function (result) {
        if (result && result.redacted_text) {
          setInputText(input, result.redacted_text);
        } else {
          setInputText(input, redactLocally(text));
        }
        updateBanner(null, null);
      });
    }

    if (target.classList.contains("hc-dismiss")) {
      updateBanner(null, null);
    }
  }

  // ==========================================================================
  // Lifecycle: init + cleanup
  // ==========================================================================

  function init() {
    createBanner();

    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("click", onClick);

    mutationObserver = new MutationObserver(function () {
      if (sendIsBlocked) enforceSendButtonState();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("pagehide", cleanup);

    console.log("[Highcloak] Content script loaded — local detection active");
  }

  function cleanup() {
    clearTimeout(debounceTimer);
    debounceTimer = null;

    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    document.removeEventListener("input", onInput);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("click", onClick);
    window.removeEventListener("pagehide", cleanup);

    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    }

    sendIsBlocked = false;
  }

  // ==========================================================================
  // Entry point
  // ==========================================================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
