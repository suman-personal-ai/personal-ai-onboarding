#!/usr/bin/env node
// start-tunnel.js — starts server + localtunnel, updates BASE_URL in .env

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ENV_FILE = path.join(__dirname, '.env');

function updateEnv(key, value) {
  let content = fs.readFileSync(ENV_FILE, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_FILE, content);
}

async function main() {
  // 1. Start the Express server
  console.log('\n🚀 Starting Personal AI Onboarding server...');
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 2000));

  // 2. Start localtunnel
  console.log('\n🌐 Opening tunnel...');
  const localtunnel = require('localtunnel');
  
  const tunnel = await localtunnel({ 
    port: PORT,
    // Try a stable subdomain name
  });

  const url = tunnel.url;
  console.log(`\n✅ Tunnel open: ${url}`);

  // 3. Update .env with the tunnel URL
  updateEnv('BASE_URL', url);
  console.log(`\n✅ Updated BASE_URL in .env to: ${url}`);

  // 4. Print setup instructions
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Personal AI Token Plan — LIVE                       ║
╠══════════════════════════════════════════════════════════════╣
║  Frontend   : ${url}/                           
║  Admin      : ${url}/admin                      
║  Webhook    : ${url}/webhook/telnyx             
╠══════════════════════════════════════════════════════════════╣
║  TELNYX SETUP (do this now):                                ║
║                                                              ║
║  1. Go to: telnyx.com/app/messaging/profiles                ║
║     → Create a profile (or edit existing)                   ║
║     → Set webhook URL to:                                   ║
║       ${url}/webhook/telnyx            
║                                                              ║
║  2. Go to: telnyx.com/app/call-control/applications         ║
║     → Create a TeXML application                            ║
║     → Set webhook URL to:                                   ║
║       ${url}/webhook/telnyx/voice      
║                                                              ║
║  3. Open the frontend and enter a phone number to test:     ║
║       ${url}/                          
╚══════════════════════════════════════════════════════════════╝

⚠️  NOTE: Tunnel URL changes each restart. Re-update Telnyx
    webhook after each tunnel restart.

Press Ctrl+C to stop.
`);

  // Restart server with updated BASE_URL so it knows its public URL
  server.kill();
  await new Promise(r => setTimeout(r, 500));

  const server2 = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: url }
  });

  tunnel.on('close', () => {
    console.log('\n⚠️  Tunnel closed. Restart start-tunnel.js to get a new URL.');
    server2.kill();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    tunnel.close();
    server2.kill();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
