// Toque sintetizado via Web Audio API -- evita depender de um arquivo de áudio externo
// (licenciamento, tamanho do bundle). Padrão de dois tons alternados imitando campainha de
// telefone antigo: 950Hz/1400Hz, 1.2s tocando, 0.6s de silêncio, em loop até stopRingtone().

let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let playing = false;

const TONE_A = 950;
const TONE_B = 1400;
const RING_MS = 1200;
const GAP_MS = 600;

function ring(ctx: AudioContext) {
  const now = ctx.currentTime;
  const duration = RING_MS / 1000;

  [TONE_A, TONE_B].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;

    // Envelope curto no início/fim pra não estalar, volume alto (0.35 por oscilador,
    // dois somados dão um toque bem audível sem distorcer).
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.setValueAtTime(0.35, now + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.15); // leve defasagem entre os dois tons, mais parecido com campainha
    osc.stop(now + duration);
  });
}

export function startRingtone() {
  if (playing) return;
  playing = true;
  audioCtx = new AudioContext();
  ring(audioCtx);
  intervalId = setInterval(() => {
    if (audioCtx) ring(audioCtx);
  }, RING_MS + GAP_MS);
}

export function stopRingtone() {
  playing = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

export function isRinging() {
  return playing;
}
