// Mail versturen via Forward Email (https://forwardemail.net): de offertelink
// naar de klant, een melding aan jou als er getekend is, en een bevestiging
// aan de klant. Forward Email stuurt ook de mail die op het domein binnenkomt
// door naar je eigen inbox, dus antwoorden van klanten komen gewoon aan.
//
//   MAIL_VAN          afzender, bv. "Mediaspot <info@mediaspot.nl>"; dat adres
//                     moet een alias zijn in Forward Email
//   MAIL_WACHTWOORD   het wachtwoord dat Forward Email voor die alias maakt
//                     (Aliassen → Wachtwoord genereren); alleen voor die alias
//   MAIL_MELDINGEN    optioneel: waar de melding "getekend" heen gaat; anders
//                     naar het afzendadres zelf (dat Forward Email doorstuurt)
//
// Zonder MAIL_VAN of MAIL_WACHTWOORD staat mailen uit; de app opent dan gewoon
// je eigen mailprogramma, zoals voorheen.

const API = "https://api.forwardemail.net/v1/emails";
const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

/** Een geldig los e-mailadres (geen lijst, geen naam ervoor). */
function geldig(adres) {
  return typeof adres === "string" && adres.length <= 200 && EMAIL_RE.test(adres);
}

/** "Mediaspot <info@mediaspot.nl>" → "info@mediaspot.nl" */
function adresVan(van) {
  const m = /<([^>]+)>\s*$/.exec(String(van || ""));
  const a = (m ? m[1] : String(van || "")).trim();
  return geldig(a) ? a : "";
}

function instellingen() {
  const van = process.env.MAIL_VAN || "";
  const meldingen = process.env.MAIL_MELDINGEN || "";
  return {
    van,
    gebruiker: adresVan(van),
    wachtwoord: process.env.MAIL_WACHTWOORD || "",
    meldingen: geldig(meldingen) ? meldingen : adresVan(van)
  };
}

/** De echte verzender. fetchFn alleen voor tests. */
function forwardEmail(fetchFn) {
  return {
    aan() { const i = instellingen(); return !!(i.gebruiker && i.wachtwoord); },
    /** Het afzendadres, zonder naam. */
    van() { return instellingen().gebruiker; },
    /** Waar de melding "getekend" heen gaat. */
    meldingen() { return instellingen().meldingen; },
    /** m: { aan, onderwerp, tekst, html, bijlagen: [{ naam, base64, type }], antwoordAan } */
    async verstuur(m) {
      const i = instellingen();
      const body = { from: i.van, to: m.aan, subject: m.onderwerp, text: m.tekst, html: m.html };
      if (m.antwoordAan) body.replyTo = m.antwoordAan;
      if (m.bijlagen && m.bijlagen.length) {
        body.attachments = m.bijlagen.map((b) => ({ filename: b.naam, content: b.base64, encoding: "base64", contentType: b.type || "application/pdf" }));
      }
      const opts = {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(i.gebruiker + ":" + i.wachtwoord).toString("base64"),
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      };
      if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(10000);
      const r = await (fetchFn || fetch)(API, opts);
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      if (!r.ok) throw new Error((j && (j.message || j.error)) || "Forward Email gaf " + r.status);
      return { id: (j && j.id) || "" };
    }
  };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Tekst als html: veilig, alinea's en regels behouden, links klikbaar. */
function tekstHtml(tekst) {
  return String(tekst || "").replace(/\r/g, "").trim().split(/\n{2,}/).map((alinea) =>
    '<p style="margin:0 0 16px">' + esc(alinea).replace(/https?:\/\/[^\s<]+/g, (u) =>
      '<a href="' + u + '" style="color:#FC6A2F;word-break:break-all">' + u + "</a>").replace(/\n/g, "<br>") + "</p>"
  ).join("");
}

/** De mail in de huisstijl: logo, tekst, eventueel een knop, en de bedrijfsgegevens. */
function mailHtml(o) {
  const b = o.bedrijf || {};
  const voet = [b.naam, String(b.adres || "").replace(/\n/g, ", "), b.telefoon, b.web].filter((x) => x && String(x).trim()).map(esc).join(" &middot; ");
  const knop = o.knop
    ? '<tr><td style="padding:8px 0 4px"><a href="' + esc(o.knop.url) + '" style="display:inline-block;background:#FC6A2F;color:#ffffff;' +
      'text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:999px">' + esc(o.knop.tekst) + "</a></td></tr>"
    : "";
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#F6F7F5">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F5"><tr><td align="center" style="padding:32px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px">' +
    '<tr><td style="padding:32px 32px 28px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#1D1D1F;font-size:16px;line-height:1.6">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    (o.logo ? '<tr><td style="padding-bottom:24px"><img src="' + esc(o.logo) + '" width="150" alt="' + esc(b.naam || "Mediaspot") + '" style="display:block;border:0;height:auto"></td></tr>' : "") +
    "<tr><td>" + tekstHtml(o.tekst) + "</td></tr>" + knop +
    "</table></td></tr></table>" +
    (voet ? '<p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8A8A8E">' + voet + "</p>" : "") +
    "</td></tr></table></body></html>";
}

module.exports = { forwardEmail, geldig, adresVan, mailHtml, tekstHtml, instellingen, EMAIL_RE };
