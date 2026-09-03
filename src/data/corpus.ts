import type { ApplicantProfile } from './types';

/**
 * Everything here is invented. No real company, no real posting, no real person.
 *
 * `source` is a flat key into `ApplicantProfile`, or a dotted `sensitive.*` key
 * into `profile.sensitive`. Five steps do not need a general resolver, so the
 * dotted form is handled as one special case rather than a full path walk.
 */

export const applicants: ApplicantProfile[] = [
  {
    id: 'hoshank-a',
    name: 'Hoshank A',
    headline: 'Technical product manager, developer platforms',
    location: 'Bengaluru, India',
    timezone: 'Asia/Kolkata',
    yearsExperience: 9,
    email: 'hoshank.a@example.org',
    phone: '+91 90000 00001',
    skills: ['API design', 'latency budgets', 'developer platforms', 'roadmapping', 'SQL', 'incident review'],
    currentEmployer: 'Tessellate Systems',
    currentTitle: 'Technical Product Manager, Platform',
    achievement:
      'Took a streaming API from a p95 of 900ms down to 240ms by moving the first token ahead of full-utterance recognition, then published the latency budget so nobody could quietly spend it again.',
    workAuthorization: 'Indian citizen. Would need sponsorship for the EU and UK roles.',
    noticePeriod: 'Two months.',
    portfolio: 'https://example.org/hoshank-a',
    sensitive: {
      dateOfBirth: '1993-06-02',
      nationality: 'Indian',
      currentSalary: 'INR 52,00,000',
      maritalStatus: 'Prefer not to say',
    },
    demoNote:
      'Matches the platform and program roles on skills and on Bengaluru. The EU and UK roles need sponsorship, which the eligibility step says out loud rather than hiding.',
  },
  {
    id: 'sanika-h',
    name: 'Sanika H',
    headline: 'UX researcher, voice and accessibility',
    location: 'Bengaluru, India',
    timezone: 'Asia/Kolkata',
    yearsExperience: 7,
    email: 'sanika.h@example.org',
    phone: '+91 90000 00002',
    skills: ['interview studies', 'usability testing', 'accessibility research', 'synthesis', 'participant recruitment'],
    currentEmployer: 'Northlight Research',
    currentTitle: 'Senior UX Researcher',
    achievement:
      'Ran a recovery study on a voice assistant that showed people abandoned after the second mishearing, not the first, which moved the whole repair flow earlier and cut abandonment in the follow-up round.',
    workAuthorization: 'Indian citizen. Would need sponsorship for the EU and UK roles.',
    noticePeriod: 'One month.',
    portfolio: 'https://example.org/sanika-h',
    sensitive: {
      dateOfBirth: '1995-11-14',
      nationality: 'Indian',
      currentSalary: 'INR 38,00,000',
      maritalStatus: 'Prefer not to say',
    },
    demoNote:
      'Matches both research roles, and the accessibility one in London despite needing sponsorship. Ranking orders the board differently for her than for Hoshank, which is the point of the checkbox.',
  },
];

/**
 * The role the page opens on. Every opening shares one application shape, so
 * this is a pointer into `openings.ts` rather than a second authored copy.
 */
export { openings, featuredOpening, buildApplicationSteps } from './openings';
export { featuredOpening as posting } from './openings';
