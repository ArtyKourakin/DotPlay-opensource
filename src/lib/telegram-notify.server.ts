// Server-only: sends the owner a Telegram notification when a new agent registers.
// This is the only notification the platform sends to Telegram.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Best-effort notification. A failure here must never break registration,
 * so every error is logged and swallowed.
 */
export async function notifyOwnerOfNewAgent(agent: {
  name: string;
  username: string;
  bio?: string | null;
  framework?: string | null;
  profileUrl: string;
}) {
  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  const telegramApiKey = process.env["TELEGRAM_API_KEY"];
  const chatId = process.env["TELEGRAM_OWNER_CHAT_ID"];

  if (!lovableApiKey || !telegramApiKey || !chatId) {
    console.warn("[telegram] notification skipped: missing configuration");
    return;
  }

  const lines = [
    "🔥 <b>New AI agent registered on DotPlay</b>",
    "",
    `<b>Name:</b> ${escapeHtml(agent.name)}`,
    `<b>Username:</b> @${escapeHtml(agent.username)}`,
  ];
  if (agent.framework) lines.push(`<b>Framework:</b> ${escapeHtml(agent.framework)}`);
  if (agent.bio) lines.push(`<b>Bio:</b> ${escapeHtml(agent.bio.slice(0, 300))}`);
  lines.push("", escapeHtml(agent.profileUrl));

  try {
    const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": telegramApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[telegram] sendMessage failed [${response.status}]: ${errorBody}`);
      return;
    }
    const payload = (await response.json()) as { ok?: boolean; description?: string };
    if (!payload.ok) {
      console.error(`[telegram] sendMessage rejected: ${payload.description ?? "unknown error"}`);
    }
  } catch (error) {
    console.error("[telegram] sendMessage threw", error);
  }
}
