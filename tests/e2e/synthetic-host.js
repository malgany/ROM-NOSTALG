"use strict";

window.addEventListener("load", () => {
  // An invite copied from the synthetic host keeps this pathname. In that
  // case netplay.js has already initialized the guest view, so the synthetic
  // host must not reveal the player view on top of it.
  if (window.location.hash) return;

  document.querySelector("#picker-view").hidden = true;
  document.querySelector("#player-view").hidden = false;
  document.querySelector("#loading-overlay").classList.add("is-hidden");
  document.querySelector("#game-title").textContent = "ROM sintética de teste";

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  canvas.dataset.e2eSyntheticScreen = "true";
  document.querySelector("#game").append(canvas);

  const context2d = canvas.getContext("2d");
  let frame = 0;
  const paint = () => {
    frame += 1;
    context2d.fillStyle = `hsl(${frame % 360} 75% 45%)`;
    context2d.fillRect(0, 0, canvas.width, canvas.height);
    context2d.fillStyle = "white";
    context2d.font = "bold 28px sans-serif";
    context2d.fillText("ROM Nostalg E2E", 34, 125);
  };
  paint();
  window.__e2ePaintTimer = window.setInterval(paint, 33);

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const masterGain = audioContext.createGain();
  gain.gain.value = 0.01;
  oscillator.frequency.value = 220;
  oscillator.connect(gain).connect(masterGain).connect(audioContext.destination);
  oscillator.start();

  // Emscripten OpenAL rebuilds these connections when source routing changes.
  // The host still plays, but a recording attached to the source is detached.
  window.__e2eReconnectAudioSource = () => {
    gain.disconnect();
    gain.connect(masterGain);
  };
  window.__e2eSimulatedInputs = [];
  window.EJS_emulator = {
    canvas,
    Module: { AL: { currentCtx: { audioCtx: audioContext, gain: masterGain, sources: [{ gain }] } } },
    collectScreenRecordingMediaTracks(receivedCanvas, frameRate) {
      // Mirrors the source-level capture in EmulatorJS 4.2.3.
      const merger = audioContext.createChannelMerger(1);
      const destination = audioContext.createMediaStreamDestination();
      gain.connect(merger).connect(destination);
      return new MediaStream([
        ...receivedCanvas.captureStream(frameRate).getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
    },
    gameManager: {
      simulateInput(player, code, value) {
        window.__e2eSimulatedInputs.push({ player, code, value, at: performance.now() });
      },
    },
  };

  window.dispatchEvent(new CustomEvent("romnostalg:game-ready", {
    detail: { source: "catalog" },
  }));
});
