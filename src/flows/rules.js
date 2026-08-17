// rules.js — standing rules management.
import { col } from '../db.js';

export async function listRules() {
  const rules = await col('admin_rules').find({ active: true }).sort({ createdAt: 1 }).toArray();
  if (!rules.length) return 'Abhi koi active rule nahi hai.';
  const lines = rules.map((r, i) => `${i + 1}. ${r.rule}`);
  return '📋 Active rules:\n' + lines.join('\n') + '\n\nRule hatane ke liye: "rule <number> hata do"';
}

export async function addRule(ruleText) {
  await col('admin_rules').insertOne({ rule: ruleText, active: true, createdAt: new Date() });
  return '✅ Rule set ho gaya. Ab se ye har customer conversation mein apply hoga.';
}

export async function removeRule(index) {
  const rules = await col('admin_rules').find({ active: true }).sort({ createdAt: 1 }).toArray();
  if (index < 1 || index > rules.length) return '❌ Galat number. "rules dikhao" se sahi number dekho.';
  const target = rules[index - 1];
  await col('admin_rules').updateOne({ _id: target._id }, { $set: { active: false } });
  return `✅ Rule ${index} deactivate kar diya.`;
}

export default { listRules, addRule, removeRule };
