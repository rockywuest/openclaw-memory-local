"use strict";
/**
 * nox-emergency — OpenClaw Plugin
 *
 * Emergency surface: escalates urgent events (importance >= 0.85)
 * and events with expiring TTLs.
 *
 * Features:
 * - Dedup via SHA256 hash (same alert not escalated twice)
 * - Rate limit: max 2 alerts per day (anti-spam)
 * - Injected as PRIORITY context before agent start
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class EmergencySurface {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.importanceThreshold = config.importanceThreshold || 0.85;
    this.maxAlertsPerDay = config.maxAlertsPerDay || 2;
    this.eventFile = path.join(workspaceRoot, "memory", "events", "bus.jsonl");
    this.alertFile = path.join(workspaceRoot, "memory", "emergency-alerts.jsonl");
  }

  /**
   * Read events from event bus.
   */
  readEvents() {
    if (!fs.existsSync(this.eventFile)) return [];
    try {
      const lines = fs.readFileSync(this.eventFile, "utf8").trim().split("\n");
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[emergency] Failed to read events: ${err.message}`);
      return [];
    }
  }

  /**
   * Read existing alerts.
   */
  readAlerts() {
    if (!fs.existsSync(this.alertFile)) return [];
    try {
      const lines = fs.readFileSync(this.alertFile, "utf8").trim().split("\n");
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[emergency] Failed to read alerts: ${err.message}`);
      return [];
    }
  }

  /**
   * Hash event for dedup.
   */
  hashEvent(event) {
    const content = JSON.stringify({
      topic: event.topic,
      source: event.source,
      data: event.data,
    });
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Count alerts created today.
   */
  countAlertsToday() {
    const alerts = this.readAlerts();
    const today = new Date().toISOString().slice(0, 10);
    return alerts.filter(a => a.timestamp.startsWith(today)).length;
  }

  /**
   * Check if alert already exists.
   */
  alertExists(hash) {
    const alerts = this.readAlerts();
    return alerts.some(a => a.hash === hash);
  }

  /**
   * Write alert to JSONL.
   */
  writeAlert(alert) {
    try {
      const dir = path.dirname(this.alertFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.alertFile, JSON.stringify(alert) + "\n");
    } catch (err) {
      console.error(`[emergency] Failed to write alert: ${err.message}`);
    }
  }

  /**
   * Process events and generate alerts.
   */
  processEvents() {
    const events = this.readEvents();
    const now = Date.now();
    const alertsToday = this.countAlertsToday();

    if (alertsToday >= this.maxAlertsPerDay) {
      console.log(`[emergency] Rate limit reached: ${alertsToday}/${this.maxAlertsPerDay} alerts today`);
      return [];
    }

    const newAlerts = [];

    for (const event of events) {
      // Check TTL expiry (within next 2 hours)
      let isExpiring = false;
      if (event.ttl_hours) {
        const eventTime = new Date(event.timestamp).getTime();
        const expiry = eventTime + event.ttl_hours * 60 * 60 * 1000;
        const timeUntilExpiry = expiry - now;
        const twoHours = 2 * 60 * 60 * 1000;
        if (timeUntilExpiry > 0 && timeUntilExpiry < twoHours) {
          isExpiring = true;
        }
      }

      // Skip if neither urgent nor expiring
      const isUrgent = event.importance >= this.importanceThreshold;
      if (!isUrgent && !isExpiring) continue;

      // Dedup check
      const hash = this.hashEvent(event);
      if (this.alertExists(hash)) continue;

      // Create alert
      const summary = typeof event.data === "object"
        ? JSON.stringify(event.data).slice(0, 100)
        : String(event.data).slice(0, 100);

      const expiryStr = event.ttl_hours
        ? new Date(new Date(event.timestamp).getTime() + event.ttl_hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")
        : null;

      const alert = {
        timestamp: new Date().toISOString(),
        hash,
        topic: event.topic,
        importance: event.importance,
        summary,
        expires: expiryStr,
        handled: false,
      };

      this.writeAlert(alert);
      newAlerts.push(alert);

      // Stop if we hit the daily limit
      if (alertsToday + newAlerts.length >= this.maxAlertsPerDay) break;
    }

    return newAlerts;
  }

  /**
   * Get unhandled alerts for injection.
   */
  getUnhandledAlerts() {
    const alerts = this.readAlerts();
    return alerts.filter(a => !a.handled);
  }

  /**
   * Generate context injection.
   */
  generateContextInjection() {
    const alerts = this.getUnhandledAlerts();
    if (alerts.length === 0) return "";

    const lines = ["## ⚠️ URGENT ALERTS", ""];

    alerts.forEach(a => {
      const ts = new Date(a.timestamp).toISOString().slice(0, 19).replace("T", " ");
      const expiry = a.expires ? ` — Expires: ${a.expires}` : "";
      lines.push(`- **[${ts}]** [${a.topic}] (imp: ${a.importance.toFixed(2)}) ${a.summary}${expiry}`);
    });

    lines.push("", "**These require immediate attention.**", "", "---", "");

    return lines.join("\n");
  }

  /**
   * Mark alert as handled.
   */
  markAsHandled(hash) {
    const alerts = this.readAlerts();
    const updated = alerts.map(a => {
      if (a.hash === hash) {
        return { ...a, handled: true };
      }
      return a;
    });

    try {
      const content = updated.map(a => JSON.stringify(a)).join("\n") + "\n";
      fs.writeFileSync(this.alertFile, content);
      console.log(`[emergency] Marked alert as handled: ${hash.slice(0, 8)}`);
    } catch (err) {
      console.error(`[emergency] Failed to update alerts: ${err.message}`);
    }
  }
}

// ── Plugin Registration ──────────────────────────────────────────

let emergencyInstance = null;

async function beforeAgentStart(event, ctx) {
  if (!emergencyInstance) return undefined;

  // Process new urgent events
  const newAlerts = emergencyInstance.processEvents();
  if (newAlerts.length > 0) {
    console.log(`[emergency] Generated ${newAlerts.length} new alert(s)`);
  }

  // Inject unhandled alerts
  const injection = emergencyInstance.generateContextInjection();
  if (!injection) return undefined;

  return {
    systemMessage: injection,
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info("[nox-emergency] Initializing...");

  emergencyInstance = new EmergencySurface(workspace, config);

  // Register hook
  if (api.on) {
    api.on("before_agent_start", beforeAgentStart);
    logger.info("[nox-emergency] Registered before_agent_start via api.on()");
  } else if (api.registerHook) {
    api.registerHook("before_agent_start", beforeAgentStart);
    logger.info("[nox-emergency] Registered before_agent_start via registerHook()");
  }

  // Expose instance for other plugins
  if (api.shared) {
    api.shared.emergencySurface = emergencyInstance;
    logger.info("[nox-emergency] Exposed as api.shared.emergencySurface");
  }

  logger.info("[nox-emergency] Ready");
}

const plugin = {
  id: "nox-emergency",
  name: "Nox Emergency Surface",
  description: "Escalates urgent events and expiring TTLs (AIE emergency surface)",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      importanceThreshold: { type: "number", default: 0.85, minimum: 0, maximum: 1 },
      maxAlertsPerDay: { type: "number", default: 2, minimum: 1, maximum: 10 },
    },
  },
  register,
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.EmergencySurface = EmergencySurface; // For testing
