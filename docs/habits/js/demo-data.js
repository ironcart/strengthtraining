// Snapshot of the Habit Tracker sheet (2026-10-26), used until the app is connected.
const days = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'];

export default {
  habits: [
    { name: 'No soda', start: '2026-10-08', rate: 8, unit: '$' },
    { name: 'No browsing después de las 8:45pm', start: '2026-10-26', rate: 2, unit: 'hours' },
  ],
  log: days.map((d) => ({ date: `2026-10-${d}`, habit: 'No soda', note: '' })),
};
