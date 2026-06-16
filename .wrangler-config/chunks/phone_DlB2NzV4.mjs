globalThis.process ??= {};
globalThis.process.env ??= {};
const PHONE_PATTERN = new RegExp("^01[3-9]\\d{8}$");
function normalizeBangladeshPhone(input) {
  const stripped = String(input ?? "").replace(/\D/g, "");
  let local;
  if (!stripped) {
    return { ok: false, reason: "EMPTY" };
  }
  if (stripped.length === 13 && stripped.startsWith("880")) {
    local = "0" + stripped.slice(3);
  } else if (stripped.length === 11 && stripped.startsWith("0")) {
    local = stripped;
  } else if (stripped.length === 10 && stripped.startsWith("1")) {
    local = "0" + stripped;
  } else {
    return { ok: false, reason: "INVALID_BD_MOBILE" };
  }
  if (!PHONE_PATTERN.test(local)) {
    return { ok: false, reason: "INVALID_BD_MOBILE" };
  }
  return { ok: true, local, phone: "+88" + local };
}
export {
  normalizeBangladeshPhone as n
};
