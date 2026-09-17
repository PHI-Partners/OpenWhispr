import type { Meeting, MeetingSummary, TranscriptUpdate } from '@shared/ipc';

const PREVIEW_TRANSCRIPT = `Good morning everyone, let's get started with our weekly standup.
Thanks for joining. I'll go first — I wrapped up the authentication refactor yesterday and opened a PR for review.
Nice work. Any blockers on that?
No blockers. The test suite is green and I've updated the migration scripts.
Great. I've been working on the dashboard performance issues. The virtualized list is rendering much faster now, but I still need to profile the chart components.
Have you tried lazy-loading the chart library? That helped us a lot on the analytics page.
That's a good idea, I'll look into that today.
Moving on to the API team — any updates on the webhook endpoint?
We shipped the retry logic yesterday. Failed deliveries now get exponential backoff with a 24-hour TTL.
Perfect. Let's make sure we document that in the API changelog before the release.
Will do. I'll also add the new rate limit headers to the OpenAPI spec.
Anything else before we wrap up? Alright, thanks everyone. Let's sync again on Thursday.`;

const LONG_TRANSCRIPT = `Welcome to the Q3 planning session. We have a lot to cover today so let's dive right in.
First, let me share the key metrics from Q2. Revenue grew 18% quarter-over-quarter, and our user retention improved by 4 percentage points.
That's encouraging. The onboarding improvements we shipped in June seem to be paying off.
Agreed. For Q3, I want to focus on three pillars: platform reliability, developer experience, and international expansion.
Let's start with reliability. We had two major incidents last quarter that impacted over 10,000 users.
The root cause for both was the message queue hitting capacity limits during peak hours. We need to move to a partitioned architecture.
What's the estimated effort for that migration?
About six weeks if we dedicate two senior engineers full-time. We'd need to run the old and new systems in parallel during the transition.
That's significant but worth it. Let's make it the top priority.
For developer experience, I'd like us to ship a CLI tool and improve our SDK documentation. The feedback from the developer survey was clear — our APIs are powerful but hard to get started with.
I can lead the CLI effort. We already have the internal tooling that we could adapt.
Great. And for international expansion, we're looking at GDPR-compliant data residency in the EU region.
We'll need to set up a separate data pipeline and ensure all PII stays within the region boundary.
Let me pull up the architecture diagram. The main challenge is our analytics service — it currently aggregates data globally.
We could use a federated query approach. Each region processes locally and we merge anonymized aggregates.
That could work. Let's schedule a deeper technical review for next week.
Before we close — any concerns about the timeline? We're targeting end of September for all three pillars.
The queue migration is the riskiest. I'd suggest we have a go/no-go checkpoint at week four.
Smart. Let's add that to the project tracker. Thanks everyone, great discussion today.`;

export const SEED_MEETINGS: Meeting[] = [
  {
    id: 1,
    title: 'Weekly Standup — Engineering',
    transcript: PREVIEW_TRANSCRIPT,
    audioPath: 'C:\\recordings\\standup-2026-09-17.wav',
    durationSeconds: 2700,
    createdAt: '2026-09-17T09:00:00.000Z',
  },
  {
    id: 2,
    title: 'Q3 Planning Session',
    transcript: LONG_TRANSCRIPT,
    audioPath: 'C:\\recordings\\q3-planning-2026-09-15.wav',
    durationSeconds: 5400,
    createdAt: '2026-09-15T14:00:00.000Z',
  },
  {
    id: 3,
    title: '1:1 with Alex — Performance Review',
    transcript:
      "Let me start by saying your work this quarter has been outstanding. The API redesign was handled really well.\nThanks, I appreciate that. I felt good about how the rollout went.\nAny areas you want to focus on for growth?\nI'd like to get more experience with system design and architecture decisions.",
    audioPath: 'C:\\recordings\\one-on-one-2026-09-10.wav',
    durationSeconds: 720,
    createdAt: '2026-09-10T16:00:00.000Z',
  },
  {
    id: 4,
    title: 'Quick Sync — Deploy Hotfix',
    transcript: 'The fix is in. Deploying to staging now, should be in production within the hour.',
    audioPath: 'C:\\recordings\\hotfix-2026-08-28.wav',
    durationSeconds: 180,
    createdAt: '2026-08-28T11:30:00.000Z',
  },
  {
    id: 5,
    title: 'Client Demo — New Dashboard',
    transcript: '',
    audioPath: null,
    durationSeconds: null,
    createdAt: '2026-09-16T10:00:00.000Z',
  },
];

const TRANSCRIPT_PREVIEW_LENGTH = 100;

export function toSummaries(meetings: Meeting[]): MeetingSummary[] {
  return [...meetings]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((m) => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      durationSeconds: m.durationSeconds,
      transcriptPreview: m.transcript.slice(0, TRANSCRIPT_PREVIEW_LENGTH),
    }));
}

export const RECORDING_SCRIPT: TranscriptUpdate[] = [
  { sessionId: '', seq: 0, text: 'Hey, thanks for hopping on this call.', startSec: 0, endSec: 3 },
  {
    sessionId: '',
    seq: 1,
    text: 'No problem. So I wanted to walk through the new design with you.',
    startSec: 3,
    endSec: 7,
  },
  {
    sessionId: '',
    seq: 2,
    text: 'Sure, let me share my screen. Can you see the mockup?',
    startSec: 7,
    endSec: 11,
  },
  {
    sessionId: '',
    seq: 3,
    text: 'Yes, that looks great. I like the sidebar layout.',
    startSec: 11,
    endSec: 15,
  },
  {
    sessionId: '',
    seq: 4,
    text: 'The main concern is performance with large datasets. We should add virtualization.',
    startSec: 15,
    endSec: 20,
  },
  {
    sessionId: '',
    seq: 5,
    text: 'Agreed. I can prototype that this week and we can review on Thursday.',
    startSec: 20,
    endSec: 25,
  },
  {
    sessionId: '',
    seq: 6,
    text: 'Sounds like a plan. Anything else before we wrap up?',
    startSec: 25,
    endSec: 29,
  },
  {
    sessionId: '',
    seq: 7,
    text: "No, I think we're good. Talk to you Thursday!",
    startSec: 29,
    endSec: 32,
  },
];
