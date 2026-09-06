import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from "@whiskeysockets/baileys";

import pino from "pino";
import dotenv from "dotenv";
import readline from "readline";
import { Boom } from "@hapi/boom";

dotenv.config();

const BOT_NAME = process.env.BOT_NAME || "NEXUS";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "628xxxxxxxxxx";

const logger = pino({
  level: "silent"
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function formatRuntime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

async function startNexus() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,

    browser: Browsers.ubuntu("Chrome"),

    logger,

    markOnlineOnConnect: false,

    connectTimeoutMs: 60000,

    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing Code
  if (!state.creds.registered) {
    let number = await ask(
      "\n📱 Masukkan nomor WhatsApp\nContoh: 628123456789\n> "
    );

    number = number.replace(/\D/g, "");

    if (!number) {
      console.log("❌ Nomor tidak valid.");
      rl.close();
      process.exit(1);
    }

    try {
      const code = await sock.requestPairingCode(number);

      const formatted =
        code.match(/.{1,4}/g)?.join("-") || code;

      console.log("\n╭────────────────────────╮");
      console.log(`│       🤖 ${BOT_NAME}       │`);
      console.log("├────────────────────────┤");
      console.log(`│ Pairing Code: ${formatted} │`);
      console.log("╰────────────────────────╯\n");

      console.log(
        "Buka WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon."
      );
    } catch (error) {
      console.log("❌ Gagal mendapatkan pairing code.");
      console.log(error.message);
    }
  }

  // Connection
  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect }) => {
      if (connection === "connecting") {
        console.log("🔄 Menghubungkan ke WhatsApp...");
      }

      if (connection === "open") {
        console.log("\n╭────────────────────────╮");
        console.log(`│      🤖 ${BOT_NAME} ONLINE      │`);
        console.log("├────────────────────────┤");
        console.log("│ Status : ONLINE         │");
        console.log("│ Version: V1             │");
        console.log("╰────────────────────────╯\n");

        console.log("Ketik .menu di WhatsApp untuk melihat command.");
      }

      if (connection === "close") {
        const statusCode =
          new Boom(lastDisconnect?.error)?.output?.statusCode;

        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut;

        console.log("\n⚠️ Koneksi terputus.");

        if (shouldReconnect) {
          console.log("🔄 Mencoba reconnect...\n");

          setTimeout(() => {
            startNexus();
          }, 3000);
        } else {
          console.log(
            "❌ Session logout. Hapus folder session lalu jalankan kembali."
          );
        }
      }
    }
  );

  // Message Handler
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg?.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;

      if (!jid || jid === "status@broadcast") return;

      const messageType = Object.keys(msg.message)[0];

      let body = "";

      if (messageType === "conversation") {
        body = msg.message.conversation;
      } else if (messageType === "extendedTextMessage") {
        body = msg.message.extendedTextMessage.text;
      } else {
        return;
      }

      body = body.trim();

      if (!body.startsWith(".")) return;

      const args = body.split(/\s+/);
      const command = args[0].toLowerCase();

      switch (command) {
        case ".menu":
        case ".help": {
          const menu = `
╭───「 🤖 ${BOT_NAME} 」
│
├─ 📌 MAIN
│  ├ .menu
│  ├ .ping
│  ├ .runtime
│  ├ .owner
│  └ .status
│
├─ 🛠️ INFO
│  └ .help
│
╰────────────────
`;

          await sock.sendMessage(jid, {
            text: menu
          });

          break;
        }

        case ".ping": {
          const start = Date.now();

          const sent = await sock.sendMessage(jid, {
            text: "⚡ Menghitung..."
          });

          const speed = Date.now() - start;

          await sock.sendMessage(jid, {
            text: `⚡ Speed: ${speed}ms`,
            edit: sent.key
          });

          break;
        }

        case ".runtime": {
          const runtime =
            process.uptime();

          await sock.sendMessage(jid, {
            text:
              `⏱️ *NEXUS Runtime*\n\n` +
              `${formatRuntime(runtime)}`
          });

          break;
        }

        case ".owner": {
          await sock.sendMessage(jid, {
            text:
              `👑 *NEXUS Owner*\n\n` +
              `WhatsApp: https://wa.me/${OWNER_NUMBER}`
          });

          break;
        }

        case ".status": {
          const memory =
            process.memoryUsage().rss / 1024 / 1024;

          await sock.sendMessage(jid, {
            text:
              `🤖 *${BOT_NAME} Status*\n\n` +
              `🟢 Status: Online\n` +
              `⚙️ Node.js: ${process.version}\n` +
              `💾 RAM: ${memory.toFixed(1)} MB\n` +
              `⏱️ Runtime: ${formatRuntime(process.uptime())}`
          });

          break;
        }

        default:
          break;
      }
    } catch (error) {
      console.error("Message error:", error);
    }
  });
}

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled Rejection:", error);
});

startNexus().catch((error) => {
  console.error("❌ Gagal menjalankan NEXUS:", error);
});
