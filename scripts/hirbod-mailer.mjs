import http from "node:http";
import crypto from "node:crypto";

const HOST = process.env.HIRBOD_MAILER_HOST || "127.0.0.1";
const PORT = Number(process.env.HIRBOD_MAILER_PORT || 8787);
const FROM = process.env.HIRBOD_MAIL_FROM || "";
const API_KEY = process.env.RESEND_API_KEY;
const SECRET_LIST = (process.env.SEND_EMAIL_HOOK_SECRET || "").split("|").filter(Boolean);

if (!FROM || !API_KEY || !API_KEY.startsWith("re_") || SECRET_LIST.length === 0) {
  throw new Error("Mailer sender identity or required credentials are missing");
}

function verifySignature(raw, headers) {
  const id = headers["webhook-id"] || "";
  const timestamp = headers["webhook-timestamp"] || "";
  const signatures = (headers["webhook-signature"] || "").split(/\s+/);
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id) || !/^\d{10,}$/.test(timestamp)) return false;

  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;

  const signed = `${id}.${timestamp}.${raw}`;
  for (const secret of SECRET_LIST) {
    const match = /^v1,whsec_([A-Za-z0-9+/=]+)$/.exec(secret);
    if (!match) continue;
    const key = Buffer.from(match[1], "base64");
    const expected = crypto.createHmac("sha256", key).update(signed).digest();
    for (const item of signatures) {
      const part = /^v1,([A-Za-z0-9+/=]+)$/.exec(item);
      if (!part) continue;
      const received = Buffer.from(part[1], "base64");
      if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) return true;
    }
  }
  return false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function makeVerifyUrl(siteUrl, redirectTo, tokenHash, type) {
  const site = new URL(siteUrl);
  const redirect = new URL(redirectTo || siteUrl);
  if (site.protocol !== "https:" || redirect.protocol !== "https:" || redirect.origin !== site.origin) {
    throw new Error("Unsafe authentication redirect URL");
  }
  const url = new URL("/auth/v1/verify", site);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("redirect_to", redirect.href);
  return url.href;
}

const ACTIONS = {
  signup: ["تأیید حساب کاربری", "برای فعال‌سازی حساب خود، دکمه زیر را انتخاب کنید.", "تأیید حساب"],
  invite: ["دعوت به هیربد خودرو", "برای پذیرش دعوت و ورود به سامانه، دکمه زیر را انتخاب کنید.", "پذیرش دعوت"],
  magiclink: ["ورود به هیربد خودرو", "برای ورود امن به سامانه، دکمه زیر را انتخاب کنید.", "ورود به سامانه"],
  recovery: ["بازیابی رمز عبور", "درخواست تغییر رمز عبور حساب شما ثبت شده است. برای تعیین رمز جدید، دکمه زیر را انتخاب کنید.", "تغییر رمز عبور"],
  email_change: ["تأیید تغییر ایمیل", "برای تأیید تغییر نشانی ایمیل حساب خود، دکمه زیر را انتخاب کنید.", "تأیید ایمیل جدید"],
  reauthentication: ["تأیید هویت", "برای تکمیل عملیات امنیتی حساب، کد زیر را وارد کنید.", "تأیید هویت"],
  email: ["تأیید ایمیل", "برای تأیید نشانی ایمیل خود، دکمه زیر را انتخاب کنید.", "تأیید ایمیل"]
};

const NOTIFICATIONS = {
  password_changed_notification: ["رمز عبور تغییر کرد", "رمز عبور حساب هیربد خودرو تغییر کرده است. اگر این کار را شما انجام نداده‌اید، با مدیر سامانه تماس بگیرید."],
  email_changed_notification: ["ایمیل حساب تغییر کرد", "نشانی ایمیل حساب هیربد خودرو تغییر کرده است. اگر این کار را شما انجام نداده‌اید، با مدیر سامانه تماس بگیرید."],
  phone_changed_notification: ["شماره تلفن حساب تغییر کرد", "شماره تلفن حساب هیربد خودرو تغییر کرده است."],
  identity_linked_notification: ["روش ورود جدید متصل شد", "یک روش ورود جدید به حساب هیربد خودرو متصل شده است."],
  identity_unlinked_notification: ["روش ورود حذف شد", "یک روش ورود از حساب هیربد خودرو حذف شده است."],
  mfa_factor_enrolled_notification: ["روش تأیید دومرحله‌ای فعال شد", "یک روش تأیید دومرحله‌ای برای حساب شما فعال شده است."],
  mfa_factor_unenrolled_notification: ["روش تأیید دومرحله‌ای غیرفعال شد", "یک روش تأیید دومرحله‌ای برای حساب شما غیرفعال شده است."]
};

async function deliver(message, eventId, index) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${eventId}-${index}`
    },
    body: JSON.stringify({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
}

function buildMessages(payload) {
  const user = payload?.user || {};
  const data = payload?.email_data || {};
  const action = data.email_action_type;
  const messages = [];

  function add(recipient, title, description, button, link, otp, index) {
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new Error("Invalid email recipient");
    }
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeOtp = otp ? escapeHtml(otp) : "";
    const safeLink = link ? escapeHtml(link) : "";
    const linkHtml = link
      ? `<p style="text-align:center;margin:28px 0"><a href="${safeLink}" style="background:#0e8790;color:#fff;padding:13px 25px;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p>`
      : "";
    const otpHtml = safeOtp ? `<p style="font-size:24px;font-weight:bold;letter-spacing:4px;text-align:center" dir="ltr">${safeOtp}</p>` : "";
    messages.push({
      to: recipient,
      subject: title,
      html: `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="margin:0;background:#f4f7f8;font-family:Tahoma,Arial,sans-serif;color:#173042"><div style="max-width:560px;margin:32px auto;background:#fff;padding:32px;border-radius:14px"><h2>${safeTitle}</h2><p style="line-height:2">${safeDescription}</p>${linkHtml}${otpHtml}<p style="font-size:12px;color:#718096;line-height:2">اگر این درخواست از طرف شما نبوده است، این پیام را نادیده بگیرید.</p><hr><p style="font-size:12px;color:#718096">هیربد خودرو</p></div></body></html>`,
      text: `${title}\n\n${description}${link ? `\n\n${button}: ${link}` : ""}${otp ? `\n\nکد: ${otp}` : ""}\n\nاگر این درخواست از طرف شما نبوده است، این پیام را نادیده بگیرید.`,
      index
    });
  }

  if (NOTIFICATIONS[action]) {
    add(user.email, NOTIFICATIONS[action][0], NOTIFICATIONS[action][1], "", "", "", 0);
    return messages;
  }

  if (!ACTIONS[action]) throw new Error("Unsupported email action");
  const [title, description, button] = ACTIONS[action];
  const siteUrl = data.site_url;
  const redirectTo = data.redirect_to || siteUrl;

  if (action === "email_change" && data.token_hash_new && data.token_hash) {
    add(
      user.email, title, "برای تأیید تغییر ایمیل در نشانی فعلی، لینک زیر را انتخاب کنید.",
      button, makeVerifyUrl(siteUrl, redirectTo, data.token_hash_new, action), data.token, 0
    );
    add(
      user.new_email, title, "برای تأیید نشانی ایمیل جدید، لینک زیر را انتخاب کنید.",
      button, makeVerifyUrl(siteUrl, redirectTo, data.token_hash, action), data.token_new, 1
    );
  } else {
    const recipient = action === "email_change" ? (user.new_email || user.email) : user.email;
    const tokenHash = data.token_hash || data.token_hash_new;
    const otp = data.token || data.token_new || "";
    const link = tokenHash ? makeVerifyUrl(siteUrl, redirectTo, tokenHash, action) : "";
    if (!link && !otp) throw new Error("Verification token is missing");
    add(recipient, title, description, button, link, otp, 0);
  }
  return messages;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }
  if (req.method !== "POST" || req.url !== "/hooks/send-email") {
    return sendJson(res, 404, { error: "Not found" });
  }

  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString("utf8");
      if (Buffer.byteLength(raw) > 65536) {
        return sendJson(res, 413, { error: "Payload too large" });
      }
    }

    if (!verifySignature(raw, req.headers)) {
      return sendJson(res, 401, { error: "Invalid webhook signature" });
    }

    const payload = JSON.parse(raw);
    const eventId = req.headers["webhook-id"];
    const messages = buildMessages(payload);

    for (let i = 0; i < messages.length; i++) {
      await deliver(messages[i], eventId, i);
    }

    console.log(`[PASS] Email event delivered: ${payload.email_data.email_action_type}`);
    return sendJson(res, 200, {});
  } catch (error) {
    console.error(`[ERROR] Mail delivery failed: ${error?.message || "unknown error"}`);
    return sendJson(res, 500, { error: "Email delivery failed" });
  }
});

server.listen(PORT, HOST, () => console.log(`[READY] Hirbod mailer listening on ${HOST}:${PORT}`));
