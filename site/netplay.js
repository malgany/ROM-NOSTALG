"use strict";

(function initializeNetplay() {
  const core = window.ROMNostalgNetplayCore;
  const profiles = window.ROMNostalgControlProfiles;
  const config = Object.freeze({
    apiUrl: String(window.ROM_NOSTALG_NETPLAY_CONFIG?.apiUrl || "").trim(),
    turnstileSiteKey: String(window.ROM_NOSTALG_NETPLAY_CONFIG?.turnstileSiteKey || "").trim(),
    forceRelay: window.ROM_NOSTALG_NETPLAY_CONFIG?.forceRelay === true,
  });

  if (!core) {
    console.error("ROM Nostalg netplay core was not loaded.");
    return;
  }

  const TERMINAL_SIGNAL_ERRORS = new Set([
    "authentication_failed",
    "authentication_required",
    "authentication_timeout",
    "expired",
    "host_ended",
    "host_timeout",
    "invalid_token",
    "not_found",
    "origin_not_allowed",
    "room_closed",
    "room_expired",
    "room_full",
    "room_not_found",
    "unauthorized",
  ]);
  const SIGNAL_RECONNECT_MAX_MS = 15_000;
  const CONTROL_SNAPSHOT_MS = 250;
  const CONTROL_TIMEOUT_MS = 500;
  const VIDEO_MAX_BITRATE = 2_000_000;
  const GUEST_BINDINGS_STORAGE_KEY = "rom-nostalg-guest-bindings-v1";
  const GUEST_VOLUME_STORAGE_KEY = "rom-nostalg-guest-volume-v1";
  function defaultGuestBindings() {
    const keyboard = Array(core.INPUT_COUNT).fill("");
    const gamepad = Array(core.INPUT_COUNT).fill(-1);
    for (const [code, input] of Object.entries(core.KEYBOARD_CODE_TO_INPUT)) keyboard[input] = code;
    for (const [button, input] of Object.entries(core.GAMEPAD_BUTTON_TO_INPUT)) gamepad[input] = Number(button);
    return { keyboard, gamepad, layoutVersion: 2 };
  }

  function normalizeGuestBindings(value) {
    const defaults = defaultGuestBindings();
    if (!value || typeof value !== "object") return defaults;
    const usedKeys = new Set();
    const usedButtons = new Set();
    const keyboard = defaults.keyboard.map((fallback, input) => {
      const candidate = value.keyboard?.[input];
      const code = typeof candidate === "string" && (!candidate || /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(candidate)) ? candidate : fallback;
      if (!code || usedKeys.has(code)) return "";
      usedKeys.add(code);
      return code;
    });
    const gamepad = defaults.gamepad.map((fallback, input) => {
      const raw = value.gamepad?.[input];
      const candidate = Number(raw);
      const button = typeof raw === "string" && /^axis:\d{1,2}:(-1|1)$/.test(raw) ? raw
        : Number.isInteger(candidate) && candidate >= -1 && candidate < 64 ? candidate : fallback;
      if (button < 0 || usedButtons.has(button)) return -1;
      usedButtons.add(button);
      return button;
    });
    // Migrate the old default once, without replacing custom face bindings or
    // keyboard/shoulder/directional choices saved in the same preferences.
    if (value.layoutVersion !== 2
      && gamepad[0] === 1 && gamepad[1] === 3 && gamepad[8] === 0 && gamepad[9] === 2) {
      for (const input of [0, 1, 8, 9]) gamepad[input] = defaults.gamepad[input];
    }
    return { keyboard, gamepad, layoutVersion: 2 };
  }

  function guestBindingMaps(bindings) {
    const keyboard = {};
    const gamepad = {};
    bindings.keyboard.forEach((code, input) => { if (code) keyboard[code] = input; });
    const axes = {};
    bindings.gamepad.forEach((button, input) => {
      if (typeof button === "string") axes[button] = input;
      else if (button >= 0) gamepad[button] = input;
    });
    // Keep the usual left-stick directional fallback, respecting remaps/clear.
    for (const [axis, button] of [["axis:0:-1", 14], ["axis:0:1", 15], ["axis:1:-1", 12], ["axis:1:1", 13]]) {
      if (axes[axis] === undefined && gamepad[button] !== undefined) axes[axis] = gamepad[button];
    }
    return { keyboard, gamepad, axes };
  }

  function apiEndpoint(path) {
    if (!config.apiUrl) {
      throw new Error("O multiplayer ainda não foi configurado neste site.");
    }

    let base;
    try {
      base = new URL(config.apiUrl);
    } catch {
      throw new Error("A URL pública do serviço multiplayer é inválida.");
    }

    if (base.protocol !== "https:"
      && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
      throw new Error("O serviço multiplayer precisa usar HTTPS.");
    }

    return `${base.toString().replace(/\/+$/, "")}${path}`;
  }

  function websocketEndpoint(path) {
    const endpoint = new URL(apiEndpoint(path));
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    return endpoint.toString();
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(apiEndpoint(path), options);
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      // An empty response is valid when a room is deleted.
    }

    if (!response.ok) {
      const details = core.apiErrorDetails(payload, response.status);
      const error = new Error(details.message);
      error.code = details.code;
      throw error;
    }

    return payload;
  }

  function authorizationHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function fetchIceServers(roomId, token) {
    const payload = await apiRequest(`/v1/rooms/${encodeURIComponent(roomId)}/ice`, {
      method: "POST",
      headers: authorizationHeaders(token),
      body: "{}",
    });

    let servers = payload?.iceServers;
    if (servers && !Array.isArray(servers) && Array.isArray(servers.iceServers)) {
      servers = servers.iceServers;
    }
    if (!Array.isArray(servers) && servers?.urls) {
      servers = [servers];
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error("O serviço não forneceu servidores STUN/TURN válidos.");
    }

    return servers;
  }

  function parseJsonMessage(data) {
    if (typeof data !== "string" || data.length > 128_000) {
      return null;
    }

    try {
      const value = JSON.parse(data);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  class SignalingSocket {
    constructor({ roomId, role, token, onAuthenticated, onMessage, onState, onError }) {
      this.roomId = roomId;
      this.role = role;
      this.token = token;
      this.onAuthenticated = onAuthenticated;
      this.onMessage = onMessage;
      this.onState = onState;
      this.onError = onError;
      this.socket = null;
      this.authenticated = false;
      this.closed = false;
      this.reconnectAttempt = 0;
      this.reconnectTimer = 0;
      this.authTimer = 0;
      this.generation = 0;
    }

    connect() {
      if (this.closed) return;

      window.clearTimeout(this.reconnectTimer);
      const generation = ++this.generation;
      const socket = new WebSocket(websocketEndpoint(`/v1/rooms/${encodeURIComponent(this.roomId)}/ws`));
      this.socket = socket;
      this.authenticated = false;
      this.onState?.(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

      socket.addEventListener("open", () => {
        if (this.closed || generation !== this.generation) return;
        socket.send(JSON.stringify({ type: "auth", role: this.role, token: this.token }));
        this.authTimer = window.setTimeout(() => {
          if (!this.authenticated && socket.readyState === WebSocket.OPEN) {
            socket.close(4001, "authentication timeout");
          }
        }, 5000);
      });

      socket.addEventListener("message", (event) => {
        if (this.closed || generation !== this.generation) return;
        const message = parseJsonMessage(event.data);
        if (!message) return;

        if (message.type === "authenticated") {
          const wasReconnect = this.reconnectAttempt > 0;
          window.clearTimeout(this.authTimer);
          this.authenticated = true;
          this.reconnectAttempt = 0;
          this.onState?.("authenticated");
          this.onAuthenticated?.(message, wasReconnect);
          return;
        }

        if (message.type === "error") {
          const error = new Error(message.message || "A sinalização multiplayer encontrou um erro.");
          error.code = message.code || "signal_error";
          this.onError?.(error);
          if (TERMINAL_SIGNAL_ERRORS.has(error.code)) {
            this.close();
          }
          return;
        }

        if (this.authenticated) {
          this.onMessage?.(message);
        }
      });

      socket.addEventListener("close", (event) => {
        if (generation !== this.generation) return;
        window.clearTimeout(this.authTimer);
        this.authenticated = false;
        if (this.closed) return;
        if (event.code >= 4000 && event.code <= 4999) {
          const messages = {
            host_ended: "A sala foi encerrada pelo host.",
            host_timeout: "O host ficou ausente e a sala expirou.",
            room_expired: "Este convite expirou.",
          };
          const error = new Error(messages[event.reason] || "A sala multiplayer foi encerrada.");
          error.code = event.reason || "room_closed";
          this.onError?.(error);
          this.close();
          return;
        }
        this.onState?.("reconnecting");
        const delay = Math.min(500 * (2 ** this.reconnectAttempt), SIGNAL_RECONNECT_MAX_MS);
        this.reconnectAttempt += 1;
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      });

      socket.addEventListener("error", () => {
        if (!this.closed && generation === this.generation) {
          this.onState?.("reconnecting");
        }
      });
    }

    send(message) {
      if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) {
        return false;
      }

      this.socket.send(JSON.stringify(message));
      return true;
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.generation += 1;
      window.clearTimeout(this.authTimer);
      window.clearTimeout(this.reconnectTimer);
      if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
        this.socket.close(1000, "leaving room");
      }
      this.socket = null;
    }
  }

  async function configureVideoSender(sender) {
    if (!sender || sender.track?.kind !== "video" || typeof sender.getParameters !== "function") {
      return;
    }

    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) {
        parameters.encodings = [{}];
      }
      parameters.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
      parameters.encodings[0].maxFramerate = 60;
      await sender.setParameters(parameters);
    } catch (error) {
      console.warn("Não foi possível limitar o bitrate do vídeo WebRTC.", error);
    }
  }

  const captureCleanups = new WeakMap();

  function stopEmulatorStream(stream) {
    if (!stream) return;
    captureCleanups.get(stream)?.();
    captureCleanups.delete(stream);
    stream.getTracks().forEach((track) => track.stop());
  }

  async function captureEmulatorStream() {
    const emulator = window.EJS_emulator;
    const canvas = emulator?.canvas || document.querySelector("#game canvas");

    if (!emulator || !canvas || typeof canvas.captureStream !== "function") {
      throw new Error("Esta versão do emulador/navegador não oferece captura compatível com multiplayer.");
    }

    const alContext = emulator.Module?.AL?.currentCtx;
    const audioContext = alContext?.audioCtx;
    const output = alContext?.gain;
    if (!audioContext || typeof output?.connect !== "function") {
      throw new Error("O áudio do jogo ainda não está disponível. Volte ao jogo, ative o som e tente novamente.");
    }
    if (audioContext?.state === "suspended") {
      try {
        await audioContext.resume();
      } catch {
        // The explicit video/audio checks below provide the actionable error.
      }
    }

    if (audioContext.state !== "running") {
      throw new Error("O áudio do jogo está suspenso. Volte ao jogo, ative o som e tente novamente.");
    }

    let stream;
    let destination;
    try {
      stream = canvas.captureStream(60);
      destination = audioContext.createMediaStreamDestination();
      // The pinned SNES core reconnects individual OpenAL source gains, which
      // detaches EmulatorJS's recorder taps. Capture the stable final mix instead,
      // preserving stereo and the existing connection to the host's speakers.
      output.connect(destination);
      captureCleanups.set(stream, () => {
        try { output.disconnect(destination); } catch { /* context already closed */ }
        destination.disconnect();
      });
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    } catch (error) {
      stopEmulatorStream(stream);
      destination?.stream.getTracks().forEach((track) => track.stop());
      console.error(error);
      throw new Error("Não foi possível capturar a tela e o áudio do emulador.");
    }

    if (!stream?.getVideoTracks?.().length) {
      stopEmulatorStream(stream);
      throw new Error("O navegador não conseguiu capturar o vídeo do jogo.");
    }

    if (!stream.getAudioTracks().length) {
      stopEmulatorStream(stream);
      throw new Error("O áudio do jogo ainda não está disponível. Volte ao jogo, ative o som e tente novamente.");
    }

    return stream;
  }

  function peerConfiguration(iceServers) {
    return {
      iceServers,
      iceTransportPolicy: config.forceRelay ? "relay" : "all",
      bundlePolicy: "max-bundle",
    };
  }

  class HostSession {
    constructor(room, callbacks) {
      this.room = room;
      this.callbacks = callbacks;
      this.iceServers = [];
      this.stream = null;
      this.socket = null;
      this.peer = null;
      this.controlChannel = null;
      this.remoteMask = 0;
      this.lastInputSequence = null;
      this.controlTimeout = 0;
      this.disconnectTimer = 0;
      this.pendingCandidates = [];
      this.makingOffer = false;
      this.pendingNegotiation = false;
      this.closed = false;
      this.deleteStarted = false;
    }

    async start() {
      const stream = await captureEmulatorStream();
      let iceServers;
      try {
        iceServers = await fetchIceServers(this.room.roomId, this.room.hostToken);
      } catch (error) {
        stopEmulatorStream(stream);
        throw error;
      }
      if (this.closed) {
        stopEmulatorStream(stream);
        return;
      }

      this.iceServers = iceServers;
      this.stream = stream;
      this.socket = new SignalingSocket({
        roomId: this.room.roomId,
        role: "host",
        token: this.room.hostToken,
        onAuthenticated: (message, wasReconnect) => this.onAuthenticated(message, wasReconnect),
        onMessage: (message) => void this.onSignalMessage(message),
        onState: (state) => this.onSignalState(state),
        onError: (error) => {
          if (error.code === "peer_unavailable") {
            this.closePeer();
            this.callbacks.onState("waiting", "Aguardando o Player 2 reconectar…");
          } else {
            if (TERMINAL_SIGNAL_ERRORS.has(error.code)) {
              void this.leave({ closeRoom: false });
            }
            this.callbacks.onError(error);
          }
        },
      });
      this.socket.connect();
    }

    onSignalState(state) {
      if (state === "reconnecting") {
        this.callbacks.onState("reconnecting", "Reconectando a sinalização…");
      } else if (state === "connecting") {
        this.callbacks.onState("waiting", "Conectando a sala…");
      }
    }

    onAuthenticated(message, wasReconnect) {
      if (message.peerConnected) {
        this.callbacks.onState("connecting", "Player 2 encontrado. Conectando…");
        void this.negotiate(wasReconnect || Boolean(this.peer));
      } else {
        this.callbacks.onState("waiting", "Sala pronta. Aguardando o Player 2…");
      }
    }

    async onSignalMessage(message) {
      if (message.type === "peer-joined") {
        this.callbacks.onState("connecting", "Player 2 entrou. Conectando…");
        await this.negotiate(Boolean(this.peer));
        return;
      }

      if (message.type === "peer-left") {
        this.closePeer();
        this.callbacks.onState("waiting", "Player 2 saiu. O link continua válido.");
        return;
      }

      if (message.type !== "signal" || !["answer", "ice"].includes(message.kind)) {
        return;
      }

      try {
        if (message.kind === "answer") {
          if (!this.peer || !message.payload?.type || !message.payload?.sdp) return;
          await this.peer.setRemoteDescription(message.payload);
          await this.flushCandidates();
        } else if (message.payload) {
          if (this.peer?.remoteDescription) {
            await this.peer.addIceCandidate(message.payload);
          } else {
            this.pendingCandidates.push(message.payload);
          }
        }
      } catch (error) {
        console.error(error);
        this.callbacks.onError(new Error("Falha ao negociar a conexão WebRTC com o Player 2."));
      }
    }

    setupPeer() {
      if (this.peer && this.peer.signalingState !== "closed") {
        return this.peer;
      }

      const peer = new RTCPeerConnection(peerConfiguration(this.iceServers));
      this.peer = peer;
      this.pendingCandidates = [];

      for (const track of this.stream.getTracks()) {
        const sender = peer.addTrack(track, this.stream);
        if (track.kind === "video") void configureVideoSender(sender);
      }

      this.setControlChannel(peer.createDataChannel("p2-controls", {
        ordered: false,
        maxRetransmits: 0,
      }));

      peer.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          this.socket?.send({
            type: "signal",
            kind: "ice",
            payload: event.candidate.toJSON?.() || event.candidate,
          });
        }
      });

      peer.addEventListener("connectionstatechange", () => {
        window.clearTimeout(this.disconnectTimer);
        if (peer.connectionState === "connected") {
          this.callbacks.onState("connected", "Player 2 conectado");
        } else if (peer.connectionState === "connecting") {
          this.callbacks.onState("connecting", "Estabelecendo transmissão…");
        } else if (peer.connectionState === "disconnected") {
          this.callbacks.onState("reconnecting", "Conexão instável. Tentando recuperar…");
          this.disconnectTimer = window.setTimeout(() => {
            if (this.peer === peer && peer.connectionState === "disconnected") {
              void this.negotiate(true);
            }
          }, 3000);
        } else if (peer.connectionState === "failed") {
          this.callbacks.onState("reconnecting", "Reiniciando a conexão WebRTC…");
          void this.negotiate(true);
        }
      });

      return peer;
    }

    async negotiate(iceRestart = false) {
      if (this.closed || this.makingOffer) return;
      if (!this.socket?.authenticated) {
        this.pendingNegotiation = true;
        return;
      }

      this.makingOffer = true;
      this.pendingNegotiation = false;
      try {
        const peer = this.setupPeer();
        if (peer.signalingState === "have-local-offer") {
          await peer.setLocalDescription({ type: "rollback" });
        }
        const offer = await peer.createOffer({ iceRestart });
        await peer.setLocalDescription(offer);
        if (!this.socket.send({ type: "signal", kind: "offer", payload: peer.localDescription })) {
          this.pendingNegotiation = true;
        }
      } catch (error) {
        console.error(error);
        this.callbacks.onError(new Error("Não foi possível iniciar a transmissão WebRTC."));
      } finally {
        this.makingOffer = false;
      }
    }

    async flushCandidates() {
      if (!this.peer?.remoteDescription) return;
      const candidates = this.pendingCandidates.splice(0);
      for (const candidate of candidates) {
        await this.peer.addIceCandidate(candidate);
      }
    }

    setControlChannel(channel) {
      if (this.controlChannel && this.controlChannel !== channel) {
        this.controlChannel.close();
      }
      this.controlChannel = channel;
      channel.addEventListener("message", (event) => this.onControlMessage(event.data));
      channel.addEventListener("close", () => this.releaseRemoteInputs());
      channel.addEventListener("error", () => this.releaseRemoteInputs());
    }

    onControlMessage(data) {
      const packet = core.normalizeInputPacket(parseJsonMessage(data));
      if (!packet || !core.isNewerSequence(packet.seq, this.lastInputSequence)) {
        return;
      }

      this.lastInputSequence = packet.seq;
      window.clearTimeout(this.controlTimeout);
      this.controlTimeout = window.setTimeout(
        () => this.releaseRemoteInputs({ resetSequence: false }),
        CONTROL_TIMEOUT_MS,
      );
      this.applyRemoteMask(packet.mask);
    }

    applyRemoteMask(mask) {
      const gameManager = window.EJS_emulator?.gameManager;
      const simulateInput = gameManager?.simulateInput;
      if (typeof simulateInput !== "function") {
        this.callbacks.onError(new Error("O emulador não disponibilizou os controles do Player 2."));
        this.releaseRemoteInputs();
        return;
      }

      const result = core.applyInputMaskSafely(
        this.remoteMask,
        mask,
        (player, code, value) => simulateInput.call(gameManager, player, code, value),
      );
      this.remoteMask = result.mask;
      if (!result.ok) {
        console.error("Falha ao aplicar o controle remoto do Player 2.", result.error);
        window.clearTimeout(this.controlTimeout);
        this.callbacks.onError(new Error("O emulador recusou um comando do controle do Player 2."));
      }
    }

    releaseRemoteInputs({ resetSequence = true } = {}) {
      window.clearTimeout(this.controlTimeout);
      const gameManager = window.EJS_emulator?.gameManager;
      const simulateInput = gameManager?.simulateInput;
      this.remoteMask = 0;
      if (resetSequence) this.lastInputSequence = null;
      if (typeof simulateInput === "function") {
        const result = core.releaseAllInputsSafely(
          (player, code, value) => simulateInput.call(gameManager, player, code, value),
        );
        if (!result.ok) {
          console.warn("Nem todos os botões do Player 2 puderam ser liberados.", result.error);
        }
      }
    }

    closePeer() {
      window.clearTimeout(this.disconnectTimer);
      this.releaseRemoteInputs();
      if (this.controlChannel) {
        try { this.controlChannel.close(); } catch { /* already closed */ }
      }
      if (this.peer) {
        try { this.peer.close(); } catch { /* already closed */ }
      }
      this.controlChannel = null;
      this.peer = null;
      this.pendingCandidates = [];
    }

    deleteRoom(keepalive = false) {
      if (this.deleteStarted) return Promise.resolve();
      this.deleteStarted = true;
      const abortController = keepalive ? null : new AbortController();
      const abortTimer = abortController
        ? window.setTimeout(() => abortController.abort(), 4000)
        : 0;
      return apiRequest(`/v1/rooms/${encodeURIComponent(this.room.roomId)}`, {
        method: "DELETE",
        headers: authorizationHeaders(this.room.hostToken),
        keepalive,
        signal: abortController?.signal,
      }).catch((error) => {
        if (!keepalive) throw error;
      }).finally(() => {
        window.clearTimeout(abortTimer);
      });
    }

    async leave({ closeRoom = true, keepalive = false } = {}) {
      if (this.closed) return;
      this.closed = true;
      const deletion = closeRoom ? this.deleteRoom(keepalive) : Promise.resolve();
      this.socket?.close();
      this.closePeer();
      stopEmulatorStream(this.stream);
      this.stream = null;
      await deletion;
    }
  }

  class InputTransmitter {
    constructor(send, onControllerState, inputBindings, getGamepad) {
      this.send = send;
      this.onControllerState = onControllerState;
      this.inputBindings = inputBindings;
      this.getGamepad = getGamepad;
      this.suspended = false;
      this.keys = new Set();
      this.touchMask = 0;
      this.mask = 0;
      this.sequence = 0xffff_ffff;
      this.snapshotTimer = 0;
      this.animationFrame = 0;
      this.running = false;
      this.gamepadLabel = "";
      this.onKeyDown = (event) => this.keyChanged(event, true);
      this.onKeyUp = (event) => this.keyChanged(event, false);
      this.onBlur = () => this.clearKeyboard();
      this.onVisibility = () => {
        if (document.hidden) this.clearKeyboard();
      };
    }

    start() {
      if (this.running) return;
      this.running = true;
      window.addEventListener("keydown", this.onKeyDown, true);
      window.addEventListener("keyup", this.onKeyUp, true);
      window.addEventListener("blur", this.onBlur);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.snapshotTimer = window.setInterval(() => this.transmit(true), CONTROL_SNAPSHOT_MS);
      this.pollGamepad();
      this.transmit(true);
    }

    keyChanged(event, isPressed) {
      if (this.suspended || !Object.hasOwn(this.inputBindings.keyboard, event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isPressed) this.keys.add(event.code);
      else this.keys.delete(event.code);
      this.refreshMask();
    }

    clearKeyboard() {
      if (this.keys.size === 0) return;
      this.keys.clear();
      this.refreshMask();
    }

    pollGamepad() {
      if (!this.running) return;
      const gamepad = this.getGamepad();
      const label = gamepad ? `Controle conectado: ${gamepad.id}` : "Teclado pronto para o Player 2";
      if (label !== this.gamepadLabel) {
        this.gamepadLabel = label;
        this.onControllerState(label, Boolean(gamepad), gamepad ? { id: gamepad.id } : null);
      }
      this.refreshMask(gamepad);
      this.animationFrame = window.requestAnimationFrame(() => this.pollGamepad());
    }

    refreshMask(gamepad) {
      const currentGamepad = gamepad === undefined ? this.getGamepad() : gamepad;
      const nextMask = this.suspended ? 0 : core.maskFromKeyboardCodes(this.keys, this.inputBindings.keyboard)
        | core.maskFromGamepad(currentGamepad, this.inputBindings.gamepad, this.inputBindings.axes)
        | this.touchMask;
      if (nextMask !== this.mask) {
        this.mask = nextMask;
        this.transmit(false);
      }
    }

    setTouchMask(mask) {
      if (!this.running) return;
      this.touchMask = mask;
      this.refreshMask();
    }

    setSuspended(suspended) {
      this.suspended = suspended;
      this.keys.clear();
      this.touchMask = 0;
      this.refreshMask();
    }

    transmit(force) {
      if (!this.running && !force) return;
      this.sequence = (this.sequence + 1) >>> 0;
      this.send(core.createInputPacket(this.sequence, this.mask));
    }

    setInputBindings(inputBindings, preserveKeys = false) {
      if (!preserveKeys) this.keys.clear();
      this.mask = 0;
      this.transmit(true);
      this.inputBindings = inputBindings;
      this.refreshMask();
    }

    stop() {
      if (!this.running) return;
      this.keys.clear();
      this.touchMask = 0;
      this.mask = 0;
      this.transmit(true);
      this.running = false;
      window.clearInterval(this.snapshotTimer);
      window.cancelAnimationFrame(this.animationFrame);
      window.removeEventListener("keydown", this.onKeyDown, true);
      window.removeEventListener("keyup", this.onKeyUp, true);
      window.removeEventListener("blur", this.onBlur);
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onControllerState("Teclado ou controle USB", false, null);
    }
  }

  class GuestSession {
    constructor(invite, callbacks) {
      this.invite = invite;
      this.callbacks = callbacks;
      this.iceServers = [];
      this.socket = null;
      this.peer = null;
      this.channel = null;
      this.transmitter = null;
      this.inputSequence = 0xffff_ffff;
      this.pendingCandidates = [];
      this.remoteStream = null;
      this.connectionInterrupted = false;
      this.inputBindings = callbacks.inputBindings;
      this.closed = false;
    }

    async start() {
      this.iceServers = await fetchIceServers(this.invite.roomId, this.invite.token);
      if (this.closed) return;
      this.socket = new SignalingSocket({
        roomId: this.invite.roomId,
        role: "guest",
        token: this.invite.token,
        onAuthenticated: (message) => this.onAuthenticated(message),
        onMessage: (message) => void this.onSignalMessage(message),
        onState: (state) => this.onSignalState(state),
        onError: (error) => {
          if (TERMINAL_SIGNAL_ERRORS.has(error.code)) this.leave();
          this.callbacks.onError(error);
        },
      });
      this.socket.connect();
    }

    onSignalState(state) {
      if (state === "connecting") {
        this.callbacks.onState("connecting", "Entrando na sala…");
      } else if (state === "reconnecting") {
        this.callbacks.onState("reconnecting", "Reconectando a sinalização…");
      }
    }

    onAuthenticated(message) {
      this.callbacks.onState(
        message.peerConnected ? "connecting" : "waiting",
        message.peerConnected ? "Conectando ao host…" : "Aguardando o host…",
      );
    }

    async onSignalMessage(message) {
      if (message.type === "peer-left") {
        this.closePeer();
        this.callbacks.onState("waiting", "O host saiu da sala.");
        return;
      }

      if (message.type !== "signal" || !["offer", "ice"].includes(message.kind)) {
        return;
      }

      try {
        if (message.kind === "offer") {
          if (!message.payload?.type || !message.payload?.sdp) return;
          const peer = this.setupPeer();
          await peer.setRemoteDescription(message.payload);
          await this.flushCandidates();
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.socket?.send({ type: "signal", kind: "answer", payload: peer.localDescription });
        } else if (message.payload) {
          if (this.peer?.remoteDescription) {
            await this.peer.addIceCandidate(message.payload);
          } else {
            this.pendingCandidates.push(message.payload);
          }
        }
      } catch (error) {
        console.error(error);
        this.callbacks.onError(new Error("Falha ao negociar a conexão WebRTC com o host."));
      }
    }

    setupPeer() {
      if (this.peer && this.peer.signalingState !== "closed") {
        return this.peer;
      }

      const peer = new RTCPeerConnection(peerConfiguration(this.iceServers));
      this.peer = peer;

      peer.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          this.socket?.send({
            type: "signal",
            kind: "ice",
            payload: event.candidate.toJSON?.() || event.candidate,
          });
        }
      });

      peer.addEventListener("track", (event) => {
        if (event.streams?.[0]) {
          this.remoteStream = event.streams[0];
        } else {
          if (!this.remoteStream) this.remoteStream = new MediaStream();
          this.remoteStream.addTrack(event.track);
        }
        this.callbacks.onStream(this.remoteStream);
      });

      peer.addEventListener("datachannel", (event) => {
        if (event.channel.label === "p2-controls") {
          this.setControlChannel(event.channel);
        } else {
          event.channel.close();
        }
      });

      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "connected") {
          if (this.connectionInterrupted) {
            this.startTransmitter();
            if (this.remoteStream) {
              this.callbacks.onStream(this.remoteStream);
            }
          }
          this.connectionInterrupted = false;
          this.callbacks.onState("connected", "Conectado ao jogo");
        } else if (peer.connectionState === "connecting") {
          this.callbacks.onState("connecting", "Recebendo a transmissão…");
        } else if (["disconnected", "failed"].includes(peer.connectionState)) {
          this.connectionInterrupted = true;
          this.stopTransmitter();
          this.callbacks.onState("reconnecting", "Conexão interrompida. Tentando recuperar…");
        }
      });

      return peer;
    }

    async flushCandidates() {
      if (!this.peer?.remoteDescription) return;
      const candidates = this.pendingCandidates.splice(0);
      for (const candidate of candidates) {
        await this.peer.addIceCandidate(candidate);
      }
    }

    setControlChannel(channel) {
      this.channel?.close();
      this.channel = channel;
      channel.addEventListener("open", () => this.startTransmitter());
      channel.addEventListener("close", () => this.stopTransmitter());
      channel.addEventListener("error", () => this.stopTransmitter());
      if (channel.readyState === "open") this.startTransmitter();
    }

    startTransmitter() {
      if (this.transmitter || this.channel?.readyState !== "open") return;
      this.transmitter = new InputTransmitter(
        (packet) => {
          if (this.channel?.readyState === "open") {
            this.channel.send(JSON.stringify(packet));
          }
        },
        (label, connected, gamepad) => this.callbacks.onControllerState(label, connected, gamepad),
        this.inputBindings,
        this.callbacks.getGamepad,
      );
      // Keep ordering across interruptions; the host rejects older snapshots.
      this.transmitter.sequence = this.inputSequence;
      // Reconnecting while settings are open must also suppress the first packet.
      this.transmitter.setSuspended(this.callbacks.inputSuspended());
      this.transmitter.start();
      this.callbacks.onInputReady(true);
    }

    setInputBindings(inputBindings, preserveKeys = false) {
      this.inputBindings = inputBindings;
      this.transmitter?.setInputBindings(inputBindings, preserveKeys);
    }

    stopTransmitter() {
      this.callbacks.onInputReady(false);
      this.transmitter?.stop();
      if (this.transmitter) this.inputSequence = this.transmitter.sequence;
      this.transmitter = null;
    }

    closePeer() {
      this.stopTransmitter();
      try { this.channel?.close(); } catch { /* already closed */ }
      try { this.peer?.close(); } catch { /* already closed */ }
      this.channel = null;
      this.peer = null;
      this.pendingCandidates = [];
      this.remoteStream = null;
      this.callbacks.onStream(null);
    }

    leave() {
      if (this.closed) return;
      this.closed = true;
      this.socket?.close();
      this.closePeer();
    }
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (loadTurnstile.promise) return loadTurnstile.promise;

    loadTurnstile.promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", () => resolve(window.turnstile));
      script.addEventListener("error", () => reject(new Error("Não foi possível carregar a verificação do Cloudflare.")));
      document.head.append(script);
    });
    return loadTurnstile.promise;
  }

  class NetplayController {
    constructor() {
      this.invite = core.parseInviteHash(window.location.hash);
      this.hostSession = null;
      this.guestSession = null;
      this.turnstileToken = "";
      this.turnstileWidget = null;
      this.room = null;
      this.catalogGameReady = false;

      this.pickerView = document.querySelector("#picker-view");
      this.playerView = document.querySelector("#player-view");
      this.guestView = document.querySelector("#guest-view");
      this.multiplayerButton = document.querySelector("#multiplayer-button");
      this.multiplayerDialog = document.querySelector("#multiplayer-dialog");
      this.createPanel = document.querySelector("#multiplayer-create-panel");
      this.roomPanel = document.querySelector("#multiplayer-room-panel");
      this.createRoomButton = document.querySelector("#create-room-button");
      this.multiplayerStatus = document.querySelector("#multiplayer-status");
      this.hostStatus = document.querySelector("#host-status");
      this.hostStatusDot = document.querySelector("#host-status-dot");
      this.hostSessionError = document.querySelector("#host-session-error");
      this.inviteLink = document.querySelector("#invite-link");
      this.roomExpiration = document.querySelector("#room-expiration");
      this.guestVideo = document.querySelector("#guest-video");
      this.guestPlaceholder = document.querySelector("#guest-placeholder");
      this.guestStatus = document.querySelector("#guest-status");
      this.guestStatusDot = document.querySelector("#guest-status-dot");
      this.guestControlState = document.querySelector("#guest-control-state");
      this.guestEnterButton = document.querySelector("#guest-enter-button");
      this.guestResumeButton = document.querySelector("#guest-resume-button");
      this.guestControlsButton = document.querySelector("#guest-controls-button");
      this.guestControlsDialog = document.querySelector("#guest-controls-dialog");
      this.guestBindingsBody = document.querySelector("#guest-bindings-body");
      this.guestAudioButton = document.querySelector("#guest-audio-button");
      this.guestVolumeInput = document.querySelector("#guest-volume");
      this.guestFullscreenButton = document.querySelector("#guest-fullscreen-button");
      this.guestMobileFullscreenButton = document.querySelector("#guest-mobile-fullscreen-button");
      this.guestBindings = this.loadGuestBindings();
      this.guestVolume = this.loadGuestVolume();
      this.guestPlaybackAttempt = 0;

      this.bindCommonEvents();
      if (this.invite) this.initializeGuestView();
      else this.initializeHostUi();
    }

    browserSupported() {
      return typeof window.RTCPeerConnection === "function"
        && typeof window.WebSocket === "function"
        && typeof window.MediaStream === "function";
    }

    bindCommonEvents() {
      window.addEventListener("pagehide", () => {
        if (this.hostSession) void this.hostSession.leave({ closeRoom: true, keepalive: true });
        this.guestSession?.leave();
      });
    }

    initializeHostUi() {
      window.addEventListener("romnostalg:game-ready", (event) => {
        this.catalogGameReady = event.detail?.source === "catalog";
        this.multiplayerButton.hidden = !this.catalogGameReady;
        this.multiplayerButton.disabled = !this.catalogGameReady || !this.browserSupported();
      });

      this.multiplayerButton.addEventListener("click", () => this.openHostDialog());
      document.querySelector("[data-close-multiplayer]").addEventListener("click", () => {
        this.multiplayerDialog.close();
      });
      this.createRoomButton.addEventListener("click", () => void this.createRoom());
      document.querySelector("#copy-invite-button").addEventListener("click", () => void this.copyInvite());
      document.querySelector("#end-room-button").addEventListener("click", () => void this.endRoom());
    }

    openHostDialog() {
      if (!this.catalogGameReady) return;
      this.hostSessionError.textContent = "";
      this.hostSessionError.classList.remove("is-error");
      this.multiplayerDialog.showModal();
      if (!this.room) void this.prepareTurnstile();
    }

    async prepareTurnstile() {
      this.turnstileToken = "";
      this.createRoomButton.disabled = true;
      this.multiplayerStatus.classList.remove("is-error");

      try {
        apiEndpoint("/v1/rooms");
        if (!config.turnstileSiteKey) {
          throw new Error("A chave pública do Turnstile ainda não foi configurada.");
        }
        this.multiplayerStatus.textContent = "Carregando verificação de segurança…";
        const turnstile = await loadTurnstile();
        if (!turnstile) throw new Error("A verificação do Cloudflare não ficou disponível.");

        const theme = document.documentElement.dataset.theme || "dark";
        if (this.turnstileWidget !== null && this.turnstileTheme !== theme) {
          turnstile.remove(this.turnstileWidget);
          this.turnstileWidget = null;
        }
        this.turnstileTheme = theme;
        if (this.turnstileWidget !== null) {
          turnstile.reset(this.turnstileWidget);
        } else {
          this.turnstileWidget = turnstile.render("#turnstile-container", {
            sitekey: config.turnstileSiteKey,
            action: "create-room",
            theme,
            callback: (token) => {
              this.turnstileToken = token;
              this.createRoomButton.disabled = false;
              this.multiplayerStatus.textContent = "Verificação concluída. Crie a sala quando quiser.";
            },
            "expired-callback": () => {
              this.turnstileToken = "";
              this.createRoomButton.disabled = true;
              this.multiplayerStatus.textContent = "A verificação expirou. Conclua-a novamente.";
            },
            "error-callback": () => {
              this.turnstileToken = "";
              this.createRoomButton.disabled = true;
              this.setMultiplayerError("A verificação do Cloudflare falhou. Tente novamente.");
            },
          });
        }
      } catch (error) {
        this.setMultiplayerError(error.message);
      }
    }

    setMultiplayerError(message) {
      this.multiplayerStatus.classList.add("is-error");
      this.multiplayerStatus.textContent = message;
    }

    async createRoom() {
      if (!this.catalogGameReady || !this.turnstileToken || this.hostSession) return;
      this.createRoomButton.disabled = true;
      this.multiplayerStatus.classList.remove("is-error");
      this.multiplayerStatus.textContent = "Criando sala segura…";

      try {
        const payload = await apiRequest("/v1/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnstileToken: this.turnstileToken }),
        });
        const candidateInvite = core.parseInviteHash(`#room=${encodeURIComponent(payload?.roomId || "")}&token=${encodeURIComponent(payload?.guestToken || "")}`);
        if (!candidateInvite || typeof payload?.hostToken !== "string" || payload.hostToken.length < 20) {
          throw new Error("O serviço retornou credenciais de sala inválidas.");
        }

        this.room = {
          roomId: candidateInvite.roomId,
          guestToken: candidateInvite.token,
          hostToken: payload.hostToken,
          expiresAt: payload.expiresAt,
        };
        this.inviteLink.value = core.buildInviteUrl(window.location.href, this.room.roomId, this.room.guestToken);
        this.roomExpiration.textContent = this.formatExpiration(this.room.expiresAt);
        this.createPanel.hidden = true;
        this.roomPanel.hidden = false;
        this.setHostState("waiting", "Preparando áudio e vídeo…");

        const session = new HostSession(this.room, {
          onState: (state, message) => this.setHostState(state, message),
          onError: (error) => this.setHostError(error.message),
        });
        this.hostSession = session;
        await session.start();
      } catch (error) {
        if (this.hostSession) {
          try { await this.hostSession.leave({ closeRoom: true }); } catch { /* room expires safely */ }
        }
        this.hostSession = null;
        this.room = null;
        this.createPanel.hidden = false;
        this.roomPanel.hidden = true;
        this.setMultiplayerError(error.message);
        window.turnstile?.reset?.(this.turnstileWidget);
      } finally {
        this.turnstileToken = "";
      }
    }

    formatExpiration(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "A sala expira automaticamente em até 6 horas.";
      return `Sala válida até ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)}.`;
    }

    setHostState(state, message) {
      this.hostStatus.textContent = message;
      this.hostStatusDot.classList.toggle("is-connected", state === "connected");
      this.hostStatusDot.classList.toggle("is-warning", state === "reconnecting");
      this.hostStatusDot.classList.toggle("is-error", state === "error");
      if (state === "connected") {
        this.hostSessionError.textContent = "";
        this.hostSessionError.classList.remove("is-error");
      }
    }

    setHostError(message) {
      this.hostSessionError.classList.add("is-error");
      this.hostSessionError.textContent = message;
      this.setHostState("error", "A sala precisa de atenção");
    }

    async copyInvite() {
      if (!this.inviteLink.value) return;
      const button = document.querySelector("#copy-invite-button");
      try {
        await navigator.clipboard.writeText(this.inviteLink.value);
      } catch {
        this.inviteLink.focus();
        this.inviteLink.select();
        document.execCommand("copy");
      }
      button.textContent = "Copiado";
      window.setTimeout(() => { button.textContent = "Copiar"; }, 1600);
    }

    async endRoom() {
      const button = document.querySelector("#end-room-button");
      button.disabled = true;
      try {
        await this.hostSession?.leave({ closeRoom: true });
      } catch (error) {
        this.setHostError(error.message);
      } finally {
        this.hostSession = null;
        this.room = null;
        this.createPanel.hidden = false;
        this.roomPanel.hidden = true;
        this.inviteLink.value = "";
        this.hostSessionError.textContent = "";
        button.disabled = false;
        await this.prepareTurnstile();
      }
    }

    initializeGuestView() {
      this.pickerView.hidden = true;
      this.playerView.hidden = true;
      this.guestView.hidden = false;
      document.title = "Player 2 — ROM Nostalg";
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
      this.guestTouchControls = new window.ROMNostalgGuestTouchControls((mask) => {
        this.guestSession?.transmitter?.setTouchMask(mask);
      });
      this.guestUi = new window.ROMNostalgGuestUi(this);
      this.guestUi.selectedGamepad();

      if (!this.browserSupported()) {
        this.guestEnterButton.disabled = true;
        this.setGuestState("error", "Este navegador não oferece WebRTC compatível.");
      }

      this.guestEnterButton.addEventListener("click", () => void this.enterGuestRoom());
      this.guestResumeButton.addEventListener("click", () => void this.resumeGuestVideo());
      this.guestControlsButton.addEventListener("click", () => this.openGuestControls());
      document.querySelector("#guest-controls-close").addEventListener("click", () => this.guestUi.closeControls());
      document.querySelector("#guest-controls-reset").addEventListener("click", () => this.resetGuestBindings());
      document.querySelector("#guest-controls-clear").addEventListener("click", () => this.guestUi.clearBindings());
      this.guestAudioButton.addEventListener("click", () => void this.toggleGuestAudio());
      this.guestVolumeInput.addEventListener("input", () => this.changeGuestVolume());
      this.guestFullscreenButton.addEventListener("click", () => void this.toggleGuestFullscreen());
      this.guestMobileFullscreenButton.addEventListener("click", () => void this.toggleGuestFullscreen());
      document.querySelector("#guest-leave-button").addEventListener("click", () => this.leaveGuestPage());
      document.addEventListener("fullscreenchange", () => this.syncGuestFullscreen());
      document.addEventListener("webkitfullscreenchange", () => this.syncGuestFullscreen());
      this.guestVideo.volume = this.guestVolume;
      this.guestVolumeInput.value = String(this.guestVolume);
      this.renderGuestBindings();
      this.syncGuestAudioControls();
      if (this.guestTouchControls.available) this.guestControlState.textContent = "Controle por toque disponível";
    }

    loadGuestBindings(pad = null) {
      const defaults = defaultGuestBindings();
      if (!profiles.store.keyboard()) {
        try {
          const legacy = normalizeGuestBindings(JSON.parse(window.localStorage.getItem(GUEST_BINDINGS_STORAGE_KEY) || "null"));
          if (JSON.stringify(legacy.keyboard) !== JSON.stringify(defaults.keyboard)) {
            profiles.store.saveKeyboard(Object.fromEntries(legacy.keyboard.map((code, input) => [input, code])));
          }
        } catch { /* Legacy preferences stay untouched if unavailable/corrupt. */ }
      }
      const keyboard = profiles.store.keyboard() || {};
      const gamepad = profiles.store.gamepad(pad) || {};
      return normalizeGuestBindings({
        keyboard: defaults.keyboard.map((code, input) => keyboard[input]?.startsWith("keyCode:") ? "" : keyboard[input] ?? code),
        gamepad: defaults.gamepad.map((button, input) => gamepad[input] === undefined ? button : profiles.toGuestPad(gamepad[input])),
        layoutVersion: 2,
      });
    }

    saveGuestBindings() {
      const before = this.guestProfileSnapshot;
      if (!before || JSON.stringify(before.keyboard) !== JSON.stringify(this.guestBindings.keyboard)) {
        profiles.store.saveKeyboard(Object.fromEntries(this.guestBindings.keyboard.map((code, input) => [input, code])));
      }
      if (this.activeGuestPad && (!before || JSON.stringify(before.gamepad) !== JSON.stringify(this.guestBindings.gamepad))) {
        profiles.store.saveGamepad(this.activeGuestPad, Object.fromEntries(this.guestBindings.gamepad.map((button, input) => [input, profiles.fromGuestPad(button)])));
      }
      this.guestProfileSnapshot = structuredClone(this.guestBindings);
      this.guestProfileSignature = JSON.stringify([profiles.identity(this.activeGuestPad), profiles.store.revision]);
    }

    syncGuestProfile(pad) {
      const signature = JSON.stringify([profiles.identity(pad), profiles.store.revision]);
      if (signature === this.guestProfileSignature) return;
      const previousKeyboard = JSON.stringify(this.guestBindings.keyboard);
      const hadPad = Boolean(this.activeGuestPad);
      this.activeGuestPad = pad ? { id: pad.id, mapping: pad.mapping || "" } : null;
      this.guestBindings = this.loadGuestBindings(pad);
      this.guestProfileSnapshot = structuredClone(this.guestBindings);
      this.guestProfileSignature = JSON.stringify([profiles.identity(pad), profiles.store.revision]);
      if (hadPad) this.guestUi?.cancelCapture(false);
      this.guestSession?.setInputBindings(guestBindingMaps(this.guestBindings), previousKeyboard === JSON.stringify(this.guestBindings.keyboard));
      this.guestUi?.renderBindings();
    }

    loadGuestVolume() {
      try {
        const stored = window.localStorage.getItem(GUEST_VOLUME_STORAGE_KEY);
        if (stored === null) return 0.7;
        const value = Number(stored);
        return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.7;
      } catch {
        return 0.7;
      }
    }

    saveGuestVolume() {
      try {
        window.localStorage.setItem(GUEST_VOLUME_STORAGE_KEY, String(this.guestVolume));
      } catch {
        // The selected volume remains active for this tab.
      }
    }

    openGuestControls() {
      this.guestUi.openControls();
    }

    renderGuestBindings() {
      this.guestUi.renderBindings();
    }

    applyGuestBindings() {
      this.saveGuestBindings();
      this.guestSession?.setInputBindings(guestBindingMaps(this.guestBindings));
      this.renderGuestBindings();
    }

    resetGuestBindings() {
      this.guestBindings = defaultGuestBindings();
      this.applyGuestBindings();
    }

    async toggleGuestAudio() {
      if (!this.guestVideo.srcObject?.getAudioTracks?.().length) return;
      this.guestVideo.muted = !this.guestVideo.muted;
      if (!this.guestVideo.muted && this.guestVideo.volume === 0) {
        this.guestVolume = 0.7;
        this.guestVideo.volume = this.guestVolume;
        this.guestVolumeInput.value = String(this.guestVolume);
        this.saveGuestVolume();
      }
      if (!this.guestVideo.muted) await this.resumeGuestVideo();
      this.syncGuestAudioControls();
    }

    changeGuestVolume() {
      this.guestVolume = Math.min(1, Math.max(0, Number(this.guestVolumeInput.value) || 0));
      this.guestVideo.volume = this.guestVolume;
      this.guestVideo.muted = this.guestVolume === 0;
      this.saveGuestVolume();
      this.syncGuestAudioControls();
      if (this.guestVolume > 0) void this.resumeGuestVideo();
    }

    syncGuestAudioControls() {
      const hasAudio = Boolean(this.guestVideo.srcObject?.getAudioTracks?.().length);
      const muted = this.guestVideo.muted || this.guestVideo.volume === 0;
      this.guestAudioButton.disabled = !hasAudio;
      this.guestVolumeInput.disabled = !hasAudio;
      this.guestAudioButton.setAttribute("aria-pressed", String(muted));
      const label = muted ? "Desmutar" : "Mudo";
      this.guestAudioButton.setAttribute("aria-label", label);
      this.guestAudioButton.querySelector("span").textContent = label;
      const volume = muted ? 0 : this.guestVideo.volume;
      this.guestVolumeInput.value = String(volume);
      this.guestVolumeInput.style.setProperty("--value", `${volume * 100}%`);
      this.guestVolumeInput.setAttribute("aria-valuetext", `${Math.round(volume * 100)}%`);
    }

    async enterGuestRoom() {
      if (this.guestSession || !this.browserSupported()) return;
      this.guestEnterButton.disabled = true;
      this.guestEnterButton.textContent = "Entrando…";
      this.setGuestState("connecting", "Validando o convite…");

      const session = new GuestSession(this.invite, {
        inputBindings: guestBindingMaps(this.guestBindings),
        getGamepad: () => this.guestUi.selectedGamepad(),
        inputSuspended: () => this.guestControlsDialog.open,
        onInputReady: (ready) => this.guestTouchControls.setEnabled(ready),
        onState: (state, message) => this.setGuestState(state, message),
        onError: (error) => this.setGuestError(error),
        onStream: (stream) => void this.setGuestStream(stream),
        onControllerState: (label, connected) => {
          this.guestControlState.textContent = !connected && this.guestTouchControls.available
            ? "Controle por toque disponível" : label;
          this.guestControlState.classList.toggle("is-connected", connected);
        },
      });
      this.guestSession = session;

      try {
        await session.start();
        this.guestEnterButton.hidden = true;
      } catch (error) {
        session.leave();
        this.guestSession = null;
        this.guestEnterButton.disabled = false;
        this.guestEnterButton.textContent = "Tentar novamente";
        this.setGuestError(error);
      }
    }

    setGuestState(state, message) {
      if (state === "connected" && !this.guestResumeButton.hidden) {
        message = "Vídeo conectado. Toque em Ativar áudio.";
      }
      this.guestStatus.textContent = message;
      this.guestStatusDot.classList.toggle("is-connected", state === "connected");
      this.guestStatusDot.classList.toggle("is-warning", state === "reconnecting");
      this.guestStatusDot.classList.toggle("is-error", state === "error");
    }

    setGuestError(error) {
      const terminal = TERMINAL_SIGNAL_ERRORS.has(error.code);
      this.setGuestState("error", error.message || "Não foi possível entrar na sala.");
      if (terminal) {
        this.guestEnterButton.hidden = false;
        this.guestEnterButton.disabled = true;
        this.guestEnterButton.textContent = "Convite indisponível";
      }
    }

    async setGuestStream(stream) {
      // Audio/video track events can refer to the same stream. Reassigning it
      // interrupts a pending play() and can show a false autoplay error.
      if (this.guestVideo.srcObject !== stream) this.guestVideo.srcObject = stream;
      const hasVideo = Boolean(stream?.getVideoTracks?.().length);
      document.querySelector("#guest-stage").classList.toggle("is-waiting", !hasVideo);
      this.guestPlaceholder.classList.toggle("is-hidden", hasVideo);
      const actions = document.querySelector("#guest-actions");
      const actionsParent = hasVideo ? document.querySelector("#guest-session-actions") : this.guestPlaceholder;
      if (actions.parentElement !== actionsParent) actionsParent.append(actions);
      this.guestFullscreenButton.disabled = !hasVideo;
      this.guestMobileFullscreenButton.disabled = !hasVideo;
      this.syncGuestAudioControls();
      if (!hasVideo) {
        this.guestPlaybackAttempt += 1;
        this.guestResumeButton.hidden = true;
        return;
      }
      await this.resumeGuestVideo();
    }

    async resumeGuestVideo() {
      if (!this.guestVideo.srcObject?.getVideoTracks?.().length) return;
      const attempt = ++this.guestPlaybackAttempt;
      try {
        await this.guestVideo.play();
        if (attempt !== this.guestPlaybackAttempt) return;
        const wasBlocked = !this.guestResumeButton.hidden;
        this.guestResumeButton.hidden = true;
        this.syncGuestAudioControls();
        if (wasBlocked && this.guestSession?.peer?.connectionState === "connected") {
          this.setGuestState("connected", "Conectado ao jogo");
        }
      } catch {
        if (attempt !== this.guestPlaybackAttempt) return;
        this.guestResumeButton.hidden = false;
        this.setGuestState("connected", "Vídeo conectado. Toque em Ativar áudio.");
      }
    }

    currentFullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    async toggleGuestFullscreen() {
      try {
        if (this.currentFullscreenElement()) {
          if (document.exitFullscreen) await document.exitFullscreen();
          else document.webkitExitFullscreen?.();
        } else {
          const target = document.querySelector(this.guestTouchControls.available ? "#guest-player-shell" : "#guest-stage");
          if (target.requestFullscreen) await target.requestFullscreen();
          else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
          else throw new Error("Fullscreen unavailable");
        }
      } catch {
        this.setGuestState("error", "O navegador bloqueou a tela cheia.");
      }
    }

    syncGuestFullscreen() {
      const active = Boolean(this.currentFullscreenElement());
      for (const button of [this.guestFullscreenButton, this.guestMobileFullscreenButton]) {
        button.querySelector("span").textContent = active ? "Sair da tela cheia" : "Tela cheia";
        button.setAttribute("aria-label", active ? "Sair da tela cheia" : "Entrar em tela cheia");
        button.setAttribute("aria-pressed", String(active));
      }
      this.guestUi?.hideMenu();
    }

    leaveGuestPage() {
      this.guestSession?.leave();
      const url = new URL(window.location.href);
      url.hash = "";
      window.location.replace(url.toString());
    }

    async leave({ closeRoom = true } = {}) {
      if (this.hostSession) {
        const session = this.hostSession;
        this.hostSession = null;
        await session.leave({ closeRoom });
      }
      if (this.guestSession) {
        this.guestSession.leave();
        this.guestSession = null;
      }
    }
  }

  window.ROMNostalgNetplay = new NetplayController();
}());
