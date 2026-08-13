export function scoringExplanation(t, competition) {
  const mode = competition?.rules?.scoring || 'tops_then_attempts';
  const quota = competition?.rules?.climb_count;
  const available = competition?.rules?.climb_source === 'participant_choice'
    ? quota : (competition?.climbs?.length || quota);
  const explicit = competition?.rules?.counted_climb_count;
  const counted = Number.isInteger(explicit) && explicit >= 1 && explicit <= available ? explicit : quota;
  const best = Number.isInteger(available) && Number.isInteger(counted) && counted < available
    ? ` ${t('scoring.info.best_n', { count: counted, available })}` : '';
  if (mode === 'achievement_points') {
    const points = competition.rules.score_points || { zone: 0, top: 0, flash: 0 };
    return `${t('scoring.info.achievement_points', {
      zone: points.zone,
      topBonus: points.top,
      flashBonus: points.flash,
      top: points.zone + points.top,
      flash: points.zone + points.top + points.flash,
    })}${best}`;
  }
  return `${t(`scoring.info.${mode}`)}${best}`;
}

export function usesPointLeaderboard(competition) {
  return competition?.rules?.scoring !== 'tops_then_attempts';
}
