//main.ts1
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const kv = await Deno.openKv();
const TOKEN = Deno.env.get("BOT_TOKEN");
const SUBGRAM_API_KEY = Deno.env.get("SUBGRAM_API_KEY");
const SECRET_PATH = "/mugtvpnsbot"; // change this if needed
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  if (pathname !== SECRET_PATH) {
    return new Response("Bot is running.", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const update = await req.json();
  const message = update.message;
  const callbackQuery = update.callback_query;
  const myChatMember = update.my_chat_member;
  const channelPost = update.channel_post;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id || channelPost?.chat?.id;
  const userId = message?.from?.id || callbackQuery?.from?.id || channelPost?.from?.id;
  const from = message?.from || callbackQuery?.from || channelPost?.from;
  const username = from?.username ? `@${from.username}` : null;
  const text = message?.text || channelPost?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id || message?.message_id || channelPost?.message_id;
  const callbackQueryId = callbackQuery?.id;
  if (!chatId) return new Response("No chat ID", { status: 200 });
  // Update user activity if userId exists
  if (userId) {
    const userKey = ["users", userId];
    let userData = (await kv.get(userKey)).value || { registered_at: Date.now(), last_active: Date.now() };
    if (!userData.registered_at) userData.registered_at = Date.now();
    userData.last_active = Date.now();
    await kv.set(userKey, userData);
  }
  // Helper functions
  async function sendMessage(cid: number | string, txt: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: txt, ...opts }),
    });
  }
  async function editMessageText(cid: number, mid: number, txt: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid, text: txt, ...opts }),
    });
  }
  async function editMessageCaption(cid: number, mid: number, cap: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/editMessageCaption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid, caption: cap, ...opts }),
    });
  }
  async function forwardMessage(toChatId: string, fromChatId: number, msgId: number) {
    await fetch(`${TELEGRAM_API}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: msgId }),
    });
  }
  async function copyMessage(toChatId: number | string, fromChatId: number | string, msgId: number) {
    const res = await fetch(`${TELEGRAM_API}/copyMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: msgId }),
    });
    return await res.json();
  }
  async function deleteMessage(cid: number, mid: number) {
    await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid }),
    });
  }
  async function answerCallback(qid: string, txt = "") {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: qid, text: txt }),
    });
  }
  async function getChannelTitle(ch: string) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${ch}`);
      const d = await res.json();
      return d.ok ? d.result.title : ch;
    } catch {
      return ch;
    }
  }
  async function isSubscribed(uid: number, chs: string[]) {
    for (const ch of chs) {
      try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${ch}&user_id=${uid}`);
        const d = await res.json();
        if (!d.ok) return false;
        const st = d.result.status;
        if (st === "left" || st === "kicked") return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  async function getUnsubscribed(uid: number, chs: string[]) {
    const unsub = [];
    for (const ch of chs) {
      try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${ch}&user_id=${uid}`);
        const d = await res.json();
        if (!d.ok || ["left", "kicked"].includes(d.result.status)) {
          unsub.push(ch);
        }
      } catch {
        unsub.push(ch);
      }
    }
    return unsub;
  }
  async function getStats() {
    let total = 0, reg24 = 0, act24 = 0;
    const now = Date.now();
    const day = 86400000;
    for await (const e of kv.list({ prefix: ["users"] })) {
      total++;
      if (e.value.registered_at > now - day) reg24++;
      if (e.value.last_active > now - day) act24++;
    }
    const chnum = ((await kv.get(["channels"])).value || []).length;
    const adnum = ((await kv.get(["admins"])).value || []).length;
    return { total, reg24, act24, channels: chnum, admins: adnum };
  }
  function buildJoinRows(chs: string[], titles: string[]) {
    const rows = [];
    for (let i = 0; i < chs.length; i += 2) {
      const row = [];
      row.push({ text: titles[i], url: `https://t.me/${chs[i].substring(1)}` });
      if (i + 1 < chs.length) {
        row.push({ text: titles[i + 1], url: `https://t.me/${chs[i + 1].substring(1)}` });
      }
      rows.push(row);
    }
    return rows;
  }
  async function getSubgramSponsors(uid: number, cid: number, user: any) {
    if (!SUBGRAM_API_KEY) {
      return { status: 'error', message: 'No Subgram API key' };
    }
    const payload = {
      user_id: uid,
      chat_id: cid,
      first_name: user.first_name || '',
      username: user.username || '',
      language_code: user.language_code || 'ru',
      is_premium: !!user.is_premium,
    };
    try {
      const res = await fetch('https://api.subgram.org/get-sponsors', {
        method: 'POST',
        headers: {
          'Auth': SUBGRAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return { status: 'error' };
      }
      return await res.json();
    } catch {
      return { status: 'error' };
    }
  }
  // Initialize admins if not set
  let admins = (await kv.get(["admins"])).value;
  if (!admins) {
    admins = ["@Masakoff"];
    await kv.set(["admins"], admins);
  }
  // Handle my_chat_member updates for promotion/demotion
  if (myChatMember) {
    const chat = myChatMember.chat;
    if (chat.type === "channel") {
      const chUsername = chat.username ? `@${chat.username}` : null;
      if (chUsername) {
        const newStatus = myChatMember.new_chat_member.status;
        const oldStatus = myChatMember.old_chat_member.status;
        let message = "";
        let adminChs = (await kv.get(["admin_channels"])).value || [];
        if (newStatus === "administrator" && oldStatus !== "administrator") {
          message = `🤖 Bot indi bu kanalyň admini: ${chUsername}`;
          if (!adminChs.includes(chUsername)) {
            adminChs.push(chUsername);
            await kv.set(["admin_channels"], adminChs);
          }
        } else if (newStatus !== "administrator" && oldStatus === "administrator") {
          message = `⚠️ Bot bu kanaldan adminlikden aýryldy: ${chUsername}`;
          const idx = adminChs.indexOf(chUsername);
          if (idx > -1) {
            adminChs.splice(idx, 1);
            await kv.set(["admin_channels"], adminChs);
          }
        }
        if (message) {
          admins = (await kv.get(["admins"])).value || [];
          for (const adm of admins) {
            const aid = (await kv.get(["admin_ids", adm])).value;
            if (aid) {
              await sendMessage(aid, message);
            }
          }
        }
      }
    }
    return new Response("OK", { status: 200 });
  }
  // Handle channel posts
  if (channelPost) {
    const channelUsername = channelPost.chat.username ? `@${channelPost.chat.username}` : null;
    if (channelUsername) {
      const channels = (await kv.get(["channels"])).value || [];
      const extraChannels = (await kv.get(["extra_channels"])).value || [];
      const allMonitored = [...channels, ...extraChannels];
      if (allMonitored.includes(channelUsername)) {
        const postText = channelPost.text || channelPost.caption || "";
        const protocols = ["ss://", "vless://", "vmess://", "happ://"];
        const hasProtocol = protocols.some(p => postText.includes(p));
        let hasFile = false;
        if (channelPost.document) {
          const fileName = channelPost.document.file_name || "";
          const extensions = [".npvt", ".dark", ".hc", ".ovpn"];
          hasFile = extensions.some(ext => fileName.toLowerCase().endsWith(ext));
        }
        if (hasProtocol || hasFile) {
          const lowerText = postText.toLowerCase();
          const forbidden = ["dowamy", "knopka", "𝖪𝖭𝖮𝖯𝖪𝖠", "𝖣𝖮𝖶𝖠𝖬𝖸", "𝐲́𝐨𝐤𝐚𝐫𝐤𝐲", "Yokarky kot", "Yokarky kot yaryp dur like gelmese oçer", "1 sagat dursun", "kod goýuldy", "bot", "bota", "📱𝗗𝗢𝗩𝗔𝗠𝗬 𝗕𝗢𝗧𝗗𝗔 𝗔𝗟𝗬𝗣 𝗬𝗘𝗧𝗜𝗦𝗜𝗡👇", "✅Sen hem kody alyp ýetiş!✅✅", "Taze bot hickim bilenok", "vip", "post", "vip post"];
          const hasForbidden = forbidden.some(word => lowerText.includes(word));
          if (!hasForbidden) {
            const vipChannels = (await kv.get(["vip_channels"])).value || [];
            for (const targetChannel of vipChannels) {
              const copyRes = await copyMessage(targetChannel, channelPost.chat.id, channelPost.message_id);
              if (copyRes.ok) {
                const newMessageId = copyRes.result.message_id;
                const fromIndicator = `📌Источник:${channelUsername}`;
                let appendTo = '';
                if (channelPost.text) {
                  appendTo = 'text';
                } else if (channelPost.caption) {
                  appendTo = 'caption';
                } else {
                  appendTo = 'caption';
                }
                const originalContent = appendTo === 'text' ? channelPost.text : channelPost.caption || '';
                const newContent = originalContent + (originalContent ? '\n\n' : '') + fromIndicator;
                let originalEntities = [];
                if (appendTo === 'text') {
                  originalEntities = channelPost.entities || [];
                } else {
                  originalEntities = channelPost.caption_entities || [];
                }
                if (appendTo === 'text') {
                  await editMessageText(targetChannel, newMessageId, newContent, { entities: originalEntities });
                } else {
                  await editMessageCaption(targetChannel, newMessageId, newContent, { caption_entities: originalEntities });
                }
                const countKey = ["forward_count", targetChannel];
                let count = (await kv.get(countKey)).value || 0;
                count++;
                await kv.set(countKey, count);
                if (count % 5 === 0) {
                  const adPost = (await kv.get(["vip_ad_post", targetChannel])).value;
                  if (adPost) {
                    await copyMessage(targetChannel, adPost.from_chat_id, adPost.message_id);
                  }
                }
              }
            }
          }
        }
      }
      // New logic: Check for trigger in @MugtVpnshelperchannel to send broadcast post
      const postText = channelPost.text || channelPost.caption || "";
      if (channelUsername === "@MugtVpnshelperchannel" && postText.includes("newpostmugtvpns")) {
        const post = (await kv.get(["broadcast_post"])).value;
        const notpost = (await kv.get(["notpost_channels"])).value || [];
        if (post) {
          for (const ch of allMonitored) {
            if (!notpost.includes(ch)) {
              await forwardMessage(ch, post.from_chat_id, post.message_id);
            }
          }
        }
      }
    }
    return new Response("OK", { status: 200 });
  }
  // Handle states for admin inputs
  if (message) {
    const stateKey = ["state", userId];
    const state = (await kv.get(stateKey)).value;
    if (state) {
      let channel: string, idx: number, pos: number;
      let chs: string[];
      switch (true) {
        case state === "add_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ Kanal eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Kanal üstünlikli goşuldy");
          break;
        case state === "delete_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Kanal üstünlikli aýryldy");
          break;
        case state === "add_extra_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["extra_channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ Kanal eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["extra_channels"], chs);
          await sendMessage(chatId, "✅ Extra kanal üstünlikli goşuldy");
          break;
        case state === "delete_extra_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["extra_channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["extra_channels"], chs);
          await sendMessage(chatId, "✅ Extra kanal üstünlikli aýryldy");
          break;
        case state === "add_notpost":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["notpost_channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ Kanal eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["notpost_channels"], chs);
          await sendMessage(chatId, "✅ Notpost kanal üstünlikli goşuldy");
          break;
        case state === "delete_notpost":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["notpost_channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["notpost_channels"], chs);
          await sendMessage(chatId, "✅ Notpost kanal üstünlikli aýryldy");
          break;
        case state === "change_place":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          const parts = text.trim().split(/\s+/);
          if (parts.length !== 2) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          channel = parts[0];
          if (!channel.startsWith("@")) channel = "@" + channel;
          pos = parseInt(parts[1]);
          if (isNaN(pos) || pos < 1) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          chs = (await kv.get(["channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          if (pos > chs.length) pos = chs.length;
          const item = chs.splice(idx, 1)[0];
          chs.splice(pos - 1, 0, item);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Orun üstünlikli üýtgedildi");
          break;
        case state === "change_text":
          let fromChatId = chatId;
          let msgId = message.message_id;
          if (message.forward_origin && message.forward_origin.type === "channel") {
            fromChatId = message.forward_origin.chat.id;
            msgId = message.forward_origin.message_id;
          }
          await kv.set(["success_message"], { from_chat_id: fromChatId, message_id: msgId });
          await sendMessage(chatId, "✅ Üstünlik habary üýtgedildi");
          break;
        case state === "change_post":
          await kv.set(["broadcast_post"], { from_chat_id: chatId, message_id: message.message_id });
          await sendMessage(chatId, "✅ Post üstünlikli üýtgedildi");
          break;
        case state === "change_global":
          let globalFromChatId = chatId;
          let globalMsgId = message.message_id;
          if (message.forward_origin && message.forward_origin.type === "channel") {
            globalFromChatId = message.forward_origin.chat.id;
            globalMsgId = message.forward_origin.message_id;
          }
          await kv.set(["global_post"], { from_chat_id: globalFromChatId, message_id: globalMsgId });
          await kv.set(["global_sent"], false);
          await sendMessage(chatId, "✅ Global habar üstünlikli üýtgedildi");
          break;
        case state === "add_admin":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          if (username !== "@Masakoff") {
            await sendMessage(chatId, "⚠️ Diňe @Masakoff adminleri goşup ýa-da aýyryp bilýär");
            break;
          }
          let newAdm = text.trim();
          if (!newAdm.startsWith("@")) newAdm = "@" + newAdm;
          admins = (await kv.get(["admins"])).value || ["@Masakoff"];
          if (admins.includes(newAdm)) {
            await sendMessage(chatId, "⚠️ Eýýäm admin");
            break;
          }
          admins.push(newAdm);
          await kv.set(["admins"], admins);
          await sendMessage(chatId, "✅ Admin goşuldy");
          break;
        case state === "delete_admin":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          if (username !== "@Masakoff") {
            await sendMessage(chatId, "⚠️ Diňe @Masakoff adminleri goşup ýa-da aýyryp bilýär");
            break;
          }
          let delAdm = text.trim();
          if (!delAdm.startsWith("@")) delAdm = "@" + delAdm;
          admins = (await kv.get(["admins"])).value || ["@Masakoff"];
          idx = admins.indexOf(delAdm);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Admin tapylmady");
            break;
          }
          admins.splice(idx, 1);
          await kv.set(["admins"], admins);
          await sendMessage(chatId, "✅ Admin aýryldy");
          break;
        case state === "add_vipbot":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["vip_channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ VipBot eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["vip_channels"], chs);
          await sendMessage(chatId, "✅ VipBot üstünlikli goşuldy");
          break;
        case state === "delete_vipbot":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["vip_channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ VipBot tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["vip_channels"], chs);
          await kv.delete(["forward_count", channel]);
          await kv.delete(["vip_ad_post", channel]);
          await sendMessage(chatId, "✅ VipBot üstünlikli aýryldy");
          break;
        case state.startsWith("change_vip_ad_post:"):
          channel = state.substring(19);
          let fromChatIdPost = chatId;
          let msgIdPost = message.message_id;
          if (message.forward_origin && message.forward_origin.type === "channel") {
            fromChatIdPost = message.forward_origin.chat.id;
            msgIdPost = message.forward_origin.message_id;
          }
          await kv.set(["vip_ad_post", channel], { from_chat_id: fromChatIdPost, message_id: msgIdPost });
          await sendMessage(chatId, "✅ Ad post üstünlikli üýtgedildi");
          break;
      }
      await kv.delete(stateKey);
      return new Response("OK", { status: 200 });
    }
  }
  if (message && text) {
    // Handle /start
    if (text.startsWith("/start")) {
      const subgramResponse = await getSubgramSponsors(userId, chatId, from);
      if (!subgramResponse || subgramResponse.status === 'error' || subgramResponse.status === 'ok') {
        const channels = (await kv.get(["channels"])).value || [];
        const subscribed = await isSubscribed(userId, channels);
        if (subscribed) {
          const successMsg = (await kv.get(["success_message"])).value;
          if (successMsg) {
            await copyMessage(chatId, successMsg.from_chat_id, successMsg.message_id);
          } else {
            await sendMessage(chatId, "🎉 Siz ähli kanallara agza boldyňyz! VPN-iňizden lezzet alyň.");
          }
        } else {
          const chTitles = await Promise.all(channels.map(getChannelTitle));
          const subText = "⚠️ Чтобы получить Впн ключ, подпишитесь на эти каналы."; //⚠️ VPN kod almak üçin Bu kanallara agza boluň.
          const mainRows = buildJoinRows(channels, chTitles);
          const adRows = [[{ text: "📂MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]];
          const keyboard = [...mainRows, ...adRows, [{ text: "Проверить ✅", callback_data: "check_sub" }]]; //Abuna barla ✅
          await sendMessage(chatId, subText, { reply_markup: { inline_keyboard: keyboard } });
        }
      } else if (subgramResponse.status === 'warning') {
        const sponsors = subgramResponse.additional?.sponsors || [];
        const inline_keyboard = [];
        for (const sponsor of sponsors) {
          if (sponsor.available_now && sponsor.status === "unsubscribed") {
            inline_keyboard.push([{ text: sponsor.button_text || "Подписаться", url: sponsor.link }]);
          }
        }
        inline_keyboard.push([{ text: "✅ Я выполнил", callback_data: "check_subgram" }]);
        const subText = "⚠️ Чтобы получить Впн ключ, сначала подпишитесь на эти каналы:";
        await sendMessage(chatId, subText, { reply_markup: { inline_keyboard } });
      }
    }
    // Handle /admin
    if (text === "/admin") {
      if (!username || !admins.includes(username)) {
        await sendMessage(chatId, "⚠️ Вы не админ"); //⚠️ Siziň admin bolmagyňyz ýok
        return new Response("OK", { status: 200 });
      }
      // Store admin id
      await kv.set(["admin_ids", username], userId);
      const stats = await getStats();
      let statText = "📊 Bot statistikasy:\n";
      statText += `1. Jemgyýetdäki ulanyjylar: ${stats.total}\n`;
      statText += `2. Soňky 24 sagatda hasaba alnan ulanyjylar: ${stats.reg24}\n`;
      statText += `3. Soňky 24 sagatda işjeň ulanyjylar: ${stats.act24}\n`;
      statText += `4. Kanallaryň sany: ${stats.channels}\n`;
      statText += `5. Adminleriň sany: ${stats.admins}`;
      await sendMessage(chatId, statText);
      const adminKb = [
        [{ text: "➕ Kanal goş", callback_data: "admin_add_channel" }, { text: "❌ Kanal aýyry", callback_data: "admin_delete_channel" }],
        [{ text: "➕ Extra kanal goş", callback_data: "admin_add_extra_channel" }, { text: "❌ Extra kanal aýyry", callback_data: "admin_delete_extra_channel" }],
        [{ text: "➕ Add notpost", callback_data: "admin_add_notpost" }, { text: "❌ Delete notpost", callback_data: "admin_delete_notpost" }],
        [{ text: "🔄 Kanallaryň ýerini üýtget", callback_data: "admin_change_place" }],
        [{ text: "✏️ Üstünlik tekstini üýtget", callback_data: "admin_change_text" }],
        [{ text: "✏️ Global habary üýtget", callback_data: "admin_change_global" }, { text: "📤 Global iber", callback_data: "admin_send_global" }],
        [{ text: "✏️ Ýaýratmak postyny üýtget", callback_data: "admin_change_post" }, { text: "📤 Post iber", callback_data: "admin_send_post" }],
        [{ text: "➕ Add VipBot", callback_data: "admin_add_vipbot" }, { text: "❌ Delete VipBot", callback_data: "admin_delete_vipbot" }],
        [{ text: "⚙️ VipBot Settings", callback_data: "admin_vipbot_settings" }],
        [{ text: "➕ Admin goş", callback_data: "admin_add_admin" }, { text: "❌ Admin aýyry", callback_data: "admin_delete_admin" }],
      ];
      await sendMessage(chatId, "Admin paneli", { reply_markup: { inline_keyboard: adminKb } });
    }
  }
  // Handle callback queries
  if (callbackQuery && data) {
    admins = (await kv.get(["admins"])).value || ["@Masakoff"];
    if (data.startsWith("admin_") && (!username || !admins.includes(username))) {
      await answerCallback(callbackQueryId, "Siziň admin bolmagyňyz ýok");
      return new Response("OK", { status: 200 });
    }
    if (data === "check_sub") {
      const channels = (await kv.get(["channels"])).value || [];
      const unsubChs = await getUnsubscribed(userId, channels);
      const subscribed = unsubChs.length === 0;
      if (subscribed) {
        await deleteMessage(chatId, messageId);
        const successMsg = (await kv.get(["success_message"])).value;
        if (successMsg) {
          await copyMessage(chatId, successMsg.from_chat_id, successMsg.message_id);
        } else {
          await sendMessage(chatId, "🎉 Siz ähli kanallara agza boldyňyz! VPN-iňizden lezzet alyň.");
        }
        await answerCallback(callbackQueryId);
      } else {
        const chTitles = await Promise.all(unsubChs.map(getChannelTitle));
        const textToSend = "⚠️ Вы ещё не подписались на эти каналы!"; //⚠️ Siz henizem bu kanallara agza bolmadyňyz!
        const mainRows = buildJoinRows(unsubChs, chTitles);
        const adRows = [[{ text: "📂MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]];
        const keyboard = [...mainRows, ...adRows, [{ text: "Проверить ✅", callback_data: "check_sub" }]]; //Abuna barla ✅
        await editMessageText(chatId, messageId, textToSend, { reply_markup: { inline_keyboard: keyboard } });
        await answerCallback(callbackQueryId);
      }
    } else if (data === "check_subgram") {
      await answerCallback(callbackQueryId, "⏳ Проверяем подписки...");
      await deleteMessage(chatId, messageId);
      const subgramResponse = await getSubgramSponsors(userId, chatId, from);
      if (!subgramResponse || subgramResponse.status === 'error' || subgramResponse.status === 'ok') {
        const channels = (await kv.get(["channels"])).value || [];
        const unsubChs = await getUnsubscribed(userId, channels);
        if (unsubChs.length === 0) {
          const successMsg = (await kv.get(["success_message"])).value;
          if (successMsg) {
            await copyMessage(chatId, successMsg.from_chat_id, successMsg.message_id);
          } else {
            await sendMessage(chatId, "🎉 Вы подписаны на все каналы! Наслаждайтесь VPN.");
          }
        } else {
          const chTitles = await Promise.all(unsubChs.map(getChannelTitle));
          const textToSend = "⚠️ Вы ещё не подписались на эти каналы!";
          const mainRows = buildJoinRows(unsubChs, chTitles);
          const adRows = [[{ text: "📂MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]];
          const keyboard = [...mainRows, ...adRows, [{ text: "Проверить ✅", callback_data: "check_sub" }]];
          await sendMessage(chatId, textToSend, { reply_markup: { inline_keyboard: keyboard } });
        }
      } else {
        const sponsors = subgramResponse.additional?.sponsors || [];
        const inline_keyboard = [];
        for (const sponsor of sponsors) {
          if (sponsor.available_now && sponsor.status === "unsubscribed") {
            inline_keyboard.push([{ text: sponsor.button_text || "Подписаться", url: sponsor.link }]);
          }
        }
        inline_keyboard.push([{ text: "✅ Я выполнил", callback_data: "check_subgram" }]);
        const textToSend = "⚠️ Вы ещё не подписались на эти каналы!";
        await sendMessage(chatId, textToSend, { reply_markup: { inline_keyboard } });
      }
    } else if (data.startsWith("admin_")) {
      const action = data.substring(6);
      const stateKey = ["state", userId];
      let prompt = "";
      switch (action) {
        case "add_channel":
          prompt = "📥 Kanalyň ulanyjyny (mysal üçin @channel) iberiň";
          await kv.set(stateKey, "add_channel");
          break;
        case "delete_channel":
          prompt = "📥 Aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_channel");
          break;
        case "add_extra_channel":
          prompt = "📥 Extra kanalyň ulanyjyny (mysal üçin @channel) iberiň";
          await kv.set(stateKey, "add_extra_channel");
          break;
        case "delete_extra_channel":
          prompt = "📥 Extra kanaly aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_extra_channel");
          break;
        case "add_notpost":
          prompt = "📥 Notpost kanalyň ulanyjyny (mysal üçin @channel) iberiň";
          await kv.set(stateKey, "add_notpost");
          break;
        case "delete_notpost":
          prompt = "📥 Notpost kanaly aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_notpost");
          break;
        case "change_place":
          const chs = (await kv.get(["channels"])).value || [];
          let orderText = "📋 Häzirki kanallaryň tertibi:\n";
          chs.forEach((ch: string, i: number) => {
            orderText += `${ch} - ${i + 1}\n`;
          });
          prompt = orderText + "\n📥 Kanal ulanyjysyny we täze orny (mysal üçin @channel 3) iberiň";
          await kv.set(stateKey, "change_place");
          break;
        case "change_text":
          prompt = "📥 Täze üstünlik habaryny iberiň ýa-da forward ediň (kanaldan, sender adyny gizlemek üçin; tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "change_text");
          break;
        case "change_global":
          prompt = "📥 Ähli ulanyjylara iberiljek habary iberiň ýa-da forward ediň (kanaldan, sender adyny gizlemek üçin; tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "change_global");
          break;
        case "send_global":
          const globalPost = (await kv.get(["global_post"])).value;
          if (!globalPost) {
            await answerCallback(callbackQueryId, "Global habar ýok");
            break;
          }
          const sentRes = await kv.get(["global_sent"]);
          if (sentRes.value === true) {
            await answerCallback(callbackQueryId, "Global habar eýýäm iberildi");
            break;
          }
          const current = sentRes;
          const atomic = kv.atomic().check(current).set(["global_sent"], true);
          const commitRes = await atomic.commit();
          if (!commitRes.ok) {
            await answerCallback(callbackQueryId, "Global habar eýýäm iberildi");
            break;
          }
          let sentCount = 0;
          for await (const e of kv.list({ prefix: ["users"] })) {
            try {
              await copyMessage(e.key[1], globalPost.from_chat_id, globalPost.message_id);
              sentCount++;
            } catch {}
          }
          await answerCallback(callbackQueryId, `✅ Habar ${sentCount} ulanyjylara iberildi`);
          break;
        case "change_post":
          prompt = "📥 Täze ýaýratmak postyny iberiň (tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "change_post");
          break;
        case "send_post":
          const post = (await kv.get(["broadcast_post"])).value;
          if (!post) {
            await answerCallback(callbackQueryId, "Post ýok");
            break;
          }
          const channels = (await kv.get(["channels"])).value || [];
          const extraChannels = (await kv.get(["extra_channels"])).value || [];
          const notpost = (await kv.get(["notpost_channels"])).value || [];
          const allChannels = [...channels, ...extraChannels];
          for (const ch of allChannels) {
            if (!notpost.includes(ch)) {
              await forwardMessage(ch, post.from_chat_id, post.message_id);
            }
          }
          await answerCallback(callbackQueryId, "✅ Post ähli kanallara iberildi");
          break;
        case "add_vipbot":
          prompt = "📥 VipBot kanalyň ulanyjyny (mysal üçin @MugtVpns) iberiň";
          await kv.set(stateKey, "add_vipbot");
          break;
        case "delete_vipbot":
          prompt = "📥 VipBot aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_vipbot");
          break;
        case "vipbot_settings":
          const vipChs = (await kv.get(["vip_channels"])).value || [];
          if (vipChs.length === 0) {
            await editMessageText(chatId, messageId, "⚠️ No VipBots added yet.");
          } else {
            const titles = await Promise.all(vipChs.map(getChannelTitle));
            const rows = [];
            for (let i = 0; i < vipChs.length; i++) {
              rows.push([{ text: titles[i], callback_data: `vip_select:${vipChs[i]}` }]);
            }
            rows.push([{ text: "Back to admin panel", callback_data: "admin_panel" }]);
            await editMessageText(chatId, messageId, "Select VipBot channel:", { reply_markup: { inline_keyboard: rows } });
          }
          await answerCallback(callbackQueryId);
          return new Response("OK", { status: 200 });
        case "add_admin":
          if (username !== "@Masakoff") {
            await answerCallback(callbackQueryId, "Diňe @Masakoff adminleri goşup bilýär");
            break;
          }
          prompt = "📥 Admin hökmünde goşmak üçin ulanyjyny (mysal üçin @user) iberiň";
          await kv.set(stateKey, "add_admin");
          break;
        case "delete_admin":
          if (username !== "@Masakoff") {
            await answerCallback(callbackQueryId, "Diňe @Masakoff adminleri aýyryp bilýär");
            break;
          }
          prompt = "📥 Admini aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_admin");
          break;
      }
      if (prompt) {
        await editMessageText(chatId, messageId, prompt);
      }
      await answerCallback(callbackQueryId);
    } else if (data.startsWith("vip_select:")) {
      const channel = data.substring(11);
      const adPostSet = !!(await kv.get(["vip_ad_post", channel])).value;
      const settingsText = `Settings for ${await getChannelTitle(channel)}:\n\nAd post is ${adPostSet ? "set" : "not set"}.`;
      const kb = [
        [{ text: "Change ad post", callback_data: `vip_change_post:${channel}` }],
        [{ text: "Back to VipBot Settings", callback_data: "admin_vipbot_settings" }],
        [{ text: "Back to admin panel", callback_data: "admin_panel" }]
      ];
      await editMessageText(chatId, messageId, settingsText, { reply_markup: { inline_keyboard: kb } });
      await answerCallback(callbackQueryId);
    } else if (data.startsWith("vip_change_post:")) {
      const channel = data.substring(16);
      await editMessageText(chatId, messageId, `Send the new ad post for ${channel} (forward from channel to hide sender name):`);
      await kv.set(["state", userId], `change_vip_ad_post:${channel}`);
      await answerCallback(callbackQueryId);
    } else if (data === "admin_panel") {
      const stats = await getStats();
      let statText = "📊 Bot statistikasy:\n";
      statText += `1. Jemgyýetdäki ulanyjylar: ${stats.total}\n`;
      statText += `2. Soňky 24 sagatda hasaba alnan ulanyjylar: ${stats.reg24}\n`;
      statText += `3. Soňky 24 sagatda işjeň ulanyjylar: ${stats.act24}\n`;
      statText += `4. Kanallaryň sany: ${stats.channels}\n`;
      statText += `5. Adminleriň sany: ${stats.admins}\n\nAdmin paneli`;
      const adminKb = [
        [{ text: "➕ Kanal goş", callback_data: "admin_add_channel" }, { text: "❌ Kanal aýyry", callback_data: "admin_delete_channel" }],
        [{ text: "➕ Extra kanal goş", callback_data: "admin_add_extra_channel" }, { text: "❌ Extra kanal aýyry", callback_data: "admin_delete_extra_channel" }],
        [{ text: "➕ Add notpost", callback_data: "admin_add_notpost" }, { text: "❌ Delete notpost", callback_data: "admin_delete_notpost" }],
        [{ text: "🔄 Kanallaryň ýerini üýtget", callback_data: "admin_change_place" }],
        [{ text: "✏️ Üstünlik tekstini üýtget", callback_data: "admin_change_text" }],
        [{ text: "✏️ Global habary üýtget", callback_data: "admin_change_global" }, { text: "📤 Global iber", callback_data: "admin_send_global" }],
        [{ text: "✏️ Ýaýratmak postyny üýtget", callback_data: "admin_change_post" }, { text: "📤 Post iber", callback_data: "admin_send_post" }],
        [{ text: "➕ Add VipBot", callback_data: "admin_add_vipbot" }, { text: "❌ Delete VipBot", callback_data: "admin_delete_vipbot" }],
        [{ text: "⚙️ VipBot Settings", callback_data: "admin_vipbot_settings" }],
        [{ text: "➕ Admin goş", callback_data: "admin_add_admin" }, { text: "❌ Admin aýyry", callback_data: "admin_delete_admin" }],
      ];
      await editMessageText(chatId, messageId, statText, { reply_markup: { inline_keyboard: adminKb } });
      await answerCallback(callbackQueryId);
    }
  }
  return new Response("OK", { status: 200 });
});




