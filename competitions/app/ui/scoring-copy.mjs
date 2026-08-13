export function scoringExplanation(t, competition) {
  const mode = competition?.rules?.scoring || 'tops_then_attempts';
  if (mode === 'achievement_points') {
    const points = competition.rules.score_points || { zone: 0, top: 0, flash: 0 };
    return t('scoring.info.achievement_points', {
      zone: points.zone,
      topBonus: points.top,
      flashBonus: points.flash,
      top: points.zone + points.top,
      flash: points.zone + points.top + points.flash,
    });
  }
  return t(`scoring.info.${mode}`);
}

export function usesPointLeaderboard(competition) {
  return competition?.rules?.scoring !== 'tops_then_attempts';
}
