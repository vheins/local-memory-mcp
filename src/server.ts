#!/usr/bin/env node
import readline from "node:readline";
import { handleMethod } from "./router.js";
import { CAPABILITIES } from "./capabilities.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function reply(payload: unknown) {
  try {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } catch (err: any) {
    // Ignore EPIPE errors (broken pipe when client disconnects)
    if (err.code !== "EPIPE") {
      throw err;
    }
  }
}

rl.on("line", async (line) => {
  if (!line.trim()) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  // --- initialize ---
  if (method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: CAPABILITIES.serverInfo,
        capabilities: CAPABILITIES.capabilities
      }
    });

    reply({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    });
    return;
  }

  // --- ignore notification ---
  if (method === "notifications/initialized") return;

  // --- route method ---
  try {
    const result = await handleMethod(method, params);

    reply({
      jsonrpc: "2.0",
      id,
      result
    });
  } catch (err: any) {
    reply({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err.message || "Internal error"
      }
    });
  }
});
