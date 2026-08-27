(function exposeConnectionGuidance(root) {
  // This controller knows no tabs, URLs, messages, or translation preferences.
  function createGuidance({ request, read, save, render, schedule = setTimeout, unschedule = clearTimeout }) {
    let phase = "checking";
    let everConnected = false;
    let dismissed = false;
    let failures = 0;
    let timer;
    let pending = false;
    let stopped = false;
    let response = null;
    const emit = () => render({ phase, everConnected, dismissed, response });
    const persist = patch => {
      try { void Promise.resolve(save(patch)).catch(() => {}); }
      catch { /* A storage error must not change the connection result. */ }
    };
    async function check() {
      if (stopped || pending) return;
      unschedule(timer);
      pending = true;
      try { response = await request(phase === "connected" || phase === "disabled" ? "connectionPing" : "status"); }
      catch { response = null; }
      pending = false;
      if (stopped) return;
      if (response?.code === "browser_connection_disabled") {
        phase = "disabled";
        failures = 0;
      } else if ((response?.type === "status" && response.appConnected !== false)
        || (response?.type === "connection" && response.appConnected === true)) {
        // After reconnecting, obtain settings before enabling popup controls.
        if (response.type === "connection" && phase !== "connected") {
          phase = "checking";
          return check();
        }
        phase = "connected";
        failures = 0;
        if (!everConnected) persist({ companionConnected: true });
        everConnected = true;
      } else {
        failures++;
        phase = failures >= 3 ? "unavailable" : "checking";
      }
      emit();
      timer = schedule(check, phase === "checking" ? (failures === 1 ? 1000 : 2000) : 5000);
    }
    return Object.freeze({
      async start() {
        try {
          const saved = await read();
          everConnected = saved?.companionConnected === true;
          dismissed = saved?.companionHelpDismissed === true;
        } catch { /* Unavailable storage must not prevent recovery. */ }
        if (stopped) return;
        emit();
        return check();
      },
      retry() {
        if (stopped || pending) return;
        failures = 0;
        phase = "checking";
        emit();
        return check();
      },
      dismiss() { dismissed = true; persist({ companionHelpDismissed: true }); emit(); },
      expand() { dismissed = false; persist({ companionHelpDismissed: false }); emit(); },
      stop() { stopped = true; unschedule(timer); },
    });
  }
  root.NudeNyangConnectionGuidance = Object.freeze({ createGuidance });
})(globalThis);
