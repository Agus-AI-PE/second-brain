import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../api/src/generated/prisma/index.js";
import { PrismaAccessStore } from "./access-store.js";
import { handleTelegramCallback, handleTelegramText } from "./handler.js";
import { TelegramClient } from "./telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminTelegramId = Number(process.env.ADMIN_TELEGRAM_ID);
const connectionString = process.env.DATABASE_URL;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!Number.isSafeInteger(adminTelegramId) || adminTelegramId <= 0)
  throw new Error("ADMIN_TELEGRAM_ID is required");
if (!connectionString) throw new Error("DATABASE_URL is required");

const telegram = new TelegramClient(token);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const store = new PrismaAccessStore(prisma);
let offset: number | undefined;

async function poll(): Promise<void> {
  const updates = await telegram.getUpdates(offset);
  for (const update of updates) {
    offset = update.update_id + 1;
    const callback = update.callback_query;
    if (callback?.data) {
      const reply = await handleTelegramCallback(
        store,
        callback.from,
        callback.data,
        adminTelegramId,
      );
      await telegram.answerCallbackQuery(callback.id);
      if (callback.message) {
        await telegram.sendMessage(
          callback.message.chat.id,
          reply.text,
          undefined,
          reply.inline_keyboard,
        );
        if (reply.accessUpdate) {
          const message =
            reply.accessUpdate.status === "APPROVED"
              ? "Akses kamu sudah disetujui. Fitur siap digunakan."
              : "Permintaan akses kamu ditolak.";
          await telegram.sendMessage(reply.accessUpdate.userId, message);
        }
      }
      continue;
    }
    const message = update.message;
    if (!message?.from || !message.text) continue;
    const reply = await handleTelegramText(
      store,
      message.from,
      message.text,
      adminTelegramId,
    );
    await telegram.sendMessage(
      message.chat.id,
      reply.text,
      reply.keyboard,
      reply.inline_keyboard,
    );
  }
}

async function main(): Promise<void> {
  console.log("Telegram polling started");
  while (true) {
    try {
      await poll();
    } catch (error) {
      console.error(error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

void main();
