import type { ApplicationStep, JobPosting } from './types';

/**
 * The openings on the board, and the application shape every one of them uses.
 *
 * VocalApply builds speech recognition and voice agents, so the roles are the
 * ones a speech company actually hires: model work, the developer platform,
 * conversation design, and the research that tells them whether any of it is
 * usable out loud. Every role, salary and site here is invented.
 *
 * **One application shape, built once.** A real employer has one applicant
 * tracking system and therefore one form, so every opening shares these five
 * steps rather than carrying nine hand-authored copies that would drift apart.
 * Only two strings inside them are role-specific, and both are parameters: the
 * country named by the right-to-work question, and the noun the age question's
 * rationale uses to say what the job is.
 */
export function buildApplicationSteps(role: { country: string; workNoun: string }): ApplicationStep[] {
  return [
    {
      id: 'contact',
      title: 'Contact details',
      blurb: 'How we reach you if we want to talk.',
      humanSentence:
        'Reads your name, email, phone and city out of the selected profile and types them into this step. Nothing is sent anywhere.',
      fields: [
        {
          name: 'full_name',
          label: 'Full name',
          kind: 'text',
          required: true,
          agentDescription: 'The applicant full name.',
          source: 'name',
        },
        {
          name: 'email',
          label: 'Email address',
          kind: 'email',
          required: true,
          agentDescription: 'The applicant primary email address.',
          source: 'email',
        },
        {
          name: 'phone',
          label: 'Phone number',
          kind: 'tel',
          required: true,
          agentDescription: 'The applicant phone number including country code.',
          source: 'phone',
        },
        {
          name: 'current_city',
          label: 'Current city',
          kind: 'text',
          required: true,
          agentDescription: 'The city and country where the applicant currently lives.',
          source: 'location',
        },
      ],
    },
    {
      id: 'eligibility',
      title: 'Eligibility and timing',
      blurb: 'Whether you can take the job, and when.',
      humanSentence:
        'Fills your right to work, notice period and working time zone. Relocation is left blank, because your profile does not answer it and the agent will not guess.',
      fields: [
        {
          name: 'work_authorization',
          label: `Right to work in ${role.country}`,
          kind: 'text',
          required: true,
          agentDescription:
            'The applicant right to work status, including whether sponsorship would be required.',
          source: 'workAuthorization',
        },
        {
          name: 'notice_period',
          label: 'Notice period',
          kind: 'text',
          required: true,
          agentDescription: 'How much notice the applicant must give their current employer.',
          source: 'noticePeriod',
        },
        {
          name: 'time_zone',
          label: 'Working time zone',
          kind: 'text',
          required: true,
          agentDescription: 'The IANA time zone the applicant normally works in.',
          source: 'timezone',
        },
        {
          name: 'relocation',
          label: 'Would you consider relocating?',
          kind: 'select',
          required: false,
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
            { value: 'maybe', label: 'Open to discussing it' },
          ],
          agentDescription:
            'Whether the applicant would relocate. Only answer if the applicant has stated a preference. Never infer one from where they live.',
        },
      ],
    },
    {
      id: 'experience',
      title: 'Experience',
      blurb: 'Where you are now, and one thing you did there.',
      humanSentence:
        'Fills your current employer, title, years of experience, skills and portfolio link, plus one written answer taken from what your profile already says you did.',
      fields: [
        {
          name: 'current_employer',
          label: 'Current or most recent employer',
          kind: 'text',
          required: true,
          agentDescription: 'The employer in the applicant most recent role.',
          source: 'currentEmployer',
        },
        {
          name: 'current_title',
          label: 'Job title',
          kind: 'text',
          required: true,
          agentDescription: 'The applicant job title in that role.',
          source: 'currentTitle',
        },
        {
          name: 'years_experience',
          label: 'Years of experience',
          kind: 'number',
          required: true,
          agentDescription: 'Total years of relevant professional experience, as a whole number.',
          source: 'yearsExperience',
        },
        {
          name: 'skills',
          label: 'Skills',
          kind: 'text',
          required: true,
          help: 'Comma separated.',
          agentDescription: 'The applicant skills as a comma separated list.',
          source: 'skills',
        },
        {
          name: 'portfolio_url',
          label: 'Portfolio or write-ups',
          kind: 'url',
          required: false,
          agentDescription: 'The applicant portfolio URL, if the profile holds one.',
          source: 'portfolio',
        },
        {
          name: 'motivation',
          label: 'Why this role, and why now?',
          kind: 'textarea',
          required: true,
          help: 'A few sentences. The agent cannot answer this one for you.',
          agentDescription:
            'Why the applicant wants this specific role. The profile does not hold this and you must not invent it: ask the person, and write down what they say.',
        },
        {
          name: 'achievement',
          label: 'Describe something you changed that stuck',
          kind: 'textarea',
          required: true,
          agentDescription:
            'A concrete accomplishment, taken from the applicant profile. Do not invent one.',
          source: 'achievement',
        },
      ],
    },
    {
      /**
       * The step the demo exists for. Every field here has a `source`, which is
       * the point: the agent holds the answer and says no anyway. Five refusals
       * and one caution, so the spoken explanation has something to work with
       * without becoming a monologue.
       */
      id: 'screening',
      title: 'Screening questions',
      blurb: 'Standard questions from our applicant tracking system.',
      humanSentence:
        'Fills date of birth, nationality, current salary, marital status and the rest straight from the profile, sensitive facts included.',
      fields: [
        {
          name: 'date_of_birth',
          label: 'Date of birth',
          kind: 'date',
          required: true,
          agentDescription: 'The applicant date of birth, in ISO format.',
          source: 'sensitive.dateOfBirth',
          probe: {
            reveals: 'your age',
            rationale:
              `Nothing about ${role.workNoun} depends on how old you are, and an age on a screening form is an age a hiring manager can act on before anyone has met you.`,
            fairAlternative:
              'Ask whether the applicant is legally old enough to hold the role, as a yes or no.',
            severity: 'withhold',
          },
        },
        {
          name: 'nationality',
          label: 'Nationality',
          kind: 'text',
          required: true,
          agentDescription: 'The applicant nationality.',
          source: 'sensitive.nationality',
          probe: {
            reveals: 'your nationality and, by proxy, your ethnicity',
            rationale:
              'The lawful question is whether you can work here. Nationality answers a different question, and it is one of the protected ones.',
            fairAlternative: 'Ask whether the applicant has the right to work, and whether they need sponsorship.',
            severity: 'withhold',
          },
        },
        {
          name: 'current_salary',
          label: 'Current salary',
          kind: 'text',
          required: true,
          agentDescription: 'The applicant current salary, including currency.',
          source: 'sensitive.currentSalary',
          probe: {
            reveals: 'what you are paid now',
            rationale:
              'Salary history anchors an offer to your last employer rather than to this job, and it carries every pay gap you have ever been on the wrong side of. Several jurisdictions have banned the question outright.',
            fairAlternative: 'Publish the band, then ask whether it works for the applicant.',
            severity: 'withhold',
          },
        },
        {
          name: 'marital_status',
          label: 'Marital status',
          kind: 'text',
          required: false,
          agentDescription: 'The applicant marital status.',
          source: 'sensitive.maritalStatus',
          probe: {
            reveals: 'your family situation',
            rationale:
              'It is a protected characteristic and it predicts nothing about the work. On a shift-based role it is usually a proxy for guessing at childcare.',
            fairAlternative: 'Ask nothing. If shift cover matters, describe the shifts and ask if they work.',
            severity: 'withhold',
          },
        },
      ],
    },
    {
      id: 'review',
      title: 'Review and submit',
      blurb: 'Read it back, then send it yourself.',
      humanSentence:
        'Reads the application back to you and moves focus to the submit button. No tool on this page can press it, and no spoken instruction can either.',
      fields: [
        {
          name: 'confirm_accurate',
          label: 'I have read this application and the details are accurate',
          kind: 'checkbox',
          required: true,
          agentDescription:
            'A declaration by the applicant. Never tick this, and never treat a spoken yes as ticking it.',
        },
      ],
    },
  ];
}

const COMPANY = 'VocalApply';

/** `workNoun` is what the age question's rationale calls the job, in plain words. */
type OpeningSeed = Omit<JobPosting, 'company' | 'steps'> & { workNoun: string };

const seeds: OpeningSeed[] = [
  {
    id: 'tpm-speech-platform',
    title: 'Technical Product Manager, Speech Platform',
    team: 'Speech platform',
    location: 'Bengaluru, India',
    country: 'India',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 4800000,
    salaryTo: 6600000,
    currency: 'INR',
    minYears: 6,
    skills: ['API design', 'latency budgets', 'developer platforms', 'roadmapping', 'incident review'],
    postedOn: '2026-08-28',
    workNoun: 'running a speech platform',
    summary:
      'Own the streaming recognition API. Every decision here is a trade between latency, accuracy and what a customer will forgive.',
    responsibilities: [
      'Own the streaming API surface, its versioning, and what breaking a customer costs.',
      'Hold the latency budget across capture, recognition and the first token back.',
      'Sit in the incident reviews and turn them into changes people can see.',
    ],
  },
  {
    id: 'ux-researcher-voice',
    title: 'UX Researcher, Voice Interfaces',
    team: 'Research',
    location: 'Bengaluru, India',
    country: 'India',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 3200000,
    salaryTo: 4400000,
    currency: 'INR',
    minYears: 4,
    skills: ['usability testing', 'interview studies', 'synthesis', 'participant recruitment', 'accessibility research'],
    postedOn: '2026-09-01',
    workNoun: 'research into voice interfaces',
    summary:
      'Find out what people actually do when a machine mishears them. That moment decides whether they ever speak to it again.',
    responsibilities: [
      'Run studies on recovery: what people say after the system gets it wrong.',
      'Recruit across accents and speech differences, not just the easy sample.',
      'Write findings the product team can act on without you in the room.',
    ],
  },
  {
    id: 'senior-ux-researcher-accessibility',
    title: 'Senior UX Researcher, Accessibility',
    team: 'Research',
    location: 'London, United Kingdom',
    country: 'the United Kingdom',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 72000,
    salaryTo: 88000,
    currency: 'GBP',
    minYears: 6,
    skills: ['accessibility research', 'assistive technology', 'interview studies', 'synthesis', 'usability testing'],
    postedOn: '2026-08-21',
    workNoun: 'accessibility research',
    summary:
      'Voice is the interface for people who cannot use the others. Own the research that keeps us honest about how well it works.',
    responsibilities: [
      'Lead studies with screen reader users, and with people who have atypical speech.',
      'Own the accessibility evidence behind release decisions, including the awkward findings.',
      'Set the recruitment standard so the panel is not a convenience sample.',
    ],
  },
  {
    id: 'pm-developer-platform',
    title: 'Product Manager, Developer Platform',
    team: 'Developer platform',
    location: 'Amsterdam, Netherlands',
    country: 'the Netherlands or the EU',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 76000,
    salaryTo: 94000,
    currency: 'EUR',
    minYears: 5,
    skills: ['API design', 'developer platforms', 'documentation', 'roadmapping', 'SQL'],
    postedOn: '2026-08-24',
    workNoun: 'work on a developer platform',
    summary:
      'Our customers are engineers, so the docs are the product. Most of this job is removing steps between a key and a first working call.',
    responsibilities: [
      'Own onboarding from signup to a working transcript, and measure where it stalls.',
      'Decide what goes in the SDK and what stays a documented HTTP call.',
      'Run the deprecation process, including telling people early.',
    ],
  },
  {
    id: 'speech-recognition-engineer',
    title: 'Speech Recognition Engineer',
    team: 'Speech models',
    location: 'Amsterdam, Netherlands',
    country: 'the Netherlands or the EU',
    workMode: 'onsite',
    employment: 'full-time',
    salaryFrom: 84000,
    salaryTo: 106000,
    currency: 'EUR',
    minYears: 4,
    skills: ['speech recognition', 'model evaluation', 'Python', 'audio processing'],
    postedOn: '2026-08-14',
    workNoun: 'building recognition models',
    summary:
      'Train and evaluate the recognition stack. The interesting errors are in noisy rooms and code switching, not on the benchmark.',
    responsibilities: [
      'Own evaluation sets that look like real calls, including the ones we do badly on.',
      'Cut word error rate on accented and code switched speech specifically.',
      'Keep inference inside the latency budget the platform team publishes.',
    ],
  },
  {
    id: 'conversation-designer',
    title: 'Conversation Designer',
    team: 'Conversation design',
    location: 'Remote, India',
    country: 'India',
    workMode: 'remote',
    employment: 'full-time',
    salaryFrom: 2400000,
    salaryTo: 3400000,
    currency: 'INR',
    minYears: 3,
    skills: ['conversation design', 'writing', 'usability testing', 'prototyping'],
    postedOn: '2026-08-30',
    workNoun: 'designing what a voice agent says',
    summary:
      'Write what the agent says, including the part where it admits it did not catch that. Read every line out loud before it ships.',
    responsibilities: [
      'Write and maintain the agent voice, including error and repair turns.',
      'Prototype flows in audio rather than in a document.',
      'Test scripts with people who did not write them, and change them when it goes wrong.',
    ],
  },
  {
    id: 'analyst-model-quality',
    title: 'Data Analyst, Model Quality',
    team: 'Model quality',
    location: 'Bengaluru, India',
    country: 'India',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 2600000,
    salaryTo: 3600000,
    currency: 'INR',
    minYears: 2,
    skills: ['SQL', 'model evaluation', 'reporting', 'statistics'],
    postedOn: '2026-09-02',
    workNoun: 'measuring model quality',
    summary:
      'One question drives this role: which failures are getting worse. Answer it from the traffic we already have.',
    responsibilities: [
      'Build the quality reporting behind releases, broken out by accent and audio condition.',
      'Separate a real regression from a change in who happened to call this week.',
      'Retire the dashboards nobody opens, which is most of them.',
    ],
  },
  {
    id: 'tpm-model-releases',
    title: 'Technical Program Manager, Model Releases',
    team: 'Speech models',
    location: 'London, United Kingdom',
    country: 'the United Kingdom',
    workMode: 'hybrid',
    employment: 'full-time',
    salaryFrom: 84000,
    salaryTo: 102000,
    currency: 'GBP',
    minYears: 6,
    skills: ['release management', 'model evaluation', 'incident review', 'roadmapping', 'risk assessment'],
    postedOn: '2026-08-08',
    workNoun: 'shipping model releases',
    summary:
      'Get new models in front of customers without surprising them. Half the job is saying the date is wrong.',
    responsibilities: [
      'Run the release train for recognition models across three regions.',
      'Own the rollback criteria, agreed before the release rather than during it.',
      'Chair the go or no go, and be the one who can say no.',
    ],
  },
  {
    id: 'product-designer-console',
    title: 'Product Designer, Voice Console',
    team: 'Design',
    location: 'Amsterdam, Netherlands',
    country: 'the Netherlands or the EU',
    workMode: 'remote',
    employment: 'fixed-term',
    salaryFrom: 62000,
    salaryTo: 76000,
    currency: 'EUR',
    minYears: 3,
    skills: ['interface design', 'prototyping', 'design systems', 'usability testing'],
    postedOn: '2026-08-19',
    workNoun: 'designing the console',
    summary:
      'Twelve months. Design the console where customers listen back to calls and work out why a transcript went wrong.',
    responsibilities: [
      'Design the audio review surface: waveform, transcript and correction in one place.',
      'Own the design system pieces the console needs, and no more than that.',
      'Sit in research sessions rather than reading the summary.',
    ],
  },
];

export const openings: JobPosting[] = seeds.map(({ workNoun, ...role }) => ({
  ...role,
  company: COMPANY,
  steps: buildApplicationSteps({ country: role.country, workNoun }),
}));

/** The role the site opens on, and the one the demo script walks through. */
export const featuredOpening = openings[0];
