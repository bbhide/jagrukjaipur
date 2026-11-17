<script setup lang="ts">
/**
 * Door check-in scanner: rear camera -> canvas -> jsQR decode loop -> POST /api/organizer/checkin.
 * Layout inferred — the legacy organiser portal was not observable (see docs/01-reconnaissance.md §6).
 */
import { onBeforeUnmount, ref } from "vue";
import jsQR from "jsqr";
import { call, RequestError } from "@/scripts/http";

type Result =
  | { kind: "idle" }
  | { kind: "ok"; name: string; tier: string; event: string }
  | { kind: "duplicate"; name: string; at: string }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 2000;
const video = ref<HTMLVideoElement>();
const canvas = ref<HTMLCanvasElement>();
const status = ref<"stopped" | "starting" | "scanning" | "denied" | "unavailable">("stopped");
const detail = ref("");
const result = ref<Result>({ kind: "idle" });
const manual = ref("");
const busy = ref(false);

let stream: MediaStream | null = null;
let raf = 0;
let lastTick = 0;
let lastCode = "";
let lastAt = 0;
let audio: AudioContext | null = null;

function beep(kind: "ok" | "duplicate" | "invalid") {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
    // ok: one high pleasant tone; duplicate: two mid beeps; invalid: low long buzz.
    const tones: [number, number, number][] = kind === "ok" ? [[880, 0, 0.18]] : kind === "duplicate" ? [[520, 0, 0.12], [520, 0.18, 0.12]] : [[170, 0, 0.45]];
    for (const [freq, delay, len] of tones) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = kind === "invalid" ? "sawtooth" : "sine";
      osc.frequency.value = freq;
      const t0 = audio.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0); osc.stop(t0 + len + 0.02);
    }
    navigator.vibrate?.(kind === "ok" ? 60 : kind === "duplicate" ? [80, 60, 80] : 300);
  } catch { /* sound is a nice-to-have */ }
}

async function submit(code: string) {
  busy.value = true;
  try {
    const r = await call<any>("/organizer/checkin", { code });
    if (r.result === "ok") result.value = { kind: "ok", name: r.attendee_name, tier: r.tier, event: r.event_title };
    else if (r.result === "duplicate") result.value = { kind: "duplicate", name: r.attendee_name, at: r.checked_in_at ? new Date(r.checked_in_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "" };
    else result.value = { kind: "invalid" };
    beep(result.value.kind === "ok" ? "ok" : result.value.kind === "duplicate" ? "duplicate" : "invalid");
  } catch (e) {
    const msg = e instanceof RequestError && e.status === 401 ? "Your session expired. Please log in again." : e instanceof RequestError ? e.message : "Network error. Please try again.";
    result.value = { kind: "error", message: msg };
    beep("invalid");
  }
  busy.value = false;
}

function onCode(code: string) {
  const now = Date.now();
  if (busy.value || (code === lastCode && now - lastAt < DEBOUNCE_MS)) return;
  lastCode = code; lastAt = now;
  void submit(code);
}

function tick(ts: number) {
  raf = requestAnimationFrame(tick);
  const v = video.value, c = canvas.value;
  if (!v || !c || v.readyState < 2 || ts - lastTick < 120) return; // decode ~8x per second
  lastTick = ts;
  const scale = Math.min(1, 640 / v.videoWidth);
  const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
  if (c.width !== w) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(v, 0, 0, w, h);
  const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
  if (hit?.data) onCode(hit.data.trim());
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    status.value = "unavailable";
    detail.value = window.isSecureContext ? "This browser can't access the camera." : "The camera needs a secure (HTTPS) connection.";
    return;
  }
  status.value = "starting"; detail.value = "";
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)(); // created inside the tap so sound is allowed
    void audio.resume();
  } catch { /* ignore */ }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
    const v = video.value!;
    v.srcObject = stream;
    v.setAttribute("playsinline", "true");
    await v.play();
    status.value = "scanning";
    raf = requestAnimationFrame(tick);
  } catch (e: any) {
    stop();
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") { status.value = "denied"; detail.value = "Camera permission was denied. Allow camera access for this site in your browser settings, then try again — or enter ticket codes manually below."; }
    else { status.value = "unavailable"; detail.value = e?.name === "NotFoundError" ? "No camera was found on this device." : "The camera couldn't be started."; }
  }
}

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video.value) video.value.srcObject = null;
}

function stopScanning() { stop(); status.value = "stopped"; }

function submitManual() {
  const code = manual.value.trim();
  if (!code || busy.value) return;
  lastCode = code; lastAt = Date.now();
  void submit(code).then(() => { if (result.value.kind === "ok" || result.value.kind === "duplicate") manual.value = ""; });
}

onBeforeUnmount(() => { stop(); void audio?.close(); });
</script>

<template>
  <div>
    <div class="scan-frame">
      <video ref="video" muted playsinline></video>
      <canvas ref="canvas" hidden></canvas>
      <div v-if="status === 'scanning'" class="scan-reticle" aria-hidden="true"></div>
      <div v-if="status !== 'scanning'" class="scan-msg">
        <template v-if="status === 'stopped' || status === 'starting'">
          <div style="font-size:3rem">📷</div>
          <button type="button" class="btn btn-primary btn-lg" :disabled="status === 'starting'" @click="start">{{ status === 'starting' ? 'Starting camera…' : 'Start scanner' }}</button>
          <p class="org-note">Your browser will ask to use the camera.</p>
        </template>
        <template v-else>
          <div style="font-size:3rem">🚫</div>
          <p>{{ detail }}</p>
          <button v-if="status === 'denied'" type="button" class="btn btn-outline" @click="start">Try again</button>
        </template>
      </div>
    </div>
    <button v-if="status === 'scanning'" type="button" class="btn btn-outline btn-sm" style="margin-top:0.75rem" @click="stopScanning">Stop camera</button>

    <div class="scan-result" :class="result.kind === 'error' ? 'invalid' : result.kind" role="status" aria-live="assertive">
      <template v-if="result.kind === 'idle'"><p>{{ busy ? 'Checking…' : 'Waiting for a ticket…' }}</p></template>
      <template v-else-if="result.kind === 'ok'">
        <div class="big">✅</div><h2>Valid ticket</h2><p><strong>{{ result.name }}</strong></p><p>{{ result.tier }} · {{ result.event }}</p>
      </template>
      <template v-else-if="result.kind === 'duplicate'">
        <div class="big">⚠️</div><h2>Already checked in</h2><p><strong>{{ result.name }}</strong></p><p v-if="result.at">Entered at {{ result.at }}</p>
      </template>
      <template v-else-if="result.kind === 'invalid'">
        <div class="big">⛔</div><h2>Invalid ticket</h2><p>This code isn't a valid ticket for your events.</p>
      </template>
      <template v-else>
        <div class="big">⚠️</div><h2>Couldn't check</h2><p>{{ result.message }}</p>
      </template>
    </div>

    <form class="scan-manual" @submit.prevent="submitManual">
      <input class="form-input" v-model="manual" placeholder="Enter ticket code manually" autocomplete="off" autocapitalize="characters" maxlength="300" aria-label="Ticket code" />
      <button class="btn btn-primary" type="submit" :disabled="busy || !manual.trim()">Check in</button>
    </form>
  </div>
</template>
