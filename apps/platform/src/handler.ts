import type { AccessRecord, AccessStore, TelegramUser } from './access.js'
import { canUseMemory } from './access.js'

export type InlineButton = { text: string; callback_data: string };
export type Reply = {
  text: string;
  keyboard?: string[][];
  inline_keyboard?: InlineButton[][];
  accessUpdate?: { userId: number; status: "APPROVED" | "DENIED" };
};

async function statusButtons(
  store: AccessStore,
  status: AccessRecord["accessStatus"],
): Promise<InlineButton[][]> {
  const users = await store.listByStatus(status);
  return users.map((user) =>
    status === "PENDING"
      ? [
          {
            text: `✓ ${user.displayName ?? user.telegramUserId}`,
            callback_data: `approve_user:${user.telegramUserId}`,
          },
          {
            text: "✕ Tolak",
            callback_data: `deny_user:${user.telegramUserId}`,
          },
        ]
      : [
          {
            text: user.displayName ?? String(user.telegramUserId),
            callback_data: "noop",
          },
        ],
  );
}

export async function handleTelegramCallback(
  store: AccessStore,
  user: TelegramUser,
  data: string,
  adminTelegramId: number,
): Promise<Reply> {
  if (user.id !== adminTelegramId) return { text: "Aksi tidak diizinkan." };
  if (data === "noop") return { text: "Tidak ada aksi." };
  const userAction = data.match(/^(approve_user|deny_user):(\d+)$/);
  if (userAction) {
    const updated =
      userAction[1] === "approve_user"
        ? await store.approveUser(Number(userAction[2]))
        : await store.denyUser(Number(userAction[2]));
    return {
      text: updated
        ? "Akses user diperbarui."
        : "User tidak ditemukan atau sudah diproses.",
      accessUpdate:
        updated && updated.accessStatus !== "PENDING"
          ? { userId: updated.telegramUserId, status: updated.accessStatus }
          : undefined,
    };
  }
  return { text: 'Menu diperbarui.' }
}

export async function handleTelegramText(
  store: AccessStore,
  user: TelegramUser,
  text: string,
  adminTelegramId: number,
): Promise<Reply> {
  const current = await store.getUser(user.id);
  if (user.id === adminTelegramId && text === "/start") {
    await store.ensureAdmin(user);
    return {
      text: "Menu admin:",
      keyboard: [["/pending", "/approve", "/deny"]],
    };
  }
  if (text === "/start" || text === "/request_access") {
    if (canUseMemory(current)) return { text: "Akses sudah aktif." };
    const requested = await store.upsertRequest(user);
    return {
      text:
        requested.accessStatus === "APPROVED"
          ? "Akses sudah aktif."
          : "Permintaan akses dikirim ke Eling Haaland. Mohon menunggu dengan santai 😎",
    };
  }
  if (
    user.id === adminTelegramId &&
    ["/pending", "/approve", "/deny"].includes(text)
  ) {
    const status =
      text === "/pending"
        ? "PENDING"
        : text === "/approve"
          ? "APPROVED"
          : "DENIED";
    const labels = {
      PENDING: "pending",
      APPROVED: "approved",
      DENIED: "denied",
    } as const;
    const users = await store.listByStatus(status);
    return {
      text: `User ${labels[status]}:`,
      inline_keyboard: await statusButtons(store, status),
    };
  }
  if (!canUseMemory(current))
    return {
      text: "Akses belum aktif. Kirim /request_access untuk meminta akses.",
    };
  if (/\b(simpan|catat)\b/i.test(text)) {
    const url = text.match(/https?:\/\/\S+/)?.[0]
    if (url) {
      try {
        const page = await store.fetchUrl(url)
        const memory = await store.saveMemory(user.id, `${page.title}\n\n${page.content}`, url)
        return { text: `Tersimpan. ${memory.sourceUrl}` }
      } catch {
        return { text: 'URL tidak bisa dibaca. Pastikan URL publik dan coba lagi.' }
      }
    }
    const content = text.replace(/^\s*(simpan|catat)\b[:,]?\s*/i, '').trim()
    if (!content) return { text: 'Kirim isi memory setelah kata simpan.' }
    const memory = await store.saveMemory(user.id, content)
    return { text: `Tersimpan. ${memory.sourceUrl ?? 'Memory teks'}` }
  }
  if (/\b(cari|carikan|temukan)\b/i.test(text)) {
    const query = text.replace(/^\s*(cari|carikan|temukan)\b[:,]?\s*/i, '').trim()
    if (!query) return { text: 'Kirim kata kunci yang ingin dicari.' }
    const memories = await store.searchMemories(user.id, query)
    if (!memories.length) return { text: 'Belum ditemukan. Mau perluas kata kunci?' }
    return { text: memories.map((memory) => `${memory.content}${memory.sourceUrl ? `\nSumber: ${memory.sourceUrl}` : ''}`).join('\n\n') }
  }
  return { text: 'Akses aktif. Fitur memory siap digunakan.' }
}
