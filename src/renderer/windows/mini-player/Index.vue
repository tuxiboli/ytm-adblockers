<script setup lang="ts">
import { onMounted, ref } from "vue";

const title = ref("YouTube Music");
const author = ref("");
const thumbnail = ref("");
const isPlaying = ref(false);
const progress = ref(0);
const duration = ref(0);
const currentTime = ref("0:00");
const totalTime = ref("0:00");
const repeatMode = ref("NONE");
const queue = ref<any[]>([]);
const currentIndex = ref(0);
const volume = ref(100);
let previousVolume = 100;
let initialVolumeLoaded = false;
const likeStatus = ref("UNKNOWN");

// Performans: Ana süreçten progress artık sadece saniyede 1 geliyor.
// Aradaki sürede çubuk donuk kalmasın diye yerelde akıcı extrapolasyon yapıyoruz.
let progressBaseline = 0;
let progressUpdatedAt = 0;
let progressTimer: number | null = null;

function syncProgress(value: number) {
  progressBaseline = value || 0;
  progressUpdatedAt = Date.now();
  progress.value = progressBaseline;
  currentTime.value = formatTime(progressBaseline);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ":" + secs.toString().padStart(2, "0");
}

onMounted(() => {
  if (window.miniPlayer) {
    window.miniPlayer.onTrackInfo((_event: any, data: any) => {
      title.value = data.title || "YouTube Music";
      author.value = data.author || "";
      thumbnail.value = data.thumbnail || "";
      duration.value = data.duration || 0;
      totalTime.value = formatTime(data.duration || 0);
      if (data.likeStatus) likeStatus.value = data.likeStatus;
    });

    window.miniPlayer.onPlayerState((_event: any, state: any) => {
      isPlaying.value = state.isPlaying;
      if (state.currentIndex !== undefined) currentIndex.value = state.currentIndex;
      // progress geldikçe lokal sayaç düzeltilir
      syncProgress(state.progress || 0);
    });

    window.miniPlayer.onRepeatChange((_event: any, mode: string) => {
      repeatMode.value = mode;
    });

    window.miniPlayer.onQueueUpdate((_event: any, items: any[]) => {
      queue.value = items;
    });

    window.miniPlayer.onVolumeChange((_event: any, vol: number) => {
      // Sunucudan gelen ses güncellemelerini yok say - sadece ilk yüklemede kabul et
      if (!initialVolumeLoaded) {
        volume.value = vol;
        previousVolume = vol;
        initialVolumeLoaded = true;
      }
    });

    window.miniPlayer.requestInitialData();
  }

  // Çalma sırasında çubuğu 250ms'de bir akıcı ilerlet
  progressTimer = window.setInterval(() => {
    if (!isPlaying.value || duration.value <= 0 || progressUpdatedAt === 0) return;
    const predicted = progressBaseline + (Date.now() - progressUpdatedAt) / 1000;
    const clamped = Math.min(predicted, duration.value);
    progress.value = clamped;
    currentTime.value = formatTime(clamped);
  }, 250);
});

let lastPlayPauseTime = 0;

function togglePlayPause() {
  const now = Date.now();
  if (now - lastPlayPauseTime < 400) return;
  lastPlayPauseTime = now;
  if (window.miniPlayer) window.miniPlayer.playPause();
}

function nextTrack() {
  if (window.miniPlayer) window.miniPlayer.next();
}

function previousTrack() {
  if (window.miniPlayer) window.miniPlayer.previous();
}

function toggleRepeat() {
  if (window.miniPlayer) window.miniPlayer.toggleRepeat();
}

function toggleLike() {
  if (window.miniPlayer) window.miniPlayer.toggleLike();
}

function toggleDislike() {
  if (window.miniPlayer) window.miniPlayer.toggleDislike();
}

function toggleMute() {
  if (volume.value > 0) {
    previousVolume = volume.value;
    volume.value = 0;
  } else {
    volume.value = previousVolume > 0 ? previousVolume : 50;
  }
  if (window.miniPlayer) window.miniPlayer.setVolume(volume.value);
}

function onVolumeChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const vol = parseInt(target.value);
  volume.value = vol;
  previousVolume = vol > 0 ? vol : previousVolume;
  if (window.miniPlayer) window.miniPlayer.setVolume(vol);
}

function seekTo(event: MouseEvent) {
  const bar = event.currentTarget as HTMLElement;
  const rect = bar.getBoundingClientRect();
  const x = Math.max(0, event.clientX - rect.left);
  const percent = Math.min(1, Math.max(0, x / rect.width));
  const seekTime = Math.floor(percent * duration.value);
  // Yeni progress IPC'si gelene kadar çubuk sıçramasın diyerek lokal senkronize et
  syncProgress(seekTime);
  if (window.miniPlayer) window.miniPlayer.seekTo(seekTime);
}

function openMainWindow() {
  if (window.miniPlayer) window.miniPlayer.openMain();
}

function closeMiniPlayer() {
  if (window.miniPlayer) window.miniPlayer.close();
}

function playQueueItem(index: number) {
  if (window.miniPlayer) window.miniPlayer.playQueueIndex(index);
}
</script>

<template>
  <div class="mini-player">
    <div class="track-info">
      <img v-if="thumbnail" class="thumbnail" :src="thumbnail" />
      <div v-else class="thumbnail-placeholder"></div>
      <div class="text-info">
        <p class="title">{{ title }}</p>
        <p class="author">{{ author }}</p>
      </div>
    </div>

    <div class="controls">
      <button class="ctrl-btn" :class="{ liked: likeStatus === 'LIKE' }" @click="toggleLike">
        <span class="material-symbols-outlined">{{ likeStatus === 'LIKE' ? 'thumb_up' : 'thumb_up_off_alt' }}</span>
      </button>
      <button class="ctrl-btn" @click="previousTrack">
        <span class="material-symbols-outlined">skip_previous</span>
      </button>
      <button class="ctrl-btn play-btn" @click="togglePlayPause">
        <span class="material-symbols-outlined">{{ isPlaying ? "pause" : "play_arrow" }}</span>
      </button>
      <button class="ctrl-btn" @click="nextTrack">
        <span class="material-symbols-outlined">skip_next</span>
      </button>
      <button class="ctrl-btn" :class="{ liked: likeStatus === 'DISLIKE' }" @click="toggleDislike">
        <span class="material-symbols-outlined">{{ likeStatus === 'DISLIKE' ? 'thumb_down' : 'thumb_down_off_alt' }}</span>
      </button>
    </div>

    <div class="progress-row">
      <span class="time">{{ currentTime }}</span>
      <div class="bar" @click="seekTo">
        <div class="bar-fill" :style="{ width: duration > 0 ? (progress / duration) * 100 + '%' : '0%' }"></div>
      </div>
      <span class="time">{{ totalTime }}</span>
    </div>

    <div class="bottom-row">
      <button class="ctrl-btn repeat-btn" :class="{ active: repeatMode !== 'NONE' }" @click="toggleRepeat" title="Repeat">
        <span class="material-symbols-outlined">{{ repeatMode === 'ONE' ? 'repeat_one' : 'repeat' }}</span>
      </button>
      <button class="ctrl-btn vol-btn" @click="toggleMute" title="Mute">
        <span class="material-symbols-outlined">{{ volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up' }}</span>
      </button>
      <input type="range" class="vol-slider" min="0" max="100" :value="volume" @input="onVolumeChange" />
      <button class="action-btn" @click="openMainWindow">
        <span class="material-symbols-outlined">open_in_new</span>
      </button>
      <button class="action-btn close-btn" @click="closeMiniPlayer">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div v-if="queue.length > 0" class="queue-section">
      <div class="queue-header">
        <span class="material-symbols-outlined queue-icon">queue_music</span>
        <span class="queue-title">Queue</span>
      </div>
      <div class="queue-list">
        <div
          v-for="(item, index) in queue"
          :key="index"
          class="queue-item"
          :class="{ playing: index === currentIndex }"
          @click="playQueueItem(index)"
        >
          <img v-if="item.thumbnail" class="queue-thumb" :src="item.thumbnail" />
          <div v-else class="queue-thumb-placeholder"></div>
          <div class="queue-info">
            <p class="queue-song">{{ item.title }}</p>
            <p class="queue-artist">{{ item.artist }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  background: #1e1e1e;
  color: #fff;
  font-family: "Open Sans", sans-serif;
  overflow: hidden;
  -webkit-app-region: drag;
}
.mini-player {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}
.track-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.thumbnail {
  width: 50px;
  height: 50px;
  border-radius: 4px;
  object-fit: cover;
}
.thumbnail-placeholder {
  width: 50px;
  height: 50px;
  border-radius: 4px;
  background: #333;
}
.text-info {
  min-width: 0;
  flex: 1;
}
.text-info .title {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.text-info .author {
  font-size: 10px;
  color: #aaa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}
.ctrl-btn {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.ctrl-btn:hover {
  background: rgba(255,255,255,0.1);
}
.ctrl-btn .material-symbols-outlined {
  font-size: 18px;
}
.liked {
  color: #1db954 !important;
}
.play-btn {
  width: 36px;
  height: 36px;
  background: #fff;
  color: #000;
}
.play-btn:hover {
  background: #e0e0e0;
}
.play-btn .material-symbols-outlined {
  font-size: 24px;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}
.time {
  font-size: 9px;
  color: #888;
  min-width: 28px;
  text-align: center;
}
.bar {
  flex: 1;
  height: 3px;
  background: #444;
  border-radius: 2px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: #fff;
  border-radius: 2px;
}
.bottom-row {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}
.repeat-btn {
  color: #888;
}
.repeat-btn.active {
  color: #1db954;
}
.vol-icon {
  font-size: 16px;
  color: #aaa;
}
.vol-btn {
  color: #aaa;
  width: 24px;
  height: 24px;
}
.vol-btn:hover {
  color: #fff;
  background: rgba(255,255,255,0.1);
}
.vol-slider {
  flex: 1;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: #444;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  transition: none !important;
  animation: none !important;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  transition: none !important;
  animation: none !important;
}
.vol-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: none;
  transition: none !important;
  animation: none !important;
}
.vol-slider::-webkit-slider-runnable-track {
  transition: none !important;
  animation: none !important;
}
.vol-slider::-moz-range-track {
  transition: none !important;
  animation: none !important;
}
.vol-slider:active {
  transition: none !important;
  animation: none !important;
}
.vol-slider:active::-webkit-slider-thumb {
  transition: none !important;
  animation: none !important;
}
.action-btn {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.action-btn:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}
.action-btn .material-symbols-outlined {
  font-size: 14px;
}
.close-btn:hover {
  background: #e81123;
  color: #fff;
}
.queue-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  -webkit-app-region: no-drag;
}
.queue-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.queue-icon {
  font-size: 16px;
  color: #aaa;
}
.queue-title {
  font-size: 11px;
  color: #aaa;
  font-weight: 600;
}
.queue-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.queue-list::-webkit-scrollbar {
  width: 4px;
}
.queue-list::-webkit-scrollbar-track {
  background: transparent;
}
.queue-list::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 2px;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
  cursor: pointer;
}
.queue-item:hover {
  background: rgba(255,255,255,0.15);
}
.queue-item.playing {
  background: rgba(255,255,255,0.1);
}
.queue-thumb {
  width: 32px;
  height: 32px;
  border-radius: 3px;
  object-fit: cover;
}
.queue-thumb-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 3px;
  background: #333;
}
.queue-info {
  min-width: 0;
  flex: 1;
}
.queue-song {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.queue-artist {
  font-size: 9px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
</style>
