  const lower = text.toLowerCase();
  if (/^(menu|help|start)$/.test(lower) || /^(hi|hello|namaste|hey)$/.test(lower)) {
    pending.delete(senderNumber);
    return MENU;
  }
  if (/\.?stop\b/.test(lower) && !/botanist|stopover|non/.test(lower)) {
    await saveSettings({ botPaused: true });
    return '⏸️ Bot STOP ho gaya. Ab customer messages ka reply nahi dega. \".start\" bhejo chalu karne ke liye.';
  }
  if (/\.?start\b/.test(lower) && !/starter|restart/.test(lower)) {
    await saveSettings({ botPaused: false });
    return '▶️ Bot START ho gaya. Ab customer messages ka reply dega.';
  }
  if (/\.?status\b/.test(lower)) {
    const s = await getSettings();
    return s.botPaused ? '⏸️ Bot status: STOPPED (reply nahi de raha).' : '▶️ Bot status: RUNNING (reply de raha).';
  }
  const bm = text.match(/\.?block\s+([0-9+\-\s]+)/i);
  if (bm) {
    const num = normalizeNumber(bm[1]);
    if (!num) return '❌ Number sahi se do: ".block 91XXXXXXXXXX"';
    const s = await getSettings();
    const existing = new Set((s.blockedNumbers || '').split(',').map(normalizeNumber).filter(Boolean));
    existing.add(num);
    await saveSettings({ blockedNumbers: [...existing].join(',') });
    return '🚫 Number ' + num + ' block ho gaya. Bot isse reply nahi karega.';
  }
  const um = text.match(/\.?unblock\s+([0-9+\-\s]+)/i);
  if (um) {
    const num = normalizeNumber(um[1]);
    const s = await getSettings();
    const existing = new Set((s.blockedNumbers || '').split(',').map(normalizeNumber).filter(Boolean));
    existing.delete(num);
    await saveSettings({ blockedNumbers: [...existing].join(',') });
    return '✅ Number ' + num + ' unblock ho gaya.';
  }
