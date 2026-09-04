import { Session, WebContents, WebRequestFilter } from "electron";

import log from "electron-log";
import playerStateStore from "./player-state-store";

// PERFORMANS NOTU: Filtre artık SADECE reklamla ilgili host/yol'ları dinliyor.
// Eski sürüm music.youtube.com/* ve www.youtube.com/* TÜM trafiğini JS
// callback'inden geçiriyordu (her istek = regex testi) ve bu sayfa gezintilerini
// (özellikle History/Kütüphane gibi ağır sayfaları) yavaşlatıyordu.
const adRequestFilter: WebRequestFilter = {
  urls: [
    "*://*.doubleclick.net/*",
    "*://*.googlesyndication.com/*",
    "*://*.googleadservices.com/*",
    "*://*.google-analytics.com/*",
    "*://*.adservice.google.com/*",
    "*://*.googletagmanager.com/*",
    "*://*.moatads.com/*",
    // YouTube'un kendi reklam/istatistik uç noktaları (tam yol ile daraltılmış)
    "*://*.youtube.com/api/stats/ads*",
    "*://*.youtube.com/api/stats/queue*",
    "*://*.youtube.com/ptracking*",
    "*://*.youtube.com/pagead*",
    "*://*.youtube.com/ad_break*",
    "*://*.youtube.com/get_midroll_info*",
    "*://youtubei.googleapis.com/youtubei/v1/stats/*"
  ]
};

// Daraltılmış filtre sonrası ikinci güvenlik ağı. Mümkün olduğunca ucuz tutuluyor.
const blockedUrlPatterns = [
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /google-analytics\.com/i,
  /adservice\.google\./i,
  /googletagmanager\.com/i,
  /moatads\.com/i,
  /\/api\/stats\/ads(?:[/?]|$)/i,
  /\/pagead(?:[/?]|$)/i,
  /\/ptracking(?:[/?]|$)/i,
  /\/get_midroll_info(?:[/?]|$)/i,
  /\/ad_break(?:[/?]|$)/i,
  /\/api\/stats\/queue(?:[/?]|$)/i
  // NOT: videoplayback "at=" ve adformat parametresi desenleri müzik akışını
  // kesebildiği için kaldırıldı; pre-roll'lar DOM seviyesinde hallediliyor.
];

const shouldBlock = (url: string): boolean => {
  for (let i = 0; i < blockedUrlPatterns.length; i++) {
    if (blockedUrlPatterns[i].test(url)) return true;
  }
  return false;
};

const installedSessions = new WeakSet<Session>();

// UYARI: Bu dizi executeJavaScript ile ÇALIŞTIRILIR — içinde TypeScript
// yazımı (as, tip imzaları) OLMAMALI, yoksa SyntaxError verir ve hiç
// çalışmaz. Ayrıca template literal içinde ` ve ${ kullanılmamalı.
//
// PERFORMANS: Eski sürüm HER DOM değişikliğinde TÜM sayfada (~25 seçici ile)
// querySelectorAll + tüm liste öğelerinde textContent taraması yapıyordu.
// History/Kütüphane gibi yüzlerce öğe oluşturan sayfalarda bu tarayıcıyı
// kilitliyordu. Yeni sürüm:
//   1. Sadece EKLENEN düğümleri (ve onların alt ağacını) kontrol eder
//   2. Tam sayfa taraması (fullSweep) 2 saniyede en fazla 1 kez yapılır
//   3. Sponsorlu metin taraması sadece yeni eklenen liste öğelerinde yapılır
const adCleanupScript = `
(() => {
  if (window.__ytAdBlockerInstalled) return;
  window.__ytAdBlockerInstalled = true;

  const removeMatchers = [
    "ytmusic-mealbar-promo-renderer",
    "ytmusic-shelf-renderer[is-ad]",
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-banner-promo-renderer",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-player-overlay",
    ".ytp-ad-message-container",
    ".ytp-ad-text",
    ".ytp-ad-image-overlay",
    ".video-ads",
    "ytmusic-player-ad-badge-renderer",
    "ytmusic-responsive-list-item-renderer[is-ad]",
    "ytmusic-two-row-item-renderer[is-ad]",
    "[target-id='engagement-panel-ads']",
    "#masthead-ad",
    ".badge-text-type-destructive",
    ".sponsored",
    "[aria-label*='Sponsored']",
    "[aria-label*='Reklam']"
  ].join(",");

  const listItemMatcher = "ytmusic-list-item-renderer, ytmusic-responsive-list-item-renderer";

  const skipMatchers = [
    "button.ytp-skip-ad-button",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    "button[aria-label*='Skip']",
    "button[aria-label*='Atla']"
  ].join(",");

  const removeMatchingIn = (root) => {
    if (!root || !root.querySelectorAll) return;
    try {
      const els = root.querySelectorAll(removeMatchers);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    } catch (e) {}
  };

  const checkSponsoredItem = (item) => {
    try {
      const text = item.textContent || "";
      if (text.indexOf("Sponsored") === -1 && text.indexOf("Ad \\u00b7") === -1 && text.indexOf("Reklam") === -1) return;
      const parent = item.closest("ytmusic-section-list-renderer, ytmusic-item-section-renderer");
      if (parent) {
        const header = parent.querySelector("ytmusic-responsive-header-renderer, #header");
        if (header && /sponsor|reklam/i.test(header.textContent || "")) {
          parent.remove();
          return;
        }
      }
      item.remove();
    } catch (e) {}
  };

  // Tam sayfa taraması — sadece eklenen düğüm bazlı temizleme yetersiz kalırsa
  // devreye giren güvenlik ağı. Minimum 2 saniyede bir çalışır.
  let lastFullSweep = 0;
  let sweepTimer = null;
  const fullSweep = () => {
    sweepTimer = null;
    lastFullSweep = Date.now();
    removeMatchingIn(document);
    const items = document.querySelectorAll(listItemMatcher);
    for (let i = 0; i < items.length; i++) checkSponsoredItem(items[i]);
  };

  const scheduleFullSweep = () => {
    if (sweepTimer) return;
    const wait = Math.max(0, 2000 - (Date.now() - lastFullSweep));
    sweepTimer = setTimeout(fullSweep, wait);
  };

  const handleAddedNode = (node) => {
    if (!node || node.nodeType !== 1) return;
    try {
      if (node.matches && node.matches(removeMatchers)) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
      removeMatchingIn(node);

      if (node.matches && node.matches(listItemMatcher)) {
        checkSponsoredItem(node);
        return;
      }
      if (node.querySelectorAll) {
        const items = node.querySelectorAll(listItemMatcher);
        for (let i = 0; i < items.length; i++) checkSponsoredItem(items[i]);
      }
    } catch (e) {}
  };

  // SIKI ALGILAMA: sadece kesin reklam sinyalleri.
  const adsPlayingNow = () => {
    const movie = document.getElementById("movie_player");
    if (!movie) return null;
    try {
      const cl = movie.classList;
      if (cl.contains("ad-showing") || cl.contains("ad-interrupting")) return movie;
      if (typeof movie.getVideoData === "function") {
        const data = movie.getVideoData();
        if (data && data.is_ad === true) return movie;
      }
    } catch (e) {}
    return null;
  };

  let lastSeek = 0;
  const handlePlayingAd = () => {
    const movie = adsPlayingNow();

    if (!movie) {
      // Reklam yok: her şeyi geri getir
      const anyMovie = document.getElementById("movie_player");
      if (anyMovie && anyMovie.style.display === "none") anyMovie.style.display = "";
      const video = anyMovie ? anyMovie.querySelector("video") : null;
      if (video) { try { if (video.playbackRate !== 1) video.playbackRate = 1; } catch (e) {} }
      return;
    }

    // Reklam AKTİF olarak oynuyor: gizle + sessize al + hızlandır
    try { movie.style.display = "none"; } catch (e) {}

    const video = movie.querySelector("video");
    if (video) {
      try {
        video.muted = true;
        if (video.playbackRate !== 16) video.playbackRate = 16;
        const now = Date.now();
        if (now - lastSeek > 1500 && isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.55) {
          lastSeek = now;
          video.currentTime = Math.max(0, video.duration - 0.5);
        }
      } catch (e) {}
    }

    try {
      const buttons = movie.querySelectorAll(skipMatchers);
      for (let i = 0; i < buttons.length; i++) buttons[i].click();
    } catch (e) {}
  };

  fullSweep();
  handlePlayingAd();

  const observer = new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) handleAddedNode(added[j]);
    }
    scheduleFullSweep();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const playerCheckInterval = setInterval(handlePlayingAd, 500);

  // did-navigate-in-page için ucuz yeniden tetikleme (büyük script yeniden parse edilmez)
  window.__ytAdBlockerSweep = () => {
    fullSweep();
    handlePlayingAd();
  };

  window.__ytAdBlockerCleanup = () => {
    observer.disconnect();
    clearInterval(playerCheckInterval);
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = null;
    window.__ytAdBlockerInstalled = false;
    window.__ytAdBlockerSweep = undefined;
    window.__ytAdBlockerCleanup = undefined;
  };
})();
`;

// SPA içi navigasyonlar (YTM'nin History/Library vb. sayfa geçişleri) için
// çok küçük bir script. 6KB'lık ana script'in her navigasyonda yeniden
// parse edilmesini engeller.
const sweepScript = "if (window.__ytAdBlockerSweep) window.__ytAdBlockerSweep();";

export const installAdBlocker = (ytmSession: Session, webContents: WebContents): void => {
  if (installedSessions.has(ytmSession)) return;

  installedSessions.add(ytmSession);
  ytmSession.webRequest.onBeforeRequest(adRequestFilter, (details, callback) => {
    const cancel = shouldBlock(details.url);
    callback({ cancel });
  });

  const runFullInstall = () => {
    if (!webContents.isDestroyed()) {
      // Script kendisi idempotent (window.__ytAdBlockerInstalled guard) —
      // art arda gelen navigate event'lerinde stack olmuyor.
      webContents.executeJavaScript(adCleanupScript).catch(error => {
        log.debug(`Ad blocker DOM cleanup failed: ${error}`);
      });
    }
  };

  const runCheapSweep = () => {
    if (!webContents.isDestroyed()) {
      webContents.executeJavaScript(sweepScript).catch(() => {
        /* script yoksa sorun değil — ilk tam enjeksiyon dom-ready'de gelir */
      });
    }
  };

  // Tam kurulum sadece yeni belge yüklendiğinde
  webContents.on("dom-ready", runFullInstall);
  // SPA içi navigasyonlarda sadece ucuz sweep çağrısı
  webContents.on("did-navigate-in-page", runCheapSweep);

  // Reklam algılandığında şarkı ATLANMAZ (kuyruk bozulmasın diye).
  // Reklam tamamen DOM seviyesinde engellenir: sessiz + 16x hız + sona sarma.
  playerStateStore.addEventListener((state) => {
    if (state.adPlaying) {
      log.info("Ad detected — blocking ad in player (no track skip)");
    }
  });
};
