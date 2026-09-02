// Watchdog + network monitor timings (shared by both services)
export const RESTART_COOLDOWN_MS = 120000;
export const NETWORK_SETTLE_MS = 2500;
export const WATCHDOG_INTERVAL_MS = 60000;
export const NETWORK_CHECK_INTERVAL_MS = 5000;

// Skip virtual/transient interfaces (tailscale utun, AirDrop awdl, bridges) that flap and cause false netchange
export const VIRTUAL_IFACE_REGEX = /^(utun|awdl|llw|anpi|bridge|gif|stf|ipsec|ap|tun|tap|vmnet|veth|docker)/i;

// Consecutive unreachable checks before the watchdog restarts a cloudflared that
// is still running. At WATCHDOG_INTERVAL_MS this is a few minutes of sustained
// failure, long enough that a network blip or a self-reconnect is not mistaken
// for a dead tunnel, short enough that an up-but-not-serving process recovers.
export const UNREACHABLE_CHECKS_BEFORE_RESTART = 3;
