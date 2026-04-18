// Hand-written demo transcripts. Played back by `mockPlayer.ts` at the normal
// chunk cadence so the entire downstream pipeline (suggestions, chat, export)
// exercises without a microphone or Whisper.
//
// Speaker labels are included so the suggestion and chat prompts see who
// said what — useful for "question to ask <name>", "fact-check <name>'s
// claim", etc. Whisper itself does not do speaker diarization; for real
// meetings you'd need a separate provider (Deepgram, AssemblyAI, pyannote).

export interface MockLine {
  speaker: string;
  text: string;
  // Approximate seconds of speech this line represents. We use it to group
  // lines into chunks that match `chunkSeconds` (~30s by default).
  durationSec: number;
}

export interface MockScenario {
  id: string;
  title: string;
  description: string;
  lines: MockLine[];
}

// ---------- Scenario 1: Infra scaling (matches the reference prototype) ----------

const INFRA_SCALING: MockScenario = {
  id: "infra",
  title: "Infra scaling",
  description:
    "Engineering discussion on sharding, websockets, and managed Kafka. Good for answer + fact-check suggestions.",
  lines: [
    { speaker: "Priya",  text: "So we're talking about how to scale our backend to handle a million concurrent users.", durationSec: 6 },
    { speaker: "Priya",  text: "The main bottleneck right now is the websocket connections and how we're handling state in memory.", durationSec: 7 },
    { speaker: "Priya",  text: "I read that companies like Discord shard by guild ID — should we do something similar by user cohort?", durationSec: 8 },
    { speaker: "Priya",  text: "Also concerned about cost. If we move to managed Kafka, what's a realistic monthly bill at our volume?", durationSec: 8 },
    { speaker: "Priya",  text: "And one more thing — what was the failure mode when Slack went down last year? I want to avoid that pattern.", durationSec: 9 },
    { speaker: "Marcus", text: "On the state question, I was thinking Redis Cluster with consistent hashing. We'd pin connections to a node and failover reshards.", durationSec: 10 },
    { speaker: "Marcus", text: "The hard part is not the happy path, it's the reconnect storm after a partition. That's what killed the last rewrite.", durationSec: 10 },
    { speaker: "Jenna",  text: "Right. We also need to decide if we keep state in-process or externalize it. In-process is faster but makes blue-green deploys harder.", durationSec: 11 },
    { speaker: "Jenna",  text: "What's our p99 latency on websocket round-trips today? If we're already at 200ms we can't afford much more overhead.", durationSec: 9 },
    { speaker: "Marcus", text: "I think it's closer to 120 but I'd want to confirm. Let me pull the dashboard after this.", durationSec: 7 },
    { speaker: "Priya",  text: "On Kafka — the pitch for MSK is that we stop paying an engineer to babysit brokers. But the per-GB costs add up fast above ten megabytes a second.", durationSec: 12 },
    { speaker: "Jenna",  text: "Have we considered NATS JetStream? It's lighter weight and might be a better fit for our event volume.", durationSec: 8 },
    { speaker: "Marcus", text: "JetStream's nice but the ecosystem around Kafka is deeper — Debezium, schema registry, all the connectors.", durationSec: 10 },
    { speaker: "Priya",  text: "Fair. Let's timebox a spike on both next sprint. One week each, same workload, measure throughput and ops burden.", durationSec: 10 },
    { speaker: "Jenna",  text: "Sounds good. Who owns the write-up? And do we want to loop in the platform team before we commit?", durationSec: 8 },
  ],
};

// ---------- Scenario 2: Product kickoff ----------

const PRODUCT_KICKOFF: MockScenario = {
  id: "product",
  title: "Product kickoff",
  description:
    "PM + engineer scoping a new feature with fuzzy requirements. Good for question + clarify suggestions.",
  lines: [
    { speaker: "Dana (PM)",  text: "Alright, let's kick off the new onboarding flow. The goal is to get time-to-first-value under two minutes.", durationSec: 7 },
    { speaker: "Ravi (Eng)", text: "Great. Before we dive in — what does 'first value' actually mean for this product? Is it first message sent, or first team invited?", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "Good question. Leadership is saying first message sent, but the retention data suggests it's actually first team invited.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "Okay, and what's the current baseline? I don't want to build a whole new flow without knowing where we are today.", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "The current median is about four and a half minutes, p90 is closer to eleven minutes. Most of the drop-off is at the team-creation step.", durationSec: 11 },
    { speaker: "Ravi (Eng)", text: "That's the one with the long form, right? Name, industry, size, use case — it's a lot to ask upfront.", durationSec: 8 },
    { speaker: "Dana (PM)",  text: "Yeah, and we A/B tested removing industry last quarter, the conversion lift was small, like two percent.", durationSec: 9 },
    { speaker: "Ravi (Eng)", text: "What about making the whole team creation optional? Let the user send a message first, then prompt them to invite teammates later.", durationSec: 10 },
    { speaker: "Dana (PM)",  text: "I like that. Though product said they want team creation early so we can surface the billing plans. Revenue concern.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "Is there a number on that? How many single-user accounts ever convert to team plans later?", durationSec: 8 },
    { speaker: "Dana (PM)",  text: "I'd have to check. I'll ask data after this. We also haven't talked about the invite email — it's still the old template from 2023.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "What platforms are we targeting first? Web only, or mobile at the same time?", durationSec: 7 },
    { speaker: "Dana (PM)",  text: "Web first. Mobile team is heads-down on the notifications overhaul until end of quarter.", durationSec: 7 },
    { speaker: "Ravi (Eng)", text: "Last thing — how are we measuring success? Just the two-minute number, or are we also tracking thirty-day retention?", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "Both. Primary metric is time-to-first-value, guardrail is thirty-day retention. If we tank retention we roll it back.", durationSec: 10 },
  ],
};

// ---------- Scenario 3: 1:1 / career ----------

const ONE_ON_ONE: MockScenario = {
  id: "oneonone",
  title: "1:1 career conversation",
  description:
    "Manager + report discussing growth and feedback. Good for talking point + question suggestions.",
  lines: [
    { speaker: "Manager", text: "Thanks for making time. I wanted to use this one to talk about where you want to be a year from now.", durationSec: 7 },
    { speaker: "Report",  text: "Yeah, I've been thinking about that. I think I want to move from senior to staff, but I'm not sure what the gap actually is.", durationSec: 10 },
    { speaker: "Manager", text: "That's a good frame. Honestly the biggest gap I see is scope — you're delivering great on your project, but staff engineers pull in multiple teams' worth of problems.", durationSec: 12 },
    { speaker: "Report",  text: "Can you give me a concrete example of what that would look like on my team?", durationSec: 7 },
    { speaker: "Manager", text: "Sure. The search rewrite is a good candidate. Right now each team is reinventing relevance tuning. A staff person would own the shared abstraction across all three.", durationSec: 12 },
    { speaker: "Report",  text: "Okay, that's useful. How do I start picking that up without stepping on anyone's toes?", durationSec: 8 },
    { speaker: "Manager", text: "Start by writing the problem statement. Not a solution, just the shared pain. Circulate it, get buy-in. That's the real skill.", durationSec: 10 },
    { speaker: "Report",  text: "Got it. What else? On the technical side, anything I should be leveling up?", durationSec: 8 },
    { speaker: "Manager", text: "Honestly less than you'd think. System design is fine. Where you sometimes lose people is in the explanation — too much detail, too fast. Staff is about crisp communication.", durationSec: 13 },
    { speaker: "Report",  text: "That's fair feedback. I've heard it before. Any tactical suggestions for working on it?", durationSec: 8 },
    { speaker: "Manager", text: "Try writing the one-paragraph summary first, every time. Before the doc, before the meeting. If you can't fit it in a paragraph you haven't thought about it enough.", durationSec: 12 },
    { speaker: "Report",  text: "I'll try that. Last thing — is there a formal promotion process I should be aware of, or is it on your timing?", durationSec: 9 },
    { speaker: "Manager", text: "There's a calibration cycle every six months. Next one is in March. If we're aligned by then I'll put you up.", durationSec: 10 },
    { speaker: "Report",  text: "That's a great target. What would you want to see from me between now and then?", durationSec: 7 },
    { speaker: "Manager", text: "The search rewrite proposal, circulated and signed off. That alone would be a huge signal.", durationSec: 8 },
  ],
};

export const MOCK_SCENARIOS: MockScenario[] = [
  INFRA_SCALING,
  PRODUCT_KICKOFF,
  ONE_ON_ONE,
];

export function getScenario(id: string | null | undefined): MockScenario {
  return MOCK_SCENARIOS.find((s) => s.id === id) ?? MOCK_SCENARIOS[0];
}
