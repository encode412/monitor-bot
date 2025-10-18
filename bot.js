const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

class WhatsAppEventBot {
  constructor(emailConfig, whatsappGroupId = null) {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: "./.wwebjs_auth",
      }),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--single-process",
          "--disable-gpu",
          "--no-zygote",
        ],
        timeout: 0,
      },
      webVersionCache: {
        type: "remote",
        remotePath:
          "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
      },
    });

    this.whatsappGroupId = whatsappGroupId;
    this.downloadPath = "./event_flyers";
    this.blacklistedGroups = ["ISM JOBS 30"];

    this.keywords = [
      "tech event",
      "hackathon",
      "workshop",
      "seminar",
      "artificial intelligence",
      "machine learning",
      "conference",
      "meetup",
      "unilag",
      "tech talk",
      "coding",
      "startup",
      "bootcamp",
      "training",
      "webinar",
      "summit",
      "tech meetup",
      "developer",
      "devfest",
      "tech conference",
      "networking",
      "innovation",
      "blockchain",
      "web3",
      "community event",
      "competition",
      "giveaway",
      "prize",
      "coding competition",
      "tech giveaway",
      "skill development",
      "career fair",
      "job fair",
      "internship",
      "recruitment drive",
      "prizes",
    ];

    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on("qr", (qr) => {
      console.log("\n🔄 NEW QR CODE GENERATED");
      console.log("Scan this QR code with WhatsApp:");
      qrcode.generate(qr, { small: true });
      console.log(
        "\n⚠️  IMPORTANT: After scanning, keep WhatsApp Web active for 30 seconds!"
      );
    });

    this.client.on("authenticated", () => {
      console.log("✅ AUTHENTICATED! Session saved.");
    });

    this.client.on("ready", async () => {
      console.log("\n✅✅✅ WhatsApp Event Bot is READY and CONNECTED! ✅✅✅");
      console.log("Monitoring groups for event messages...\n");

      if (this.whatsappGroupId) {
        try {
          const group = await this.client.getChatById(this.whatsappGroupId);
          console.log(`📤 Forwarding events to: ${group.name}`);
          console.log(`   Group ID: ${this.whatsappGroupId}\n`);
        } catch (error) {
          console.log(
            `⚠️  Could not find group with ID: ${this.whatsappGroupId}`
          );
          console.log(`   Will search for group: "General info"\n`);
        }
      }

      // List groups after 5 seconds
      setTimeout(async () => {
        try {
          console.log("\n📋 Listing available groups:");
          await this.listGroups();
        } catch (err) {
          console.log("Could not list groups:", err.message);
        }
      }, 5000);
    });

    this.client.on("message", async (message) => {
      await this.handleMessage(message);
    });

    this.client.on("auth_failure", (msg) => {
      console.error("\n❌ AUTHENTICATION FAILURE:", msg);
      console.log("Deleting auth folder and restarting...\n");
      // Don't auto-delete in production - let admin handle it
    });

    this.client.on("disconnected", (reason) => {
      console.log("\n⚠️  BOT DISCONNECTED:", reason);
      if (reason === "LOGOUT") {
        console.log("⚠️  Manual logout detected. Cleaning auth files...");
        // Clean auth on logout
        try {
          fs.rmSync("./.wwebjs_auth", { recursive: true, force: true });
          fs.rmSync("./.wwebjs_cache", { recursive: true, force: true });
        } catch (e) {
          console.log("Could not clean auth files:", e.message);
        }
      }
    });

    // Critical: Handle loading screen issues
    this.client.on("loading_screen", (percent, message) => {
      console.log(`⏳ Loading: ${percent}% - ${message}`);
    });

    this.client.on("change_state", (state) => {
      console.log(`🔄 State changed: ${state}`);
    });
  }

  async handleMessage(message) {
    try {
      const chat = await message.getChat();
      if (!chat.isGroup) return;

      const groupName = chat.name;

      const isBlacklisted = this.blacklistedGroups.some((blacklisted) =>
        groupName.toLowerCase().includes(blacklisted.toLowerCase())
      );

      if (isBlacklisted) {
        console.log(`🚫 Ignoring blacklisted group: ${groupName}`);
        return;
      }

      const messageText = message.body.toLowerCase();
      const hasMedia = message.hasMedia;

      const matchedKeywords = this.keywords.filter((keyword) => {
        const lowerKeyword = keyword.toLowerCase();
        if (lowerKeyword.includes(" ")) {
          return messageText.includes(lowerKeyword);
        }
        const wordBoundaryRegex = new RegExp(`\\b${lowerKeyword}\\b`, "i");
        return wordBoundaryRegex.test(messageText);
      });

      if (matchedKeywords.length > 0 || hasMedia) {
        console.log(`\n📱 Potential event detected in: ${groupName}`);
        console.log(`Message: ${message.body.substring(0, 100)}...`);

        let flyerPath = null;

        if (hasMedia) {
          flyerPath = await this.downloadMedia(message, groupName);
        }

        if (matchedKeywords.length > 0) {
          console.log(
            `🎯 Keywords matched: ${[...new Set(matchedKeywords)].join(", ")}`
          );

          await this.forwardToWhatsApp({
            groupName,
            message: message.body,
            keywords: [...new Set(matchedKeywords)],
            flyerPath,
            originalMessage: message,
          });
        }
      }
    } catch (error) {
      console.error("Error handling message:", error.message);
    }
  }

  async downloadMedia(message, groupName) {
    try {
      const media = await message.downloadMedia();
      if (!media) return null;

      const timestamp = Date.now();
      const extension = media.mimetype.split("/")[1] || "jpg";

      const videoExtensions = [
        "mp4",
        "mov",
        "avi",
        "mkv",
        "webm",
        "flv",
        "wmv",
      ];
      if (videoExtensions.includes(extension.toLowerCase())) {
        console.log(`⏭️  Skipping video file: ${extension}`);
        return null;
      }

      const filename = `${groupName.replace(
        /[^a-z0-9]/gi,
        "_"
      )}_${timestamp}.${extension}`;
      const filepath = path.join(this.downloadPath, filename);

      fs.writeFileSync(filepath, media.data, { encoding: "base64" });
      console.log(`💾 Downloaded flyer: ${filename}`);

      return filepath;
    } catch (error) {
      console.error("Error downloading media:", error.message);
      return null;
    }
  }

  async forwardToWhatsApp(eventData) {
    if (!this.whatsappGroupId) {
      console.log("⚠️  No WhatsApp group configured for forwarding");
      return;
    }

    const { groupName, message, keywords, flyerPath, originalMessage } =
      eventData;

    try {
      console.log("📤 Attempting to forward to WhatsApp group...");

      let targetChat;
      try {
        targetChat = await this.client.getChatById(this.whatsappGroupId);
        console.log(`✅ Found target group: ${targetChat.name}`);
      } catch (error) {
        console.log(
          '⚠️  Group ID not found, searching by name: "General info"'
        );
        const chats = await this.client.getChats();
        targetChat = chats.find(
          (chat) =>
            chat.isGroup && chat.name.toLowerCase().includes("general info")
        );

        if (!targetChat) {
          console.error('❌ Could not find group by ID or name "General info"');
          return;
        }
        console.log(`✅ Found group: ${targetChat.name}`);
      }

      const forwardMessage = `
🎉 *EVENT ALERT*

📱 *From Group:* ${groupName}
🔑 *Keywords:* ${keywords.join(", ")}
⏰ *Time:* ${new Date().toLocaleString()}

📝 *Message:*
${message || "No text content"}

---
_Forwarded by Jeka<Hack> Monitor Bot_
      `.trim();

      await targetChat.sendMessage(forwardMessage);
      console.log("✅ Message forwarded to WhatsApp group!");

      if (flyerPath && originalMessage.hasMedia) {
        const media = await originalMessage.downloadMedia();
        if (media) {
          const mimetype = media.mimetype || "";
          if (!mimetype.includes("video")) {
            await targetChat.sendMessage(media, {
              caption: `📸 Event flyer from: ${groupName}`,
            });
            console.log("✅ Flyer forwarded to WhatsApp group!");
          } else {
            console.log("⏭️  Skipped forwarding video file");
          }
        }
      }
    } catch (error) {
      console.error("❌ Error forwarding to WhatsApp:", error.message);
    }
  }

  async start() {
    console.log("🚀 Starting WhatsApp Event Bot...\n");
    await this.client.initialize();
  }

  async stop() {
    await this.client.destroy();
  }

  addKeyword(keyword) {
    if (!this.keywords.includes(keyword.toLowerCase())) {
      this.keywords.push(keyword.toLowerCase());
      console.log(`Added keyword: ${keyword}`);
    }
  }

  removeKeyword(keyword) {
    const index = this.keywords.indexOf(keyword.toLowerCase());
    if (index > -1) {
      this.keywords.splice(index, 1);
      console.log(`Removed keyword: ${keyword}`);
    }
  }

  listKeywords() {
    console.log("\nCurrent keywords:", this.keywords);
  }

  addBlacklistedGroup(groupName) {
    if (!this.blacklistedGroups.includes(groupName)) {
      this.blacklistedGroups.push(groupName);
      console.log(`✅ Blacklisted group: ${groupName}`);
    } else {
      console.log(`⚠️  Group already blacklisted: ${groupName}`);
    }
  }

  removeBlacklistedGroup(groupName) {
    const index = this.blacklistedGroups.findIndex(
      (g) => g.toLowerCase() === groupName.toLowerCase()
    );
    if (index > -1) {
      this.blacklistedGroups.splice(index, 1);
      console.log(`✅ Removed from blacklist: ${groupName}`);
    } else {
      console.log(`⚠️  Group not in blacklist: ${groupName}`);
    }
  }

  listBlacklistedGroups() {
    console.log("\n🚫 Blacklisted groups:", this.blacklistedGroups);
  }

  async listGroups() {
    const chats = await this.client.getChats();
    const groups = chats.filter((chat) => chat.isGroup);

    console.log("\n📋 Your WhatsApp Groups:\n");
    groups.forEach((group, index) => {
      console.log(`${index + 1}. ${group.name}`);
      console.log(`   ID: ${group.id._serialized}\n`);
    });

    return groups;
  }

  async setForwardGroupByName(groupName) {
    const chats = await this.client.getChats();
    const group = chats.find(
      (chat) =>
        chat.isGroup &&
        chat.name.toLowerCase().includes(groupName.toLowerCase())
    );

    if (group) {
      this.whatsappGroupId = group.id._serialized;
      console.log(`✅ Forward group set to: ${group.name}`);
      console.log(`ID: ${group.id._serialized}`);
      return true;
    } else {
      console.log(`❌ Group not found: ${groupName}`);
      return false;
    }
  }
}

// Configuration
const emailConfig = {
  email: "etsunilag@gmail.com",
  password: "",
  recipient: "timothyonyea@gmail.com",
};

const whatsappGroupId = "120363323130578595@g.us";

const bot = new WhatsAppEventBot(emailConfig, whatsappGroupId);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Stopping bot gracefully...");
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, stopping bot...");
  await bot.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught exception:", error);
});

// Start the bot
bot.start().catch((error) => {
  console.error("❌ Failed to start bot:", error);
  process.exit(1);
});
