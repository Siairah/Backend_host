/** Mirrors frontend MIN_REGISTRATION_AGE — keep in sync with src/utils/dobValidation.ts */

const MIN_AGE = 16;

function parseLocalYmd(ymd) {
  const s = String(ymd).trim().split("T")[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

export function validateDobForRegistration(dobInput) {
  const birth = parseLocalYmd(dobInput);
  if (!birth) {
    return { ok: false, message: "Invalid date of birth." };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const birthStart = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate());
  if (birthStart > today) {
    return { ok: false, message: "Date of birth cannot be in the future." };
  }
  let age = today.getFullYear() - birth.getFullYear();
  const md = today.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  if (age < MIN_AGE) {
    return { ok: false, message: `You must be at least ${MIN_AGE} years old.` };
  }
  return { ok: true };
}
