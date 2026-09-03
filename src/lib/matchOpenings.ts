/**
 * The board search. One implementation, two callers: the filter bar in
 * `RoleBoard.tsx` and the `find_matching_roles` tool both come through here
 * with the same argument shape.
 *
 * That is the point rather than a tidiness preference. A shortlist an agent
 * reads out has to be reproducible by a person with the filter bar, and two
 * implementations would drift the first time one of them was tuned.
 *
 * **Filters are hard. Profile matching is soft.** Everything above the marker
 * comment in the loop can remove a role, and every removal is counted in
 * `removedBy` so a search that returns nothing can be widened instead of
 * abandoned. Everything below it only ranks, and can never hide a role: a
 * person is allowed to apply for the job the ranking thinks is a stretch.
 */

import type { ApplicantProfile, Employment, JobPosting, WorkMode } from '../data/types';

export interface RoleFilters {
  workMode?: WorkMode;
  employment?: Employment;
  /** Case-insensitive substring of the role's location. */
  location?: string;
  team?: string;
  /** A role survives if it mentions at least one. Each further hit also ranks it up. */
  keywords?: string[];
  /** Keeps roles whose band top reaches this. Currencies are never converted. */
  minSalary?: number;
  /** EUR, GBP or INR. Only meaningful alongside minSalary, and never converted. */
  currency?: string;
  /** Rank against the selected person. Defaults to true when there is one. */
  matchProfile?: boolean;
  limit?: number;
}

export interface RoleMatch {
  role: JobPosting;
  score: number;
  /** One line per thing that actually matched. Never empty when the score is above zero. */
  reasons: string[];
}

export interface MatchResult {
  matches: RoleMatch[];
  /** How many roles each filter removed, by filter name. */
  removedBy: Record<string, number>;
  /** How many survived the filters, before `limit` truncated the list. */
  matched: number;
  notes: string[];
}

/** Everything a keyword can match against, lowercased once per role. */
function haystack(role: JobPosting): string {
  return [role.title, role.team, role.location, role.summary, ...role.skills]
    .join(' ')
    .toLowerCase();
}

/** "Bengaluru, India" to ["bengaluru", "india"]. Used to spot a role near someone. */
function placeTokens(location: string): string[] {
  return location
    .split(/[,/]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 2);
}

export function matchOpenings(
  roles: JobPosting[],
  applicant: ApplicantProfile | null,
  filters: RoleFilters = {}
): MatchResult {
  const removedBy: Record<string, number> = {};
  const drop = (key: string) => {
    removedBy[key] = (removedBy[key] ?? 0) + 1;
  };

  const keywords = (filters.keywords ?? [])
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);
  const useProfile = filters.matchProfile !== false && applicant !== null;

  const scored: RoleMatch[] = [];

  for (const role of roles) {
    const text = haystack(role);

    if (filters.workMode && role.workMode !== filters.workMode) {
      drop('workMode');
      continue;
    }
    if (filters.employment && role.employment !== filters.employment) {
      drop('employment');
      continue;
    }
    if (
      filters.location &&
      !role.location.toLowerCase().includes(filters.location.trim().toLowerCase())
    ) {
      drop('location');
      continue;
    }
    if (filters.team && role.team.toLowerCase() !== filters.team.trim().toLowerCase()) {
      drop('team');
      continue;
    }

    const keywordHits = keywords.filter((word) => text.includes(word));
    if (keywords.length > 0 && keywordHits.length === 0) {
      drop('keywords');
      continue;
    }

    if (filters.minSalary !== undefined) {
      if (filters.currency && role.currency !== filters.currency.toUpperCase()) {
        drop('currency');
        continue;
      }
      if (role.salaryTo < filters.minSalary) {
        drop('minSalary');
        continue;
      }
    }

    // ---- soft ranking. Nothing below this line removes a role. --------------
    let score = 0;
    const reasons: string[] = [];

    if (keywordHits.length > 0) {
      score += keywordHits.length;
      reasons.push(`Mentions ${keywordHits.join(', ')}`);
    }

    if (useProfile && applicant) {
      const skillHits = applicant.skills.filter((skill) => text.includes(skill.toLowerCase()));
      if (skillHits.length > 0) {
        score += Math.min(skillHits.length, 4);
        reasons.push(`Asks for ${skillHits.slice(0, 4).join(', ')}, which is on your profile`);
      }

      if (role.workMode === 'remote') {
        score += 2;
        reasons.push('Remote, so where you live is not a constraint');
      } else if (placeTokens(applicant.location).some((token) => text.includes(token))) {
        score += 3;
        reasons.push(`Near you, in ${role.location}`);
      }

      if (applicant.yearsExperience >= role.minYears) {
        score += 2;
        reasons.push(`Asks for ${role.minYears} years, and you have ${applicant.yearsExperience}`);
      }
    }

    scored.push({ role, score, reasons });
  }

  // The tie-break is load-bearing: an unfiltered board must come back in corpus
  // order, because the board renders this result directly and the featured role
  // is simply the first one.
  const order = new Map(roles.map((role, index) => [role.id, index]));
  scored.sort(
    (a, b) => b.score - a.score || (order.get(a.role.id) ?? 0) - (order.get(b.role.id) ?? 0)
  );

  const notes: string[] = [];
  if (filters.minSalary !== undefined && !filters.currency) {
    notes.push(
      'Bands were compared as plain numbers. Currencies are not converted, so pass a currency to compare like with like.'
    );
  }
  if (useProfile && applicant) {
    notes.push(`Ranked against ${applicant.name}. Ranking never removes a role, it only orders them.`);
  }
  if (scored.length === 0 && Object.keys(removedBy).length > 0) {
    notes.push('Nothing survived the filters. removedBy says which one to relax.');
  }

  const matched = scored.length;
  return {
    matches: filters.limit && filters.limit > 0 ? scored.slice(0, filters.limit) : scored,
    removedBy,
    matched,
    notes,
  };
}

/**
 * Runs at boot beside the other checks. It asserts the property the whole
 * design rests on, rather than a specific ranking: **a filter can remove a
 * role and the profile ranking never can.**
 */
export function __selfCheck(roles: JobPosting[], applicants: ApplicantProfile[]): string {
  if (roles.length === 0) throw new Error('board self-check: there are no roles');

  const everything = matchOpenings(roles, null, {});
  if (everything.matched !== roles.length) {
    throw new Error(
      `board self-check: an unfiltered search returned ${everything.matched} of ${roles.length}`
    );
  }
  if (everything.matches[0].role.id !== roles[0].id) {
    throw new Error('board self-check: an unfiltered search did not come back in corpus order');
  }

  for (const applicant of applicants) {
    const ranked = matchOpenings(roles, applicant, { matchProfile: true });
    if (ranked.matched !== roles.length) {
      throw new Error(
        `board self-check: ranking for ${applicant.id} removed ${roles.length - ranked.matched} role(s), and ranking must never remove one`
      );
    }
    for (const match of ranked.matches) {
      if (match.score > 0 && match.reasons.length === 0) {
        throw new Error(`board self-check: ${match.role.id} scored ${match.score} with no reason given`);
      }
    }
  }

  const remoteOnly = matchOpenings(roles, null, { workMode: 'remote' });
  const remoteCount = roles.filter((role) => role.workMode === 'remote').length;
  if (remoteOnly.matched !== remoteCount) {
    throw new Error('board self-check: the work mode filter did not remove what it should have');
  }
  if (remoteCount < roles.length && !remoteOnly.removedBy.workMode) {
    throw new Error('board self-check: a filter removed roles without reporting it in removedBy');
  }

  return `board self-check passed: ${roles.length} roles, filters remove and report, ranking never removes`;
}
