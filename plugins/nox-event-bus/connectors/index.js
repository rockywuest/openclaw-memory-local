'use strict';
/**
 * connectors/index.js — Sensor Connector Registry
 *
 * Central registry for all sensor connectors.
 * Manages lifecycle: register, start, stop.
 */

const FileWatchConnector = require('./filewatch.js');
const SystemConnector = require('./system.js');

class ConnectorRegistry {
  constructor(workspaceRoot, eventBus) {
    this.workspaceRoot = workspaceRoot;
    this.eventBus = eventBus;
    this.connectors = new Map();
  }

  /**
   * Register a connector.
   */
  registerConnector(name, ConnectorClass) {
    try {
      const instance = new ConnectorClass(this.workspaceRoot, this.eventBus);
      this.connectors.set(name, instance);
      console.log(`[connectors] Registered: ${name}`);
      return instance;
    } catch (err) {
      console.error(`[connectors] Failed to register ${name}: ${err.message}`);
      return null;
    }
  }

  /**
   * Start all connectors.
   */
  runAll() {
    console.log(`[connectors] Starting ${this.connectors.size} connector(s)...`);

    for (const [name, connector] of this.connectors) {
      try {
        if (connector && typeof connector.start === 'function') {
          connector.start();
        }
      } catch (err) {
        console.error(`[connectors] Failed to start ${name}: ${err.message}`);
        // Graceful degradation: continue with other connectors
      }
    }

    console.log('[connectors] All connectors started');
  }

  /**
   * Stop all connectors.
   */
  stopAll() {
    console.log('[connectors] Stopping all connectors...');

    for (const [name, connector] of this.connectors) {
      try {
        if (connector && typeof connector.stop === 'function') {
          connector.stop();
        }
      } catch (err) {
        console.error(`[connectors] Failed to stop ${name}: ${err.message}`);
      }
    }

    console.log('[connectors] All connectors stopped');
  }

  /**
   * Get a connector by name.
   */
  getConnector(name) {
    return this.connectors.get(name);
  }

  /**
   * Auto-register built-in connectors.
   */
  registerBuiltins() {
    this.registerConnector('filewatch', FileWatchConnector);
    this.registerConnector('system', SystemConnector);
  }
}

module.exports = ConnectorRegistry;
