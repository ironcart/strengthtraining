// Snapshot of the Habit Tracker sheet (2026-10-14), used until the app is connected.
const days = ['08', '09', '10', '11', '12', '13', '14'];

export default {
  habits: [{ name: 'No soda', start: '2026-10-08', rate: 8 }],
  log: days.map((d) => ({ date: `2026-10-${d}`, habit: 'No soda', note: '' })),
};
