// onboarding.js — new-user discovery helper.
export async function handleOnboarding(text) {
  const lower = (text || '').toLowerCase();
  if (/^(hi|hello|namaste|hey|hii|salaam)/.test(lower)) {
    return 'Namaste! 🙏 Aapka swagat hai. Main aapki kya madad kar sakta hoon — kis type ka product dhundh rahe hain?';
  }
  return null;
}

export function extractProfileHints(text) {
  const hints = {};
  const t = (text || '').toLowerCase();
  if (/budget|₹|rs\.?|rupee|price range|kitna/.test(t)) hints.budgetRange = t;
  if (/gaming|game/.test(t)) hints.useCase = 'gaming';
  else if (/student|study|college|padhai/.test(t)) hints.useCase = 'student';
  else if (/office|work|business/.test(t)) hints.useCase = 'office';
  else if (/editing|render|video/.test(t)) hints.useCase = 'editing';
  if (/apple|macbook/.test(t)) hints.brandPreference = 'Apple';
  else if (/asus/.test(t)) hints.brandPreference = 'ASUS';
  else if (/hp/.test(t)) hints.brandPreference = 'HP';
  else if (/dell/.test(t)) hints.brandPreference = 'Dell';
  else if (/lenovo/.test(t)) hints.brandPreference = 'Lenovo';
  return hints;
}

export default { handleOnboarding, extractProfileHints };
