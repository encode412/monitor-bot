const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const nodemailer = require("nodemailer");
const Tesseract = require("tesseract.js");
const fs = require("fs");
const path = require("path");

class WhatsAppEventBot {
  constructor(emailConfig, whatsappGroupId = null) {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox"],
      },
    });

    /*
    this.emailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: emailConfig.email,
        pass: emailConfig.password,
      },
    });

    this.emailRecipient = emailConfig.recipient;
    */

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
    ];

    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on("qr", (qr) => {
      console.log("Scan this QR code with WhatsApp:");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", async () => {
      console.log("✅ WhatsApp Event Bot is ready!");
      console.log("Monitoring groups for event messages...\n");

      if (this.whatsappGroupId) {
        try {
          const group = await this.client.getChatById(this.whatsappGroupId);
          console.log(`📤 Forwarding events to: ${group.name}\n`);
        } catch (error) {
          console.log(`📤 Will search for group: "General info"\n`);
        }
      }

      /*
      setTimeout(async () => {
        await this.listGroups();
      }, 15000);
      */
    });

    this.client.on("message", async (message) => {
      await this.handleMessage(message);
    });

    this.client.on("auth_failure", (msg) => {
      console.error("Authentication failure:", msg);
    });

    this.client.on("disconnected", (reason) => {
      console.log("Bot disconnected:", reason);
    });
  }

  async handleMessage(message) {
    try {
      const chat = await message.getChat();

      // Only process group messages
      if (!chat.isGroup) return;

      const groupName = chat.name;

      // Check if group is blacklisted
      const isBlacklisted = this.blacklistedGroups.some((blacklisted) =>
        groupName.toLowerCase().includes(blacklisted.toLowerCase())
      );

      if (isBlacklisted) {
        console.log(`🚫 Ignoring blacklisted group: ${groupName}`);
        return;
      }

      const messageText = message.body.toLowerCase();
      const hasMedia = message.hasMedia;

      // Check if message contains keywords (with whole word matching for short keywords)
      const matchedKeywords = this.keywords.filter((keyword) => {
        const lowerKeyword = keyword.toLowerCase();

        // For multi-word keywords, use simple includes
        if (lowerKeyword.includes(" ")) {
          return messageText.includes(lowerKeyword);
        }

        // For single words, use word boundary matching to avoid false positives
        const wordBoundaryRegex = new RegExp(`\\b${lowerKeyword}\\b`, "i");
        return wordBoundaryRegex.test(messageText);
      });

      if (matchedKeywords.length > 0 || hasMedia) {
        console.log(`\n📱 Potential event detected in: ${groupName}`);
        console.log(`Message: ${message.body.substring(0, 100)}...`);

        let flyerPath = null;
        let ocrText = "";

        // Download and process media if present
        if (hasMedia) {
          flyerPath = await this.downloadMedia(message, groupName);

          // OCR is disabled by default to prevent crashes
          // Uncomment below to enable text extraction from images
          /*
          if (flyerPath && this.isImage(flyerPath)) {
            ocrText = await this.performOCR(flyerPath);
            console.log("📄 OCR extracted text from image");

            // Check OCR text for keywords too
            const ocrKeywords = this.keywords.filter((keyword) =>
              ocrText.toLowerCase().includes(keyword.toLowerCase())
            );
            matchedKeywords.push(...ocrKeywords);
          }
          */
        }

        // If keywords found, send email and forward to WhatsApp
        if (matchedKeywords.length > 0) {
          console.log(
            `🎯 Keywords matched: ${[...new Set(matchedKeywords)].join(", ")}`
          );

          // await this.sendEmail({
          //   groupName,
          //   message: message.body,
          //   keywords: [...new Set(matchedKeywords)],
          //   flyerPath,
          //   ocrText,
          //   sender: message.author || message.from,
          //   timestamp: new Date(message.timestamp * 1000),
          // });

          // Forward to WhatsApp group
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
      console.error("Error handling message:", error);
    }
  }

  async downloadMedia(message, groupName) {
    try {
      const media = await message.downloadMedia();

      if (!media) return null;

      const timestamp = Date.now();
      const extension = media.mimetype.split("/")[1] || "jpg";

      // Skip video files (mp4, mov, avi, etc.)
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

      // Save media file
      fs.writeFileSync(filepath, media.data, { encoding: "base64" });
      console.log(`💾 Downloaded flyer: ${filename}`);

      return filepath;
    } catch (error) {
      console.error("Error downloading media:", error);
      return null;
    }
  }

  isImage(filepath) {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp"];
    return imageExtensions.some((ext) => filepath.toLowerCase().endsWith(ext));
  }

  async performOCR(imagePath) {
    try {
      console.log("🔍 Starting OCR...");
      const worker = await Tesseract.createWorker("eng", 1, {
        errorHandler: (err) => console.error("Tesseract error:", err),
      });

      const {
        data: { text },
      } = await worker.recognize(imagePath);

      await worker.terminate();
      console.log("✅ OCR completed");
      return text;
    } catch (error) {
      console.error("⚠️  OCR error (skipping):", error.message);
      return "";
    }
  }

  // EMAIL SENDING DISABLED
  // Uncomment this entire function to re-enable email alerts
  /*
  async sendEmail(eventData) {
    const {
      groupName,
      message,
      keywords,
      flyerPath,
      ocrText,
      sender,
      timestamp,
    } = eventData;

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #25D366;">🎉 Event Detected from WhatsApp</h2>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>📱 Group:</strong> ${groupName}</p>
            <p><strong>👤 Sender:</strong> ${sender}</p>
            <p><strong>🕐 Time:</strong> ${timestamp.toLocaleString()}</p>
            <p><strong>🔑 Keywords Matched:</strong> ${keywords.join(", ")}</p>
          </div>

          <div style="margin: 20px 0;">
            <h3>📝 Message Content:</h3>
            <p style="background: #fff; padding: 15px; border-left: 4px solid #25D366;">
              ${message || "No text message"}
            </p>
          </div>

          ${
            ocrText
              ? `
          <div style="margin: 20px 0;">
            <h3>🔍 Text Extracted from Image (OCR):</h3>
            <p style="background: #fff; padding: 15px; border-left: 4px solid #128C7E;">
              ${ocrText.substring(0, 500)}${ocrText.length > 500 ? "..." : ""}
            </p>
          </div>
          `
              : ""
          }

          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This email was sent by your WhatsApp Event Monitor Bot
          </p>
        </body>
      </html>
    `;

    const mailOptions = {
      from: this.emailTransporter.options.auth.user,
      to: this.emailRecipient,
      subject: `🎉 Event Alert: ${groupName}`,
      html: htmlContent,
      attachments: flyerPath
        ? [
            {
              filename: path.basename(flyerPath),
              path: flyerPath,
            },
          ]
        : [],
    };

    try {
      await this.emailTransporter.sendMail(mailOptions);
      console.log("✅ Email sent successfully!");
    } catch (error) {
      console.error("❌ Error sending email:", error);
    }
  }
  */

  async forwardToWhatsApp(eventData) {
    // Skip if no WhatsApp group configured
    if (!this.whatsappGroupId) {
      console.log("⚠️  No WhatsApp group configured for forwarding");
      return;
    }

    const { groupName, message, keywords, flyerPath, originalMessage } =
      eventData;

    try {
      console.log("📤 Attempting to forward to WhatsApp group...");

      // Try to get chat by ID first, fallback to finding by name
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

      // Create formatted message
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

      // Send text message
      await targetChat.sendMessage(forwardMessage);
      console.log("✅ Message forwarded to WhatsApp group!");

      // Forward media if present (excluding videos)
      if (flyerPath && originalMessage.hasMedia) {
        const media = await originalMessage.downloadMedia();
        if (media) {
          // Check if it's not a video
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
    await this.client.initialize();
  }

  async stop() {
    await this.client.destroy();
  }

  // Update keywords dynamically
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

  // Blacklist management
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

  // Get WhatsApp Group ID helper
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

  // Set forward group by name
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
      console.log(`   ID: ${group.id._serialized}`);
      return true;
    } else {
      console.log(`❌ Group not found: ${groupName}`);
      return false;
    }
  }
}

const emailConfig = {
  email: "etsunilag@gmail.com",
  password: "Timothyonyea65452",
  recipient: "timothyonyea@gmail.com",
};

const whatsappGroupId = "120363323130578595@g.us";

const bot = new WhatsAppEventBot(emailConfig, whatsappGroupId);

bot.start();

process.on("SIGINT", async () => {
  console.log("\n\nStopping bot...");
  await bot.stop();
  process.exit(0);
});

// ==================== OPTIONAL: ADD CUSTOM KEYWORDS ====================
// Uncomment to add more keywords after bot starts
/*
setTimeout(() => {
  bot.addKeyword('blockchain');
  bot.addKeyword('devfest');
  bot.addKeyword('web3');
  bot.addKeyword('flutter');
  bot.listKeywords();
}, 5000);
*/

// ==================== OPTIONAL: MANAGE BLACKLIST ====================
// Uncomment to add/remove blacklisted groups dynamically
/*
setTimeout(() => {
  bot.addBlacklistedGroup("Spam Group");
  bot.listBlacklistedGroups();
  // bot.removeBlacklistedGroup("ISM JOBS 30");
}, 5000);
*/

// ==================== OPTIONAL: LIST ALL GROUPS ====================
// Uncomment to see all your WhatsApp groups and their IDs
// IMPORTANT: Wait at least 30 seconds after bot is ready
/*
setTimeout(async () => {
  await bot.listGroups();
}, 30000); // 30 seconds - gives WhatsApp Web time to fully load
*/

// ==================== OPTIONAL: SET GROUP BY NAME ====================
// Uncomment to set forward group by searching for name
/*
setTimeout(async () => {
  await bot.setForwardGroupByName("General info");
}, 10000);
*/
